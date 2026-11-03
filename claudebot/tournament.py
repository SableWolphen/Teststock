#!/usr/bin/env python3
"""Independent, forward-only, paper-only ETF strategy tournament.

Runs after the US stock close from GitHub Actions. New entries are signalled
ONLY after the daily close and filled, if eligible, at the NEXT observed daily
OPEN; exits are similarly delayed. Intraday stops use observed lows, with
adverse opening gaps accounted for. Price inputs are Alpaca IEX daily OHLC
observations, NOT broker execution quotes or verified bid/ask/NBBO fills.

No Robinhood access, trade APIs, live configuration edits, or automatic
promotion. A paper leader can only qualify for manual review.
"""
from __future__ import annotations

import json
import math
import os
import random
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from edge_paper import NAMES, SYMS, entry_sig, exit_sig

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
OUT = DATA / "claudebot-tournament.json"
TZ = ZoneInfo("America/New_York")
STRATEGIES = ("down3", "double7", "dipwide")
PAPER_NOTIONAL_USD = 25.0
MAX_SIMULTANEOUS = 3
HALF_SPREAD_BPS = 7.0
SLIPPAGE_BPS = 7.0
FEE_USD_PER_SIDE = 0.005
MAX_ENTRY_GAP_PCT = 3.0
STOP_PCT = 5.0
SIDE_RATE = (HALF_SPREAD_BPS + SLIPPAGE_BPS) / 10000.0
MIN_OBSERVATIONS = 50
MIN_SESSIONS = 30
MIN_RETURN_PCT = 0.15


def read_json(path):
    try:
        with Path(path).open(encoding="utf-8") as f:
            doc = json.load(f)
        return doc if isinstance(doc, dict) else {}
    except (OSError, ValueError):
        return {}


def safe_float(x):
    if isinstance(x, bool):
        raise ValueError("Boolean price rejected")
    n = float(x)
    if not math.isfinite(n) or n <= 0:
        raise ValueError("Nonpositive/nonfinite market price")
    return n


def normalize_bars(symbol, raw):
    """Validate one symbol independently; never fill missing days with guesses."""
    if not isinstance(raw, list):
        raise ValueError("Missing daily bars for " + symbol)
    rows = []
    for b in raw:
        day = str(b.get("t", ""))[:10]
        if len(day) != 10 or day[4] != "-" or day[7] != "-":
            raise ValueError("Invalid session date")
        op, hi, lo, cl = (safe_float(b[k]) for k in ("o", "h", "l", "c"))
        vol = safe_float(b.get("v", 0))
        if lo > min(op, cl) or hi < max(op, cl) or hi < lo:
            raise ValueError("Inconsistent daily OHLC for " + symbol)
        rows.append({"day": day, "o": op, "h": hi, "l": lo, "c": cl, "v": vol})
    rows.sort(key=lambda r: r["day"])
    if len({b["day"] for b in rows}) != len(rows):
        raise ValueError("Duplicate daily bar " + symbol)
    if len(rows) < 210:
        raise ValueError("Insufficient 200-day warmup for " + symbol)
    return rows


def fetch_bars(symbol, today):
    key, secret = os.environ.get("ALPACA_API_KEY"), os.environ.get("ALPACA_API_SECRET")
    if not key or not secret:
        raise ValueError("Read-only market-data credentials unavailable")
    end = (today + timedelta(days=1)).isoformat()
    url = (f"https://data.alpaca.markets/v2/stocks/{symbol}/bars?"
           f"timeframe=1Day&start=2024-01-01&end={end}&adjustment=split&feed=iex&limit=10000")
    req = urllib.request.Request(url, headers={
        "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, "User-Agent": "teststock-paper-only"
    })
    with urllib.request.urlopen(req, timeout=40) as rsp:
        raw = json.loads(rsp.read(2_000_000))
    if raw.get("next_page_token"):
        raise ValueError("Incomplete price pagination for " + symbol)
    return normalize_bars(symbol, raw.get("bars"))


