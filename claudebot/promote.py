#!/usr/bin/env python3
"""CEO auto-approval: promote a proven Paper Lab strategy into the live options rules,
and roll it back automatically if it stops working live.

Board policy (2026-11-02): the CEO approves employee research automatically when the
evidence is there. Guardrails:
  - Only parameter variants can be auto-promoted (delta, min credit, take profit, stop).
    Strategies that REMOVE a safety rule (event pauses, crypto filters) still need the board.
  - Evidence: >= 20 closed paper trades, profit factor >= 1.3, average P&L > 0 and better
    than the Mirror strategy (live rules on paper) over the same period.
  - Only when no live spread is open, and at most one promotion every 14 days.
  - Hard limits (audit.py LIMITS) can never be exceeded.
  - Automatic rollback if the promoted rules lose live: after >= 10 live trades with
    profit factor < 1.0, the previous rules come back.

  python claudebot/promote.py          -> prints what it did (promote / rollback / nothing)
"""
from __future__ import annotations

import copy
import json
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CFG = os.path.join(HERE, "options_config.json")
PAPER = os.path.join(ROOT, "docs", "data", "claudebot-paper-ledger.json")
LIVE = os.path.join(ROOT, "docs", "data", "claudebot-options-ledger.json")

AUTO_PROMOTABLE = {"safe", "aggr", "tight"}            # parameter variants only
BOARD_ONLY = {"nopause": "removes the event-day pause", "cryraw": "removes the crypto risk and cost filters"}
ALLOWED_KEYS = {("entry", "maxShortDelta"), ("entry", "minCreditUsd"), ("exit", "takeProfitPctOfCredit"), ("exit", "stopAtMultipleOfCredit")}
HARD = {("entry", "maxShortDelta"): (0.10, 0.30), ("entry", "minCreditUsd"): (0.08, 0.50),
        ("exit", "takeProfitPctOfCredit"): (30, 80), ("exit", "stopAtMultipleOfCredit"): (1.5, 3.5)}
MIN_TRADES, MIN_PF, COOLDOWN_DAYS, ROLLBACK_TRADES = 20, 1.3, 14, 10


def load(p, d=None):
    try:
        return json.load(open(p))
    except Exception:
        return d


def save(p, d):
    with open(p, "w") as f:
        json.dump(d, f, indent=2 if p.endswith("config.json") else 1); f.write("\n")


def stats(trades):
    w = [t["pnlUsd"] for t in trades if t["pnlUsd"] > 0]; l = [t["pnlUsd"] for t in trades if t["pnlUsd"] <= 0]
    n = len(trades)
    return {"trades": n, "avg": (sum(w) + sum(l)) / n if n else 0.0,
            "pf": (sum(w) / -sum(l)) if l and sum(l) < 0 else (99.0 if w else 0.0)}


def overrides_of(strategy_id):
    spec = importlib_paper().STRATEGIES
    return next(s["override"] for s in spec if s["id"] == strategy_id)


def importlib_paper():
    import importlib.util
    sp = importlib.util.spec_from_file_location("pl", os.path.join(HERE, "paper_lab.py"))
    m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m); return m


def flatten(o, prefix=()):
    for k, v in o.items():
        if isinstance(v, dict) and v:
            yield from flatten(v, prefix + (k,))
        else:
            yield prefix + (k,), v


def run(now=None):
    now = now or datetime.now(timezone.utc)
    cfg, paper, live = load(CFG), load(PAPER, {}), load(LIVE, {})
    promo = cfg.get("promotion")
    out = {"action": "none", "detail": ""}

    # ---------- rollback check for an active promotion
    if promo and promo.get("active"):
        since = [t for t in live.get("trades", []) if t["exitedAt"] >= promo["at"]]
        st = stats(since)
        if st["trades"] >= ROLLBACK_TRADES and st["pf"] < 1.0:
            for (sec, key), v in ((tuple(k.split(".")), v) for k, v in promo["previous"].items()):
                cfg[sec][key] = v
            promo["active"] = False; promo["rolledBackAt"] = now.isoformat(); promo["rollbackReason"] = f"live PF {st['pf']:.2f} over {st['trades']} trades"
            cfg.setdefault("changeLog", []).append(f"{now.date()}: CEO rolled back '{promo['strategyName']}' ({promo['rollbackReason']}); previous rules restored.")
            save(CFG, cfg)
            return {"action": "rollback", "detail": f"Rolled back {promo['strategyName']}: {promo['rollbackReason']}. Previous rules restored."}

    # ---------- look for a promotion
    if live.get("open"):
        return {"action": "none", "detail": "live spread open; promotions wait until flat"}
    if promo and datetime.fromisoformat(promo["at"].replace("Z", "+00:00")) > now - timedelta(days=COOLDOWN_DAYS):
        return {"action": "none", "detail": "a promotion happened in the last 14 days"}
    S = paper.get("strategies") or {}
    mirror = stats(S.get("mirror", {}).get("trades", []))
    best = None
    for sid, s in S.items():
        st = stats(s.get("trades", []))
        if st["trades"] < MIN_TRADES or st["pf"] < MIN_PF or st["avg"] <= 0 or st["avg"] <= mirror["avg"]:
            continue
        if sid in BOARD_ONLY:
            out = {"action": "board", "detail": f"'{s['name']}' qualifies ({st['trades']} trades, PF {st['pf']:.2f}) but {BOARD_ONLY[sid]}; needs the board's approval."}
            continue
        if sid not in AUTO_PROMOTABLE:
            continue
        if not best or st["avg"] > best[1]["avg"]:
            best = (sid, st, s)
    if not best:
        return out if out["action"] == "board" else {"action": "none", "detail": "no paper strategy has enough evidence yet"}
    sid, st, s = best
    changes, previous = {}, {}
    for path, v in flatten(overrides_of(sid)):
        if path not in ALLOWED_KEYS:
            return {"action": "none", "detail": f"'{s['name']}' changes {'.'.join(path)}, which is not auto-promotable"}
        lo, hi = HARD[path]
        if not (lo <= v <= hi):
            return {"action": "none", "detail": f"'{s['name']}' sets {'.'.join(path)}={v}, outside hard limits"}
        previous[".".join(path)] = cfg[path[0]].get(path[1]); changes[".".join(path)] = v
        cfg[path[0]][path[1]] = v
    cfg["promotion"] = {"active": True, "strategy": sid, "strategyName": s["name"], "at": now.isoformat(), "evidence": {"paperTrades": st["trades"], "paperPF": round(st["pf"], 2), "paperAvgUsd": round(st["avg"], 2), "mirrorAvgUsd": round(mirror["avg"], 2)},
                        "changes": changes, "previous": previous}
    cfg.setdefault("changeLog", []).append(f"{now.date()}: CEO auto-approved Paper Lab '{s['name']}' for live ({st['trades']} paper trades, PF {st['pf']:.2f}, avg ${st['avg']:.2f} vs Mirror ${mirror['avg']:.2f}): {changes}. Auto-rollback if live PF < 1.0 after {ROLLBACK_TRADES} trades.")
    save(CFG, cfg)
    return {"action": "promote", "detail": f"Approved '{s['name']}' for live trading: {changes} (paper: {st['trades']} trades, PF {st['pf']:.2f}, avg ${st['avg']:.2f}/trade vs live rules ${mirror['avg']:.2f})."}


if __name__ == "__main__":
    print(json.dumps(run(), indent=1))
