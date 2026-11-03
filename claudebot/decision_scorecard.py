#!/usr/bin/env python3
"""Public, evidence-only Teststock decision scorecard (NO broker access or orders).

Never publishes account balances, order IDs or inferred live profits. Variants
often paper-trade the SAME candidate: shared fills are not independent evidence.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"


def read(name: str) -> dict:
    try:
        obj = json.loads((DATA / name).read_text())
        return obj if isinstance(obj, dict) else {}
    except (OSError, ValueError):
        return {}


def number(value, default=0.0) -> float:
    try:
        val = float(value)
        return val if math.isfinite(val) else default
    except (TypeError, ValueError):
        return default


def trade_key(trade: dict) -> tuple:
    # The strategy ID is intentionally omitted: the same trade repeated across
    # competing variants contributes ONE distinct underlying opportunity.
    return (str(trade.get("day") or ""), str(trade.get("symbol") or ""),
            str(trade.get("boughtAt") or ""))


def drawdown_usd(trades: list) -> float:
    balance = peak = worst = 0.0
    for trade in sorted(trades, key=lambda t: t.get("exitAt") or ""):
        balance += number(trade.get("pnlUsd"))
        peak = max(peak, balance)
        worst = min(worst, balance - peak)
    return round(worst, 2)


def build(options: dict, dip_ledger: dict, dip_backtest: dict) -> dict:
    strategies = options.get("strategies") or {}
    rows = {r.get("id"): r for r in options.get("leaderboard") or []}
    variants = []
    opportunities = set()
    all_sessions = set()
    for name, state in sorted(strategies.items()):
        trades = state.get("trades") or []
        opportunities.update(trade_key(t) for t in trades)
        all_sessions.update(str(t.get("day")) for t in trades if t.get("day"))
        row = rows.get(name) or {}
        total = round(sum(number(t.get("pnlUsd")) for t in trades), 2)
        distinct = len({trade_key(t) for t in trades})
        net_positive = bool(trades) and total > 0
        variants.append({
            "id": name,
            "closedTrades": len(trades),
            "distinctEntries": distinct,
            "sessions": len({t.get("day") for t in trades if t.get("day")}),
            "netPaperUsd": total,
            "avgPaperUsd": round(total / len(trades), 2) if trades else None,
            "profitFactor": row.get("profitFactor"),
            "worstPaperDrawdownUsd": drawdown_usd(trades),
            "bootstrapLower95Usd": row.get("avgLow95Usd"),
            "doubledCostPaperUsd": row.get("pnlDoubleCostUsd"),
            "paperGatePassed": bool(row.get("paperGatePassed")),
            "historicalNbboGatePassed": bool(row.get("historicalGatePassed")),
            "boardProposal": bool(row.get("boardProposal")),
            "verdict": ("RETIRED" if row.get("retired") or state.get("retired") else
                        "NEGATIVE" if trades and not net_positive else
                        "INSUFFICIENT_EVIDENCE"),
        })
    benchmark = (dip_backtest.get("chosenOnTrain") or {}).get("test") or {}
    open_positions = dip_ledger.get("positions")
    if open_positions is None:
        open_positions = [dip_ledger["open"]] if dip_ledger.get("open") else []
    total_variant_trades = sum(v["closedTrades"] for v in variants)
    ready = any(v["boardProposal"] for v in variants)
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "scope": "PUBLIC_RESEARCH_NOT_BROKER_EXECUTION",
        "decision": "REVIEW_ONLY" if ready else "NO_NEW_OPTIONS_RISK",
        "reason": ("An evidence-ready strategy requires separate explicit approval and "
                   "broker-side protection tests." if ready else
                   "No options variant has verified both forward paper and historical executable-NBBO gates."),
        "dip": {
            "reportedMode": dip_ledger.get("mode", "unknown"),
            "completedPublicLedgerTrades": len(dip_ledger.get("trades") or []),
            "reportedOpenPositionCount": len(open_positions),
            "brokerVerified": False,
            "backtest": {
                "sourceGeneratedAt": dip_backtest.get("generatedAt"),
                "unseenTrades": benchmark.get("trades"),
                "unseenAvgTradePct": benchmark.get("avgTradePct"),
                "unseenProfitFactor": benchmark.get("profitFactor"),
            },
        },
        "optionsPaper": {
            "sourceUpdatedAt": options.get("updatedAt"),
            "completedVariantTrades": total_variant_trades,
            "distinctUnderlyingEntryOpportunities": len(opportunities),
            "sessions": len(all_sessions),
            "independenceWarning": "Variants often reuse an identical contract, entry and market event; their results are correlated, NOT independent trade samples.",
            "historicalRequirement": "100+ independent unseen trades with point-in-time executable option NBBO; positive net expectancy after doubled costs.",
            "forwardRequirement": "50+ closed trades across 30+ sessions, PF>1.2 and bootstrap 95% lower mean > $0.",
            "candidateCount": len(variants),
            "variants": sorted(variants, key=lambda x: (-x["netPaperUsd"], x["id"])),
            "readyForLiveWithoutFurtherApproval": False,
        },
        "disclaimer": "Backtests and paper fills are not verified broker profits or guarantees. No automatic live strategy changes.",
    }


def main() -> None:
    result = build(read("claudebot-optscalp-paper.json"),
                   read("claudebot-dip-ledger.json"),
                   read("claudebot-dip-backtest.json"))
    out = DATA / "claudebot-decision-scorecard.json"
    out.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"decision": result["decision"],
                      "distinct": result["optionsPaper"]["distinctUnderlyingEntryOpportunities"],
                      "variantTrades": result["optionsPaper"]["completedVariantTrades"]}))


if __name__ == "__main__":
    main()