def validate_universe(bars_by_symbol, now, prior_day=None):
    """Only use aligned, completed NYSE daily sessions across every ETF."""
    if set(bars_by_symbol) != set(SYMS):
        raise ValueError("ETF universe is incomplete")
    all_days = [set(r["day"] for r in bars) for bars in bars_by_symbol.values()]
    last_days = {max(ds) for ds in all_days}
    if len(last_days) != 1:
        raise ValueError("ETF latest daily bars disagree; no partial publication")
    newest = last_days.pop()
    today = now.astimezone(TZ).date()
    if newest > today.isoformat():
        raise ValueError("Future daily bar")
    if (today - datetime.strptime(newest, "%Y-%m-%d").date()).days > 4:
        raise ValueError("ETF daily feed stale by more than four calendar days")
    if newest == today.isoformat() and now.astimezone(TZ).hour < 16:
        raise ValueError("Intraday daily bar cannot be treated as completed")
    if prior_day and newest < prior_day:
        raise ValueError("Data rolled back before the previous research session")
    common = set.intersection(*all_days)
    if not common:
        raise ValueError("No aligned daily sessions")
    if prior_day:
        new = sorted(d for d in common if d > prior_day)
        for d in new:
            if any(d not in ds for ds in all_days):
                raise ValueError("Missing observed session")
        if any(d not in common for d in set.union(*all_days) if prior_day < d <= newest):
            raise ValueError("Mismatched forward session bars")
        return new, newest
    # First enrollment must NOT label historical replay as independent
    # forward results. Start with the latest completed day only.
    return [newest], newest


def empty_strategy(kind):
    return {"name": NAMES[kind], "positions": {}, "pending": {},
            "trades": [], "skips": {}, "events": []}


def new_state():
    return {"schemaVersion": 1, "mode": "PAPER_ONLY", "liveOrdersEnabled": False,
            "automaticLivePromotion": False, "brokerVerified": False,
            "executionModel": "NEXT_DAY_OPEN_IES_OHLC_MODELED_NOT_NBBO",
            "model": {"notionalUsd": PAPER_NOTIONAL_USD, "maxOpenPerStrategy": MAX_SIMULTANEOUS,
                      "halfSpreadBpsPerSide": HALF_SPREAD_BPS, "slippageBpsPerSide": SLIPPAGE_BPS,
                      "extraFeeUsdPerSide": FEE_USD_PER_SIDE,
                      "maxEntryGapPct": MAX_ENTRY_GAP_PCT, "intradayStopPct": STOP_PCT,
                      "gapStopsMayLoseMoreThanStopPct": True},
            "lastProcessedDay": None,
            "strategies": {k: empty_strategy(k) for k in STRATEGIES},
            "runs": []}


def skip(st, reason):
    st["skips"][reason] = st["skips"].get(reason, 0) + 1


def log_event(st, event):
    st["events"].append(event)
    st["events"] = st["events"][-50:]


def close_trade(st, symbol, day, raw_exit, reason):
    pos = st["positions"].pop(symbol)
    fill = raw_exit * (1 - SIDE_RATE)
    gross = pos["qty"] * (raw_exit - pos["entryOpenRaw"])
    net = pos["qty"] * (fill - pos["entryFill"]) - pos["entryFee"] - FEE_USD_PER_SIDE
    friction = gross - net
    if friction < -1e-8:
        raise ValueError("Negative modeled transaction friction")
    tr = {"symbol": symbol, "entrySignalDay": pos["signalDay"],
          "entryDay": pos["entryDay"], "exitDay": day,
          "entryOpenRaw": round(pos["entryOpenRaw"], 5),
          "entryFill": round(pos["entryFill"], 5),
          "exitReference": round(raw_exit, 5), "exitFill": round(fill, 5),
          "qty": round(pos["qty"], 8),
          "entryNotionalUsd": round(pos["notionalUsd"], 4),
          "grossPnlUsd": round(gross, 6),
          "frictionUsd": round(friction, 6),
          "netPnlUsd": round(net, 6),
          "stressedNetUsd": round(gross - 2 * friction, 6),
          "netReturnPct": round(net / pos["notionalUsd"] * 100, 4),
          "why": reason}
    st["trades"].append(tr)
    log_event(st, {"day": day, "action": "EXIT", "symbol": symbol, "why": reason})
    return tr


