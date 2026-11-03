"""Offline verification for public research decision scorecard."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from decision_scorecard import build, trade_key, drawdown_usd  # noqa: E402

sample = {
    "day": "2026-11-03",
    "symbol": "SOFI261120C00017500",
    "boughtAt": "2026-11-03T17:00:00Z",
    "exitAt": "2026-11-03T17:30:00Z",
    "pnlUsd": -6.10,
}
assert trade_key(sample) == trade_key({**sample, "strategy": "another"})
assert drawdown_usd([sample]) == -6.10

snap = {
    "updatedAt": "2026-11-03T20:00:00Z",
    "strategies": {
        "a": {"trades": [sample]},
        "b": {"trades": [{**sample}]},
        "c": {"trades": []},
    },
    "leaderboard": [{"id": "a", "pnlDoubleCostUsd": -8.1},
                    {"id": "b", "pnlDoubleCostUsd": -8.1}],
}
dip = {"mode": "live", "positions": [{"symbol": "XLK", "entryPrice": 174.68}], "trades": []}
backtest = {"generatedAt": "2026-11-03T01:00:00Z",
            "chosenOnTrain": {"test": {"trades": 41, "avgTradePct": 1.003, "profitFactor": 6.34}}}
report = build(snap, dip, backtest)
paper = report["optionsPaper"]
assert paper["completedVariantTrades"] == 2
assert paper["distinctUnderlyingEntryOpportunities"] == 1, paper
assert paper["sessions"] == 1
assert paper["candidateCount"] == 3
assert report["decision"] == "NO_NEW_OPTIONS_RISK"
assert paper["readyForLiveWithoutFurtherApproval"] is False
assert report["dip"]["brokerVerified"] is False
assert report["dip"]["completedPublicLedgerTrades"] == 0
assert report["dip"]["reportedOpenPositionCount"] == 1
assert "account_number" not in str(report).lower()
assert "87.97" not in str(report)

empty = build({}, {}, {})
assert empty["decision"] == "NO_NEW_OPTIONS_RISK"
assert empty["optionsPaper"]["distinctUnderlyingEntryOpportunities"] == 0
print("decision scorecard tests passed")
