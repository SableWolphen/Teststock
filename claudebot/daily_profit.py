#!/usr/bin/env python3
"""Daily P&L accountability: source-backed PAPER results, no broker claims.

Public GitHub does not have a validated authenticated broker P&L feed. Realized
Robinhood earnings, daily changes in open positions, deposits and transaction
costs MUST NOT be inferred from published strategy ledgers. An unverified or
zero-trade day is never treated as a profitable broker day.

This script has no network, brokerage API, or trading-config write capability.
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from tournament import STRATEGIES, ROOT, DATA, read_json
from tournament_audit import validate

STATE = DATA / "claudebot-tournament.json"
SCORE = DATA / "claudebot-tournament-scorecard.json"
DEST = DATA / "claudebot-daily-profit.json"
MAX_SOURCE_AGE_HOURS = 72.0


def _iso(s):
    if not isinstance(s, str):
        raise ValueError("Missing date/time")
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _rounded(value):
    return round(value + 0.0, 6)


def _status(value, count):
    if not count:
        return "NO_CLOSED_TRADES"
    if value > 1e-7:
        return "PAPER_NET_POSITIVE"
    if value < -1e-7:
        return "PAPER_NET_NEGATIVE"
    return "PAPER_NET_FLAT"


def _sessions(state):
    last = state.get("lastProcessedDay")
    recorded = state.get("observedSessions")
    if not isinstance(recorded, list):
        recorded = []
    if last and last not in recorded:
        recorded.append(last)  # prior tournament state may predate session history
    if len(recorded) != len(set(recorded)) or recorded != sorted(recorded):
        raise ValueError("Forward sessions not chronological/unique")
    if recorded and recorded[-1] != last:
        raise ValueError("Latest daily session mismatch")
    if any(not isinstance(d, str) or len(d) != 10 for d in recorded):
        raise ValueError("Invalid observed session")
    return recorded[-60:]


def summarize_strategy(kind, trades, sessions):
    by_day = defaultdict(list)
    seen = set()
    for t in trades:
        key = (t.get("symbol"), t.get("entrySignalDay"), t.get("entryDay"))
        if key in seen:
            raise ValueError("Duplicate paper opportunity")
        seen.add(key)
        day = t.get("exitDay")
        if day not in sessions:
            raise ValueError("Closed paper trade not linked to an observed session")
        pnl = t.get("netPnlUsd")
        if not isinstance(pnl, (int, float)) or not math.isfinite(pnl):
            raise ValueError("Invalid paper P&L")
        by_day[day].append(float(pnl))
    daily = []
    for day in sessions:
        net = sum(by_day[day])
        count = len(by_day[day])
        daily.append({"day": day, "closedTrades": count,
                      "netClosedPaperUsd": _rounded(net),
                      "status": _status(net, count)})
    days_with_closes = [d for d in daily if d["closedTrades"]]
    wins = sum(d["status"] == "PAPER_NET_POSITIVE" for d in days_with_closes)
    losses = sum(d["status"] == "PAPER_NET_NEGATIVE" for d in days_with_closes)
    loss_streak = 0
    for d in reversed(daily):
        if d["status"] == "PAPER_NET_NEGATIVE":
            loss_streak += 1
        else:
            break
    return {
        "id": kind, "source": "MODELED_FORWARD_PAPER_CLOSED_TRADES_ONLY",
        "observedSessions": len(sessions),
        "sessionsWithClosedTrades": len(days_with_closes),
        "profitableClosingSessions": wins,
        "losingClosingSessions": losses,
        "flatOrNoCloseSessions": len(sessions) - wins - losses,
        "profitablePctOfSessionsWithCloses": round(100 * wins / len(days_with_closes), 1) if days_with_closes else None,
        "profitablePctOfAllObservedSessions": round(100 * wins / len(sessions), 1) if sessions else None,
        "latestClosingSession": daily[-1] if daily else None,
        "consecutiveLosingObservedSessions": loss_streak,
        "netClosedPaperUsd": _rounded(sum(t["netPnlUsd"] for t in trades)),
        "daily": daily[-30:],
        "needsPaperReview": loss_streak >= 2 or losses > wins,
        "mayIncreaseLiveRiskAutomatically": False,
    }


def build(state, tournament_scorecard, now):
    if state.get("mode") != "PAPER_ONLY" or tournament_scorecard.get("mode") != "PAPER_ONLY":
        raise ValueError("Cannot convert nonpaper results into daily profit claims")
    if tournament_scorecard.get("liveOrdersEnabled") is not False or tournament_scorecard.get("brokerVerified") is not False:
        raise ValueError("Tournament cannot grant broker provenance")
    if tournament_scorecard.get("lastProcessedDay") != state.get("lastProcessedDay"):
        raise ValueError("Source session disagreement")
    when = _iso(tournament_scorecard.get("generatedAt"))
    if when.tzinfo is None or now.tzinfo is None:
        raise ValueError("Timezone required")
    age_h = (now - when).total_seconds() / 3600
    if age_h < -0.1:
        raise ValueError("Scorecard is from the future")
    sessions = _sessions(state)
    summaries = [summarize_strategy(k, state["strategies"][k]["trades"], sessions)
                 for k in STRATEGIES]
    latest = sessions[-1] if sessions else None
    last = [r["latestClosingSession"] for r in summaries]
    profitable_models = [r["id"] for r in summaries if r["latestClosingSession"] and
                         r["latestClosingSession"]["status"] == "PAPER_NET_POSITIVE"]
    losing_models = [r["id"] for r in summaries if r["latestClosingSession"] and
                     r["latestClosingSession"]["status"] == "PAPER_NET_NEGATIVE"]
    no_closes = [r["id"] for r in summaries if r["latestClosingSession"] and
                 r["latestClosingSession"]["closedTrades"] == 0]
    alerts = []
    if age_h > MAX_SOURCE_AGE_HOURS:
        alerts.append("PAPER_SOURCE_STALE")
    if losing_models:
        alerts.append("PAPER_LOSING_STRATEGY_DAY")
    if any(r["needsPaperReview"] for r in summaries):
        alerts.append("PAPER_LOSS_CONSISTENCY_REVIEW")
    if not profitable_models:
        alerts.append("NO_PROFITABLE_CLOSED_PAPER_STRATEGY_TODAY")
    alerts.append("BROKER_DAILY_PROFIT_NOT_VERIFIED")
    return {
        "schemaVersion": 1,
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "sourceGeneratedAt": tournament_scorecard.get("generatedAt"),
        "sourceLastSession": latest,
        "paperSourceStatus": "CURRENT" if age_h <= MAX_SOURCE_AGE_HOURS else "STALE",
        "scope": "PUBLIC_RESEARCH_ONLY_NOT_BROKER_ACCOUNT_PERFORMANCE",
        "dailyGoal": "POSITIVE_NET_RETURN_AFTER_COSTS_WHEN_PROVABLE_NOT_GUARANTEED",
        "actualBroker": {
            "dailyRealizedStatus": "UNVERIFIED",
            "dailyUnrealizedStatus": "UNVERIFIED",
            "feesAndCashFlowReconciled": False,
            "profitableDayVerified": False,
            "reason": "GitHub public ledgers do not contain authoritative daily Robinhood statements, broker fills and mark-to-market valuation. No real-money conclusion is permitted."
        },
        "latestPaperDay": {
            "session": latest,
            "profitableStrategies": profitable_models,
            "losingStrategies": losing_models,
            "strategiesWithNoClosedTrades": no_closes,
            "outcomesArePerStrategyNotAnAggregateAccountPnl": True,
        },
        "strategyClosingPerformance": summaries,
        "alerts": alerts,
        "riskGuidance": {
            "automaticNewLiveStrategyPromotion": False,
            "forceTradesToHitDailyTarget": False,
            "increaseSizeAfterLoss": False,
            "chaseLosses": False,
            "existingLiveHoldingsOrExitRulesModified": False,
            "action": "HOLD_UNAPPROVED_NEW_LIVE_RISK_AND_KEEP_TESTING",
        },
        "limitations": [
            "No-trade/no-close days are not profitable days.",
            "Only CLOSED paper positions are counted; open-position daily gains or losses are not valued.",
            "Paper trades in separate strategies are correlated, not combined as a real portfolio.",
            "Realized closed-trade P&L differs from total daily account return including unrealized moves.",
            "A positive model result is not broker-executable and no trading system can guarantee daily profits.",
        ],
    }


def main():
    state = read_json(STATE)
    score = read_json(SCORE)
    if not state or not score:
        raise SystemExit("::error::Missing paper tournament evidence; no daily profit report published")
    # Independent accounting validation must pass before derived daily metrics.
    validate(state, score)
    report = build(state, score, datetime.now(timezone.utc))
    DEST.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    result = report["latestPaperDay"]
    print(json.dumps({
        "session": result["session"],
        "paperProfitable": result["profitableStrategies"],
        "paperLosing": result["losingStrategies"],
        "brokerVerified": False, "sourceStatus": report["paperSourceStatus"],
    }))
    if result["losingStrategies"]:
        print("::warning::One or more paper strategies lost money after costs; no new live risk authorized")
    if report["paperSourceStatus"] == "STALE":
        print("::warning::Paper evidence stale; do not interpret as today's performance")


if __name__ == "__main__":
    main()