def process_day(state, bars_by_symbol, day):
    """Replay exactly ONE new chronological daily bar; signals never use day+1."""
    if state.get("lastProcessedDay") and day <= state["lastProcessedDay"]:
        return
    lookup = {sym: {r["day"]: (i, r) for i, r in enumerate(rows)}
              for sym, rows in bars_by_symbol.items()}
    if any(day not in rows for rows in lookup.values()):
        raise ValueError("Missing aligned daily bar")
    for kind in STRATEGIES:
        st = state["strategies"][kind]
        exited_today = set()
        # Orders are decided at PREVIOUS closes. Fills use TODAY's observed open.
        for sym, order in sorted(list(st["pending"].items())):
            if order["signalDay"] >= day:
                continue
            st["pending"].pop(sym)
            bar = lookup[sym][day][1]
            if order["side"] == "SELL":
                if sym in st["positions"]:
                    close_trade(st, sym, day, bar["o"], order["why"] + " (next open)")
                    exited_today.add(sym)
                continue
            if order["side"] != "BUY":
                raise ValueError("Unknown paper order side")
            if sym in st["positions"] or len(st["positions"]) >= MAX_SIMULTANEOUS:
                skip(st, "PAPER_CAPACITY_OR_DUPLICATE")
                continue
            ref = safe_float(order["referenceClose"])
            gap_pct = 100 * abs(bar["o"] / ref - 1)
            if gap_pct > MAX_ENTRY_GAP_PCT:
                skip(st, "GAP_TOO_LARGE_SKIP")
                continue
            fill = bar["o"] * (1 + SIDE_RATE)
            qty = PAPER_NOTIONAL_USD / fill
            st["positions"][sym] = {
                "signalDay": order["signalDay"], "entryDay": day,
                "entryOpenRaw": bar["o"], "entryFill": fill,
                "qty": qty, "entryFee": FEE_USD_PER_SIDE,
                "notionalUsd": PAPER_NOTIONAL_USD, "heldSessions": 0,
            }
            log_event(st, {"day": day, "action": "ENTRY", "symbol": sym,
                           "signalDay": order["signalDay"], "fillModel": "NEXT_DAY_OPEN_PLUS_COSTS"})
        for sym in sorted(bars_by_symbol):
            i, bar = lookup[sym][day]
            closes = [r["c"] for r in bars_by_symbol[sym][:i + 1]]
            if i < 209:
                continue
            pos = st["positions"].get(sym)
            if pos:
                # With no intraday sequence or NBBO, take the conservative
                # observed gap-through-stop price, never assume a perfect stop.
                stop = pos["entryFill"] * (1 - STOP_PCT / 100)
                if bar["l"] <= stop:
                    close_trade(st, sym, day, min(bar["o"], stop), "intraday stop / gap")
                    exited_today.add(sym)
                    continue
                pos["heldSessions"] += 1
                if sym not in st["pending"]:
                    why = exit_sig(kind, closes, i, pos["heldSessions"], pos["entryFill"])
                    if why:
                        st["pending"][sym] = {"side": "SELL", "signalDay": day, "why": why}
            elif sym not in st["pending"] and sym not in exited_today:
                if entry_sig(kind, closes, i):
                    st["pending"][sym] = {"side": "BUY", "signalDay": day,
                                          "referenceClose": bar["c"], "why": "close signal"}
    state["lastProcessedDay"] = day


def bootstrap_lower_by_day(trades):
    """Resample entry-day clusters, not correlated same-day symbols independently."""
    grouped = defaultdict(float)
    for t in trades:
        grouped[t["entryDay"]] += t["netPnlUsd"]
    sample = list(grouped.values())
    if len(sample) < MIN_SESSIONS:
        return None
    rng = random.Random(11032026)
    n = len(sample)
    means = sorted(sum(sample[rng.randrange(n)] for _ in range(n)) / n for _ in range(2000))
    return round(means[49], 4)


