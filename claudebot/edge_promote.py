#!/usr/bin/env python3
"""Paper-first AUTOMATIC edge promotion (board order 2026-11-05: "Restore automatic. Everything
must be automatic").

An ETF edge switches ON in the live Dip desk automatically once its paper evidence passes EVERY
check below, using only executable paper fills (signal at the close, filled at the next session's
open). The board's standing approval is recorded on the edge (boardApproval.approvalId). The live
desk then trades it inside the existing caps and the independent risk governor. Auto-rollback: an
edge with 10+ live trades and profit factor < 1.0 switches OFF and stays off until re-proven.
No broker orders are placed here.
"""
import json, os, sys, random
from datetime import datetime, timezone
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = os.path.join(ROOT, "claudebot", "dip_config.json")
L = lambda n: json.load(open(os.path.join(ROOT, "docs", "data", n))) if os.path.exists(os.path.join(ROOT, "docs", "data", n)) else {}
MIN_TRADES, MIN_DAYS, MIN_WIN, MIN_PF, MIN_AVG, RB_TRADES = 30, 20, 60.0, 1.3, 0.15, 10
APPROVAL = "board-standing-order-2026-11-05-automatic-promotion"
EXTRA_COST_PER_USD = 0.0006  # an additional 0.03% per side for doubled modeled trading costs


def pf(xs):
    w = sum(x for x in xs if x > 0); l = -sum(x for x in xs if x <= 0)
    return w / l if l > 0 else (99.0 if w > 0 else 0.0)


def lower95_mean(values):
    """Deterministic bootstrap lower 95% confidence bound on forward trade P&L."""
    if len(values) < 20:
        return None
    rng = random.Random(1103)
    means = sorted(sum(rng.choice(values) for _ in values) / len(values) for _ in range(2000))
    return round(means[49], 4)


def evidence(kind, trades, paper, research):
    """Only independent, realistic, after-cost observations qualify for review."""
    independent = {}
    if paper.get("executionModel") == "next_session_executable":
        trades = [t for t in trades if t.get("fill", "next_open") == "next_open"]   # close-marked trades don't count
    for t in trades:
        key = (t.get("symbol"), t.get("in"))
        if all(key) and key not in independent:
            independent[key] = t
    samples = list(independent.values())
    vals = [float(t["pnlUsd"]) for t in samples]
    n = len(samples)
    sessions = len({t["in"] for t in samples})
    win = 100 * sum(v > 0 for v in vals) / n if n else 0.0
    avg = sum(float(t["retPct"]) for t in samples) / n if n else 0.0
    factor = pf(vals)
    lower = lower95_mean(vals)
    extra = sum(float(t.get("entryUsd", 25)) * EXTRA_COST_PER_USD for t in samples)
    stressed = round(sum(vals) - extra, 3)
    hist = ((research.get("strategies") or {}).get(kind) or {})
    tested = ((hist.get("chosenOnTrain") or {}).get("test") or {})
    realistic = paper.get("executionModel") == "next_session_executable"
    checks = {
        "independent_forward_trades": n >= MIN_TRADES,
        "forward_sessions": sessions >= MIN_DAYS,
        "forward_win_rate": win >= MIN_WIN,
        "forward_profit_factor": factor >= MIN_PF,
        "forward_avg_return": avg >= MIN_AVG,
        "forward_lower95_positive": lower is not None and lower > 0,
        "doubled_cost_profit_positive": stressed > 0,
        "unseen_historical_trades": int(tested.get("trades") or 0) >= 100,
        "unseen_avg_positive": float(tested.get("avgTradePct") or 0) > 0,
        "unseen_profit_factor": float(tested.get("profitFactor") or 0) >= 1.2,
        "unseen_research_verdict": hist.get("verdict") == "edge",
        "executable_paper_prices": realistic,
    }
    return {
        "closedTrades": len(trades), "independentEntries": n, "sessions": sessions,
        "winRatePct": round(win, 1), "profitFactor": round(factor, 3),
        "avgReturnPct": round(avg, 3), "lower95MeanUsd": lower,
        "netPnlWithDoubledCostsUsd": stressed,
        "executionModel": paper.get("executionModel", "UNVERIFIED_CLOSE_MARK"),
        "checks": checks, "allPassed": all(checks.values()),
        "disposition": "PROMOTE" if all(checks.values()) else "KEEP_PAPER",
    }


def run(cfg, paper, research, live, now):
    out = []
    for k, er in (cfg.get("edges") or {}).items():
        t = ((paper.get("strategies") or {}).get(k) or {}).get("trades", [])
        live_t = [x for x in live.get("trades", []) if x.get("rule") == k]
        if er.get("enabled"):
            if len(live_t) >= RB_TRADES and pf([x["pnlUsd"] for x in live_t]) < 1.0:
                er["enabled"] = False
                er["rolledBackAt"] = now
                cfg.setdefault("changeLog", []).append(
                    f"{now[:10]}: auto-rollback: {er.get('name', k)} switched OFF after live losses.")
                out.append(("rollback", k, "Loss threshold reached; defensive disable only"))
            else:
                out.append(("already_live", k, "Existing authorization unchanged"))
            continue
        if er.get("rolledBackAt"):
            out.append(("rolled_back", k, "Requires separate board review"))
            continue
        report = evidence(k, t, paper, research)
        if report["allPassed"]:
            er["enabled"] = True
            er["promotedAt"] = now
            er["boardApproval"] = {"approvalId": APPROVAL, "by": "board standing order (2026-11-02, restored 2026-11-05)",
                                   "evidence": {x: report[x] for x in ("independentEntries", "sessions", "winRatePct", "profitFactor", "avgReturnPct", "lower95MeanUsd")}}
            cfg.setdefault("changeLog", []).append(f"{now[:10]}: auto-promoted {er.get('name', k)} on executable paper evidence "
                                                   f"({report['independentEntries']} trades, {report['winRatePct']}% wins, PF {report['profitFactor']}).")
            out.append(("promote", k, report))
        else:
            out.append(("paper_only", k, report))
    return out

if __name__ == "__main__":
    cfg = json.load(open(CFG))
    now = datetime.now(timezone.utc).isoformat()
    res = run(cfg, L("claudebot-edge-paper.json"), L("claudebot-edge-research.json"),
              L("claudebot-dip-ledger.json"), now)
    if any(r[0] in ("rollback", "promote") for r in res):
        with open(CFG, "w") as f:
            json.dump(cfg, f, indent=2)
            f.write("\n")
    public_report = {
        "generatedAt": now, "mode": "AUTOMATIC_PROMOTION",
        "automaticLivePromotion": True,
        "strategies": {r[1]: {"status": r[0], "evidence": r[2]} for r in res},
        "rule": f"Switches ON automatically when every check passes ({MIN_TRADES}+ executable paper trades over {MIN_DAYS}+ sessions, {MIN_WIN}%+ wins, PF {MIN_PF}+, bootstrap lower bound > 0, profitable with doubled costs, and an unseen-data research edge). Auto-rollback after {RB_TRADES}+ live trades with PF < 1.0."
    }
    with open(os.path.join(ROOT, "docs", "data", "claudebot-edge-readiness.json"), "w") as f:
        json.dump(public_report, f, indent=2)
        f.write("\n")
    print(json.dumps(res))
