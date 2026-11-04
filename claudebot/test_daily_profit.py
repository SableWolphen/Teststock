"""Deterministic daily-profit truthfulness and fail-closed regression tests."""
from __future__ import annotations

import copy
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from daily_profit import build
from tournament import new_state, build_report
from tournament_audit import validate

now = datetime(2026, 11, 5, 23, 50, tzinfo=timezone.utc)

with tempfile.TemporaryDirectory() as d:
    data = Path(d)
    state = new_state()
    state["lastProcessedDay"] = "2026-11-03"
    state["observedSessions"] = ["2026-11-03"]
    score = build_report(state, data, datetime(2026, 11, 3, 23, 50, tzinfo=timezone.utc))
    assert validate(state, score)
    # No closing fills does not imply that real money has been made.
    out = build(state, score, datetime(2026, 11, 3, 23, 55, tzinfo=timezone.utc))
    assert out["actualBroker"]["profitableDayVerified"] is False
    assert out["actualBroker"]["dailyRealizedStatus"] == "UNVERIFIED"
    assert out["latestPaperDay"]["profitableStrategies"] == []
    assert all(x["latestClosingSession"]["status"] == "NO_CLOSED_TRADES"
               for x in out["strategyClosingPerformance"])
    assert not out["riskGuidance"]["forceTradesToHitDailyTarget"]
    assert not out["riskGuidance"]["automaticNewLiveStrategyPromotion"]
    assert out["strategyClosingPerformance"][0]["profitablePctOfAllObservedSessions"] == 0

    def trade(symbol, exit_price):
        op = 100.0
        enter = op * (1 + .0014)
        qty = 25 / enter
        leave = exit_price * (1 - .0014)
        gross = qty * (exit_price - op)
        net = qty * (leave - enter) - .01
        friction = gross - net
        return {"symbol": symbol,
                "entrySignalDay": "2026-11-03", "entryDay": "2026-11-04",
                "exitDay": "2026-11-05", "entryOpenRaw": op,
                "entryFill": round(enter, 5), "exitReference": exit_price,
                "exitFill": round(leave, 5),
                "qty": round(qty, 8), "entryNotionalUsd": 25,
                "grossPnlUsd": round(gross, 6),
                "frictionUsd": round(friction, 6),
                "netPnlUsd": round(net, 6),
                "stressedNetUsd": round(gross - 2 * friction, 6),
                "netReturnPct": round(100 * net / 25, 4),
                "why": "next open"}

    state["lastProcessedDay"] = "2026-11-05"
    state["observedSessions"] = ["2026-11-03", "2026-11-04", "2026-11-05"]
    state["strategies"]["down3"]["trades"].append(trade("XLK", 104))
    state["strategies"]["double7"]["trades"].append(trade("QQQ", 97))
    score = build_report(state, data, now)
    assert validate(state, score)
    out = build(state, score, now)
    assert out["actualBroker"]["profitableDayVerified"] is False
    assert out["latestPaperDay"]["profitableStrategies"] == ["down3"]
    assert out["latestPaperDay"]["losingStrategies"] == ["double7"]
    assert out["latestPaperDay"]["strategiesWithNoClosedTrades"] == ["dipwide"]
    assert "PAPER_LOSING_STRATEGY_DAY" in out["alerts"]
    assert "BROKER_DAILY_PROFIT_NOT_VERIFIED" in out["alerts"]
    by_id = {s["id"]: s for s in out["strategyClosingPerformance"]}
    assert by_id["down3"]["profitablePctOfAllObservedSessions"] == 33.3
    assert by_id["down3"]["profitablePctOfSessionsWithCloses"] == 100
    assert by_id["double7"]["netClosedPaperUsd"] < 0
    assert by_id["double7"]["needsPaperReview"] is True
    assert by_id["dipwide"]["latestClosingSession"]["status"] == "NO_CLOSED_TRADES"

    # Stale reports get warnings, not fictional daily trading wins.
    stale = build(state, score, now + timedelta(days=4))
    assert stale["paperSourceStatus"] == "STALE"
    assert "PAPER_SOURCE_STALE" in stale["alerts"]
    try:
        build(state, {**score, "brokerVerified": True}, now)
        raise AssertionError("Unverified broker claim passed")
    except ValueError:
        pass
    bad_state = copy.deepcopy(state)
    bad_state["observedSessions"].append("2026-11-05")
    try:
        validate(bad_state, score)
        raise AssertionError("Duplicate sessions passed")
    except ValueError:
        pass
    try:
        build(state, {**score, "lastProcessedDay": "2026-11-04"}, now)
        raise AssertionError("Source mismatch passed")
    except ValueError:
        pass

print("daily broker/unrealized truthfulness, realized-only sessions, losing-day flags and no-live rules passed")