def summarize_strategy(kind, st):
    trades = st["trades"]
    n = len(trades)
    independent = {(t["symbol"], t["entrySignalDay"], t["entryDay"]) for t in trades}
    sessions = {t["entryDay"] for t in trades}
    net = sum(t["netPnlUsd"] for t in trades)
    stress = sum(t["stressedNetUsd"] for t in trades)
    wins = sum(t["netPnlUsd"] for t in trades if t["netPnlUsd"] > 0)
    losses = -sum(t["netPnlUsd"] for t in trades if t["netPnlUsd"] < 0)
    pf = wins / losses if losses > 0 else None
    account = peak = 0.0
    dd = 0.0
    for tr in sorted(trades, key=lambda t: (t["exitDay"], t["symbol"])):
        account += tr["netPnlUsd"]
        peak = max(peak, account)
        dd = min(dd, account - peak)
    lower = bootstrap_lower_by_day(trades)
    checks = {
        "fifty_independent_forward_trades": len(independent) >= MIN_OBSERVATIONS and len(independent) == n,
        "thirty_independent_sessions": len(sessions) >= MIN_SESSIONS,
        "positive_net_after_costs": net > 0,
        "positive_under_doubled_costs": stress > 0,
        "profit_factor_above_1_3": pf is not None and pf > 1.3,
        "average_trade_above_0_15pct": n > 0 and 100 * net / (n * PAPER_NOTIONAL_USD) > MIN_RETURN_PCT,
        "lower_bootstrap_day_cluster_positive": lower is not None and lower > 0,
        # The source is a daily OHLC model, NEVER executable NBBO.
        "broker_executable_fill_evidence": False,
        "separately_approved_live_strategy": False,
    }
    # Research-only promotion is permanently disabled in this program.
    preliminary = all(v for k, v in checks.items() if k not in
                      ("broker_executable_fill_evidence", "separately_approved_live_strategy"))
    return {"id": kind, "name": st["name"], "source": "FORWARD_NEXT_OPEN_MODEL",
            "closedTrades": n, "independentTrades": len(independent),
            "entrySessions": len(sessions), "openPositions": len(st["positions"]),
            "pendingSignals": len(st["pending"]),
            "netPaperUsd": round(net, 4), "netDoubleCostUsd": round(stress, 4),
            "avgNetTradePct": round(100 * net / (n * PAPER_NOTIONAL_USD), 4) if n else None,
            "winRatePct": round(100 * sum(t["netPnlUsd"] > 0 for t in trades) / n, 1) if n else None,
            "profitFactor": round(pf, 3) if pf is not None else None,
            "worstClosedTradeDrawdownUsd": round(dd, 4),
            "bootstrapLower95UsdPerSession": lower,
            "skips": st["skips"], "checks": checks,
            "paperReviewCandidate": preliminary,
            "decision": "PAPER_REVIEW_ONLY" if preliminary else "INSUFFICIENT_FORWARD_EVIDENCE",
            "liveEligible": False, "autoPromote": False}


def agent_health(data_dir, now):
    feeds = {
        "scout_etf_watch": ("claudebot-optbuy-scan.json", "generatedAt", 36),
        "vega_options_paper": ("claudebot-optscalp-paper.json", "updatedAt", 36),
        "clio_historian": ("claudebot-historian.json", "generatedAt", 9 * 24),
        "moxie_moonshot": ("claudebot-moonshot-paper.json", "updatedAt", 4 * 24),
        "management_audit": ("claudebot-audit.json", "generatedAt", 48),
    }
    retired = {f.get("agent") for f in read_json(data_dir / "claudebot-hr.json").get("fired", [])}
    result = {}
    for key, (file, field, max_age_h) in feeds.items():
        agent = key.split("_")[0]
        if agent in retired:
            result[key] = {"status": "INACTIVE", "reason": "agent retired"}
            continue
        doc = read_json(data_dir / file)
        try:
            ts = datetime.fromisoformat(str(doc[field]).replace("Z", "+00:00"))
            age = (now - ts).total_seconds() / 3600
            status = "HEALTHY" if 0 <= age <= max_age_h else "STALE"
        except (KeyError, ValueError, TypeError):
            age, status = None, "MISSING"
        if key == "management_audit" and doc.get("ceo", {}).get("status") == "fail":
            status = "FAIL"
        result[key] = {"status": status, "ageHours": round(age, 1) if age is not None else None,
                       "maxAgeHours": max_age_h, "source": file}
    return result


def options_challengers(data_dir):
    """Separate options cohort: indicative option quotes are NOT comparable ETF fills."""
    p = read_json(data_dir / "claudebot-optscalp-paper.json")
    lb = {r.get("id"): r for r in p.get("leaderboard", [])}
    variants = []
    opportunities = set()
    for key, st in sorted((p.get("strategies") or {}).items()):
        trades = st.get("trades") or []
        for t in trades:
            opportunities.add((t.get("day"), t.get("symbol"), t.get("boughtAt")))
        r = lb.get(key, {})
        variants.append({"id": key, "closedVariantTrades": len(trades),
                         "reportedNetPaperUsd": r.get("pnlUsd"),
                         "reportedDoubleCostUsd": r.get("pnlDoubleCostUsd"),
                         "retired": bool(r.get("retired") or st.get("retired")),
                         "liveEligible": False})
    return {"source": "INDICATIVE_OPTION_QUOTES_NOT_EXECUTABLE_NBBO",
            "comparableToEtf": False, "variants": variants,
            "distinctUnderlyingOpportunities": len(opportunities),
            "sourceUpdatedAt": p.get("updatedAt"), "autoPromote": False}


