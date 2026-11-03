#!/usr/bin/env python3
"""Independent fail-closed tournament accounting audit. No broker connectivity."""
from __future__ import annotations

import json
import math
from pathlib import Path

BLOCKED_KEYS = ("account_number", "rhs_account_number", "order_id",
                "buying_power", "api_key", "api_secret", "auth_token", "private_key")
EXPECTED_MODE = "PAPER_ONLY"
EXPECTED_SOURCE = "ALPACA_IEX_SPLIT_ADJUSTED_DAILY_OHLC"
ROW_IDS = {"down3", "double7", "dipwide"}


def finite(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def near(a, b, tolerance=0.00012):
    return finite(a) and finite(b) and abs(a - b) <= tolerance


def validate(state, report):
    """Recalculate accounting and verify provenance; never authorize live risk."""
    if state.get("schemaVersion") != 1 or state.get("mode") != EXPECTED_MODE:
        raise ValueError("Invalid paper state")
    for obj in (state, report):
        if obj.get("liveOrdersEnabled") is not False:
            raise ValueError("Live execution is forbidden in tournament")
        if obj.get("brokerVerified") is not False:
            raise ValueError("Modeled fills cannot claim broker verification")
    if state.get("automaticLivePromotion") is not False or report.get("autoPromote") is not False:
        raise ValueError("Auto promotion is forbidden")
    if report.get("mode") != EXPECTED_MODE or report.get("source") != EXPECTED_SOURCE:
        raise ValueError("Incorrect tournament evidence provenance")
    if report.get("decision") != "NO_NEW_LIVE_STRATEGIES" or report.get("researchLeader") not in (None, "down3", "double7", "dipwide"):
        raise ValueError("Unsafe tournament decision")
    if report.get("fillProvenance") != "MODELED_NEXT_SESSION_OPEN_NOT_EXECUTABLE_NBBO":
        raise ValueError("Executable-fill claim is forbidden")
    if report.get("lastProcessedDay") != state.get("lastProcessedDay"):
        raise ValueError("Evidence session mismatch")
    model = state.get("model", {})
    if (not near(model.get("notionalUsd"), 25, .00001)
            or not near(model.get("halfSpreadBpsPerSide"), 7, .00001)
            or not near(model.get("slippageBpsPerSide"), 7, .00001)
            or not near(model.get("extraFeeUsdPerSide"), .005, .000001)
            or model.get("maxOpenPerStrategy") != 3
            or not near(model.get("intradayStopPct"), 5, .00001)):
        raise ValueError("Unknown or loosened friction/risk model")
    if report.get("frictionModel") != model:
        raise ValueError("Published friction model does not match the validated state")
    if set(state.get("strategies") or {}) != ROW_IDS:
        raise ValueError("Unexpected strategy in paper state")
    leaderboard = report.get("etfLeaderboard")
    if not isinstance(leaderboard, list) or {r.get("id") for r in leaderboard} != ROW_IDS or len(leaderboard) != 3:
        raise ValueError("Unexpected published leaderboard")
    by_id = {r["id"]: r for r in leaderboard}
    all_opportunities = set()
    for kind, desk in state["strategies"].items():
        row = by_id[kind]
        trades = desk.get("trades", [])
        positions = desk.get("positions", {})
        pending = desk.get("pending", {})
        if len(positions) > 3 or set(positions) & set(pending) and any(
                pending[k].get("side") == "BUY" for k in set(positions) & set(pending)):
            raise ValueError("Paper cap or duplicate holdings violated")
        if row.get("liveEligible") is not False or row.get("autoPromote") is not False:
            raise ValueError("Leaderboard cannot enable live orders")
        if not all(isinstance(v, dict) and v.get("side") in ("BUY", "SELL") and
                   isinstance(v.get("signalDay"), str) and
                   (state.get("lastProcessedDay") is None or v["signalDay"] <= state["lastProcessedDay"])
                   for v in pending.values()):
            raise ValueError("Invalid pending paper order")
        if not all(finite(p.get("qty")) and p["qty"] > 0 and
                   p.get("entryDay") > p.get("signalDay") and
                   near(p.get("notionalUsd"), 25) for p in positions.values()):
            raise ValueError("Invalid open paper positions")
        ids = set()
        pnl = stress = 0.0
        for t in trades:
            k = (t["symbol"], t["entrySignalDay"], t["entryDay"])
            if k in ids:
                raise ValueError("Duplicate independent paper opportunity")
            ids.add(k)
            all_opportunities.add(k)
            if not (t["entrySignalDay"] < t["entryDay"] <= t["exitDay"] and
                    (state.get("lastProcessedDay") is None or t["exitDay"] <= state["lastProcessedDay"])):
                raise ValueError("Same-close lookahead or future trade")
            if not all(finite(t.get(field)) for field in
                       ("entryOpenRaw", "entryFill", "exitReference", "exitFill", "qty",
                        "entryNotionalUsd", "grossPnlUsd", "frictionUsd", "netPnlUsd",
                        "stressedNetUsd", "netReturnPct")):
                raise ValueError("Nonfinite paper accounting")
            if not (t["entryOpenRaw"] > 0 and t["exitReference"] > 0 and
                    t["qty"] > 0 and t["frictionUsd"] > 0 and
                    near(t["entryNotionalUsd"], 25)):
                raise ValueError("Invalid sizes or friction")
            rate = (model["halfSpreadBpsPerSide"] + model["slippageBpsPerSide"]) / 10000
            expect_entry = t["entryOpenRaw"] * (1 + rate)
            expect_exit = t["exitReference"] * (1 - rate)
            expect_qty = t["entryNotionalUsd"] / expect_entry
            expect_gross = t["qty"] * (t["exitReference"] - t["entryOpenRaw"])
            expect_net = t["qty"] * (t["exitFill"] - t["entryFill"]) - 2 * model["extraFeeUsdPerSide"]
            expect_friction = t["qty"] * ((t["entryFill"] - t["entryOpenRaw"]) +
                                            (t["exitReference"] - t["exitFill"])) + 2 * model["extraFeeUsdPerSide"]
            if (not near(t["entryFill"], expect_entry, .00002) or
                    not near(t["exitFill"], expect_exit, .00002) or
                    not near(t["qty"], expect_qty, .00000005) or
                    not near(t["grossPnlUsd"], expect_gross) or
                    not near(t["netPnlUsd"], expect_net) or
                    not near(t["frictionUsd"], expect_friction)):
                raise ValueError("Modeled opening-price fill/fees fail independent re-calculation")
            if not near(t["grossPnlUsd"] - t["frictionUsd"], t["netPnlUsd"]):
                raise ValueError("Paper net P&L does not reconcile")
            if not near(t["grossPnlUsd"] - 2 * t["frictionUsd"], t["stressedNetUsd"]):
                raise ValueError("Doubled-cost P&L does not reconcile")
            if not near(t["netPnlUsd"] / t["entryNotionalUsd"] * 100, t["netReturnPct"], .0003):
                raise ValueError("Trade return percentage does not reconcile")
            pnl += t["netPnlUsd"]
            stress += t["stressedNetUsd"]
        if row.get("closedTrades") != len(trades) or row.get("independentTrades") != len(ids):
            raise ValueError("Trade count mismatch")
        if not near(row.get("netPaperUsd"), pnl, .00011) or not near(row.get("netDoubleCostUsd"), stress, .00011):
            raise ValueError("Leaderboard totals do not reconcile")
        if row.get("openPositions") != len(positions) or row.get("pendingSignals") != len(pending):
            raise ValueError("Open/pending counts do not reconcile")
        if row.get("decision") not in ("INSUFFICIENT_FORWARD_EVIDENCE", "PAPER_REVIEW_ONLY"):
            raise ValueError("Invalid research disposition")
        checks = row.get("checks") or {}
        if checks.get("broker_executable_fill_evidence") is not False or checks.get("separately_approved_live_strategy") is not False:
            raise ValueError("Modeled data cannot satisfy approval")
        if row.get("paperReviewCandidate") and not all(v for k, v in checks.items() if k not in
                ("broker_executable_fill_evidence", "separately_approved_live_strategy")):
            raise ValueError("Research review criterion bypassed")
    if report.get("benchmark") != {"id": "cash", "netUsd": 0, "maxDrawdownUsd": 0}:
        raise ValueError("Missing zero-risk cash comparator")
    opts = report.get("optionsCohort") or {}
    if opts.get("comparableToEtf") is not False or opts.get("autoPromote") is not False:
        raise ValueError("Indicative options cannot compete as executable fills")
    if any(v.get("liveEligible") is not False for v in opts.get("variants", [])):
        raise ValueError("Options cohort cannot enable live trading")
    # Report may contain ticker strings but never broker account IDs or credentials.
    lower = json.dumps(report, allow_nan=False).lower()
    if any('"' + k + '"' in lower for k in BLOCKED_KEYS):
        raise ValueError("Private broker fields forbidden in public scoreboard")
    return True


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent / "docs" / "data"
    st = json.loads((root / "claudebot-tournament.json").read_text())
    rep = json.loads((root / "claudebot-tournament-scorecard.json").read_text())
    validate(st, rep)
    print("Independent tournament audit passed: no live risk, no lookahead, costs reconcile")
