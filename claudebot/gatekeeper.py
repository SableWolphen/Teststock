#!/usr/bin/env python3
"""Profitability Gatekeeper (board + OpenAI advisor #107, 2026-11-03).

Before any option trade is recommended it must answer four questions. Any NO, or an UNKNOWN on a
question that is required, rejects the trade:
  Q1 positive net profit expected after realistic costs?  forecast after crossing the bid/ask and fees > $0
  Q2 is the forecast backed by evidence?                    the strategy has passed its paper gates
                                                            (50+ trades, 30+ sessions, PF > 1.2, bootstrap
                                                            lower bound > $0, positive with doubled cost)
  Q3 better than the alternatives?                          expected return per dollar per hour beats the
                                                            fractional ETF Dip desk's AND doing nothing
  Q4 can the account survive the worst plausible outcome?  losing the whole premium keeps the account above
                                                            its floor and within the governor's caps
Paper trading may run with Q2 = UNKNOWN (that is how evidence gets collected). Live use requires all four
YES; the risk governor refuses an options buy without a passing Gatekeeper verdict.

One exception, added by board order 2026-11-11: for a rule of the live options desk (strategyId
"optbuy:<rule>") Q2 may be answered "board" when optbuy_config.json records the board's order to trade
that rule with real money before its paper gates (rules[<rule>].boardApproval.approvalId). The verdict
then says so ("boardOverride"); it is never reported as paper evidence. Q1, Q3 and Q4 still have to be
YES, and a rule that has switched itself off for losing (10 live trades, profit factor < 1.0) answers NO.
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Dip desk benchmark: +0.98% per trade on unseen data, about 2.6 trading days (6.5 h each) per trade
DIP_PCT_PER_HOUR = 0.98 / (2.6 * 6.5)
ACCOUNT_FLOOR, MAX_PREMIUM, MAX_PCT = 0.0, 1000000.0, 100.0   # board 2026-11-11: "the cap is what is in the account only" (was $60 floor, $50, 43%)


def load(rel, d=None):
    try:
        with open(os.path.join(ROOT, rel)) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return d


def board_rule_evidence(rule):
    """'board' = the board ordered this live-desk rule traded before its paper gates and it has not switched
    itself off; 'no' = it switched itself off for losing; 'unknown' = no such recorded order."""
    cfg = load("claudebot/optbuy_config.json", {}) or {}
    rc = (cfg.get("rules") or {}).get(rule) or {}
    if not cfg.get("enabled") or not rc.get("enabled", True) or not (rc.get("boardApproval") or {}).get("approvalId"):
        return "unknown"
    rb = cfg.get("rollback") or {}; since = rb.get("since") or ""
    led = load("docs/data/claudebot-optbuy-ledger.json", {}) or {}
    t = [x for x in led.get("trades") or [] if x.get("rule") == rule and (x.get("enteredAt") or "") >= since]
    w = sum(x["pnlUsd"] for x in t if x["pnlUsd"] > 0); l = -sum(x["pnlUsd"] for x in t if x["pnlUsd"] <= 0)
    if len(t) >= rb.get("afterTrades", 10) and l > 0 and w / l < rb.get("minProfitFactor", 1.0):
        return "no"
    return "board"


def evidence_for(strategy_id):
    """'yes' if that paper strategy passed every gate, 'no' if it is retired/losing, else 'unknown'.
    'board' for a live-desk rule the board ordered traded before its paper gates (see board_rule_evidence)."""
    if (strategy_id or "").startswith("optbuy:"):
        return board_rule_evidence(strategy_id.split(":", 1)[1])
    lb = (load("docs/data/claudebot-optscalp-paper.json", {}) or {}).get("leaderboard") or []
    r = next((x for x in lb if x.get("id") == strategy_id), None)
    if not r:
        return "unknown"
    if r.get("boardProposal"):
        return "yes"
    if r.get("retired") or ((r.get("trades") or 0) >= 30 and (r.get("pnlUsd") or 0) < 0):
        return "no"
    return "unknown"


def evaluate(c, account_value, strategy_id=None, hold_minutes=30, live=False, evidence=None):
    """c: {ask, bid, forecastUsd (per contract, after costs)}. Returns verdict with the four answers."""
    premium = c["ask"] * 100
    f = c.get("forecastUsd")
    q1 = "unknown" if f is None else ("yes" if f > 0 else "no")
    q2 = evidence if evidence is not None else (evidence_for(strategy_id) if strategy_id else "unknown")
    pct_per_hour = (100 * f / premium) / (hold_minutes / 60) if f is not None and premium > 0 else None
    q3 = "unknown" if pct_per_hour is None else ("yes" if pct_per_hour > DIP_PCT_PER_HOUR and f > 0 else "no")
    cap = min(MAX_PREMIUM, account_value * MAX_PCT / 100)
    q4 = "yes" if premium <= cap and account_value - premium >= ACCOUNT_FLOOR else "no"
    answers = {"q1_netProfitAfterCosts": q1, "q2_evidence": q2, "q3_beatsEtfAndCash": q3, "q4_survivesWorstCase": q4}
    need = ["q1_netProfitAfterCosts", "q3_beatsEtfAndCash", "q4_survivesWorstCase"] + (["q2_evidence"] if live else [])
    passes = lambda k: answers[k] == "yes" or (k == "q2_evidence" and answers[k] == "board")
    fails = [k for k in need if not passes(k)]
    return {"pass": not fails, "answers": answers, "failed": fails, "live": live, "boardOverride": q2 == "board",
            "pctPerHour": None if pct_per_hour is None else round(pct_per_hour, 2), "dipPctPerHour": round(DIP_PCT_PER_HOUR, 3),
            "worstCaseUsd": round(-premium, 2)}


if __name__ == "__main__":
    import sys
    a = json.loads(sys.argv[1])
    print(json.dumps(evaluate(a["candidate"], a["accountValue"], a.get("strategyId"), a.get("holdMinutes", 30), a.get("live", False))))