def build_report(state, data_dir, now):
    rows = [summarize_strategy(kind, state["strategies"][kind]) for kind in STRATEGIES]
    # A champion is labelled only after enough independent profitable forward
    # evidence; even then it is a research leader, not an executable approval.
    qualified = [r for r in rows if r["paperReviewCandidate"]]
    qualified.sort(key=lambda r: (-r["netDoubleCostUsd"], -r["avgNetTradePct"], r["id"]))
    leader = qualified[0]["id"] if qualified else None
    return {
        "schemaVersion": 1, "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "lastProcessedDay": state["lastProcessedDay"],
        "mode": "PAPER_ONLY", "liveOrdersEnabled": False, "autoPromote": False,
        "brokerVerified": False, "decision": "NO_NEW_LIVE_STRATEGIES",
        "benchmark": {"id": "cash", "netUsd": 0, "maxDrawdownUsd": 0},
        "source": "ALPACA_IEX_SPLIT_ADJUSTED_DAILY_OHLC",
        "fillProvenance": "MODELED_NEXT_SESSION_OPEN_NOT_EXECUTABLE_NBBO",
        "frictionModel": state["model"],
        "researchLeader": leader,
        "etfLeaderboard": rows,
        "optionsCohort": options_challengers(data_dir),
        "agentHealth": agent_health(data_dir, now),
        "validation": {"forwardOnly": True, "noLookahead": True,
                       "brokerEvidence": False, "automaticTrading": False,
                       "promotionRequiresSeparateApproval": True},
        "limitations": [
            "Daily IEX OHLC opens are observed after the session, not executable broker fills.",
            "Fixed spread/slippage estimates, fees and gap/stop assumptions may understate real costs.",
            "Opening-gap skips and capacity limits are modeled; queue priority is alphabetical.",
            "Bootstrap is clustered by entry day and cannot guarantee future profits.",
            "No new live strategies can be enabled by this research workflow.",
        ],
    }


def update(state, bars, now):
    prior = state.get("lastProcessedDay")
    dates, newest = validate_universe(bars, now, prior)
    if state.get("mode") != "PAPER_ONLY" or state.get("liveOrdersEnabled") is not False:
        raise ValueError("Refusing unsafe or incompatible tournament state")
    if set(state.get("strategies", {})) != set(STRATEGIES):
        raise ValueError("Tournament strategy set changed unexpectedly")
    for day in dates:
        process_day(state, bars, day)
    stamp = now.isoformat().replace("+00:00", "Z")
    state["generatedAt"] = stamp
    state["latestProviderDay"] = newest
    state.setdefault("runs", []).append({"at": stamp, "latestSession": newest,
                                          "newSessions": len(dates), "status": "PAPER_ONLY"})
    state["runs"] = state["runs"][-60:]
    return state


def main():
    now = datetime.now(timezone.utc)
    prior = read_json(OUT)
    state = prior if prior and prior.get("schemaVersion") == 1 else new_state()
    # Never trust a previous JSON file to grant trading permissions.
    state["liveOrdersEnabled"] = False
    state["automaticLivePromotion"] = False
    bars = {}
    for sym in SYMS:
        try:
            bars[sym] = fetch_bars(sym, now.astimezone(TZ).date())
        except Exception:
            print("::error::Daily market-data coverage failed for " + sym +
                  "; no partial leaderboard publication", file=sys.stderr)
            raise SystemExit(1)
    try:
        update(state, bars, now)
        report = build_report(state, DATA, now)
        # Independent validator runs before committing either JSON.
        from tournament_audit import validate
        validate(state, report)
    except (ValueError, KeyError, TypeError, ArithmeticError) as exc:
        print("::error::Tournament evidence blocked: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
    DATA.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(state, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    (DATA / "claudebot-tournament-scorecard.json").write_text(
        json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"mode": "PAPER_ONLY", "newSessions": state["runs"][-1]["newSessions"],
                      "closedTrades": {r["id"]: r["closedTrades"] for r in report["etfLeaderboard"]},
                      "liveEligible": False}))


if __name__ == "__main__":
    main()
