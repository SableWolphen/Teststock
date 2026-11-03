#!/usr/bin/env python3
"""Board standing order (2026-11-02): "when something proves itself, add it."

Runs after the second-edge paper desk (GitHub Actions, free). Switches a paper-proven edge ON in the
live Dip desk (claudebot/dip_config.json "edges") and switches it OFF again if it loses live.
  Promote when ALL hold: >= 20 closed paper trades over >= 15 trading days, win rate >= 60%,
  profit factor >= 1.3, average >= +0.15% per trade, and the latest unseen-data backtest
  (claudebot-edge-research.json) still calls it an edge.
  Roll back when its LIVE trades (dip ledger, rule = edge) reach 10 with profit factor < 1.0.
Never changes sizes, stops or caps: a promoted edge trades inside the Dip desk's existing limits.
"""
import json, os, sys
from datetime import datetime, timezone
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = os.path.join(ROOT, "claudebot", "dip_config.json")
L = lambda n: json.load(open(os.path.join(ROOT, "docs", "data", n))) if os.path.exists(os.path.join(ROOT, "docs", "data", n)) else {}
MIN_TRADES, MIN_DAYS, MIN_WIN, MIN_PF, MIN_AVG, RB_TRADES = 20, 15, 60.0, 1.3, 0.15, 10


def pf(xs):
    w = sum(x for x in xs if x > 0); l = -sum(x for x in xs if x <= 0)
    return w / l if l > 0 else (99.0 if w > 0 else 0.0)


def run(cfg, paper, research, live, now):
    out = []
    for k, er in (cfg.get("edges") or {}).items():
        t = ((paper.get("strategies") or {}).get(k) or {}).get("trades", [])
        days = len({x["out"] for x in t})
        live_t = [x for x in live.get("trades", []) if x.get("rule") == k]
        if er.get("enabled"):
            if len(live_t) >= RB_TRADES and pf([x["pnlUsd"] for x in live_t]) < 1.0:
                er["enabled"] = False; er["rolledBackAt"] = now
                cfg.setdefault("changeLog", []).append(f"{now[:10]}: auto-rollback: {er.get('name', k)} switched OFF (live PF {pf([x['pnlUsd'] for x in live_t]):.2f} over {len(live_t)} trades).")
                out.append(("rollback", k))
            continue
        if er.get("rolledBackAt"):
            continue                                    # once rolled back, only the board can switch it on again
        verdict = ((research.get("strategies") or {}).get(k) or {}).get("verdict")
        n = len(t); win = 100 * sum(1 for x in t if x["pnlUsd"] > 0) / n if n else 0
        avg = sum(x["retPct"] for x in t) / n if n else 0; p = pf([x["pnlUsd"] for x in t])
        if n >= MIN_TRADES and days >= MIN_DAYS and win >= MIN_WIN and p >= MIN_PF and avg >= MIN_AVG and verdict == "edge":
            er["enabled"] = True
            er["promotion"] = {"at": now, "paperTrades": n, "paperDays": days, "winRatePct": round(win, 1), "profitFactor": round(p, 2), "avgPct": round(avg, 3), "researchVerdict": verdict}
            cfg.setdefault("changeLog", []).append(f"{now[:10]}: auto-promoted {er.get('name', k)} to LIVE (paper: {n} trades, {win:.0f}% wins, PF {p:.2f}, avg {avg:+.2f}%).")
            out.append(("promote", k))
        else:
            out.append(("wait", k, f"{n}/{MIN_TRADES} trades, {win:.0f}% wins, PF {p:.2f}, avg {avg:+.2f}%, research {verdict}"))
    return out


if __name__ == "__main__":
    cfg = json.load(open(CFG)); now = datetime.now(timezone.utc).isoformat()
    res = run(cfg, L("claudebot-edge-paper.json"), L("claudebot-edge-research.json"), L("claudebot-dip-ledger.json"), now)
    if any(r[0] in ("promote", "rollback") for r in res):
        json.dump(cfg, open(CFG, "w"), indent=2); open(CFG, "a").write("\n")
    print(json.dumps(res))
