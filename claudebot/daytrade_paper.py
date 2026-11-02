#!/usr/bin/env python3
"""ClaudeBot Day-trade desk (PAPER ONLY): replays each trading day on real 5-minute bars.

At the 2:44 PM CT run (after every trade's 15:40 ET exit), it takes today's actual 5-minute bars
for our ETFs and runs the four day-trading strategies from daytrade_backtest.py, each at the
settings that did best on 2023-24 history. Every signal is recorded as a $25 pretend trade.
It never places, cancels or changes a real order. Going live needs the board's approval, and the
evidence: 20+ paper trades that beat costs plus the historical test (claudebot-daytrade-backtest.json).

  python claudebot/daytrade_paper.py run bars.json      -> records today (once per day)
  python claudebot/daytrade_paper.py show               -> prints the leaderboard

bars.json: {"date": "2026-11-02", "prevClose": {"SPY": 755.72, ...},
            "results": [{"symbol": "SPY", "bars": [{"begins_at", "open_price", "high_price", "low_price", "close_price", "volume"}, ...]}]}
(the Robinhood get_equity_historicals result as-is, plus date and prevClose), or
            "symbols": {"SPY": {"prevClose": 755.72, "bars": [{"t", "o", "h", "l", "c", "v"}]}}
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LEDGER = os.path.join(ROOT, "docs", "data", "claudebot-daytrade-paper.json")
BT = os.path.join(ROOT, "docs", "data", "claudebot-daytrade-backtest.json")
POSITION_USD = 25.0
_sp = importlib.util.spec_from_file_location("dtb", os.path.join(HERE, "daytrade_backtest.py"))
dtb = importlib.util.module_from_spec(_sp); _sp.loader.exec_module(dtb)
DEFAULTS = {"orb": {"mins": 30, "r": 2.0}, "gap": {"gap": 1.0, "stop": 1.0}, "vwap": {"k": 0.5}, "mom": {"m": 0.6}}


def load(p, d=None):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return d


def settings():
    """Each strategy at its best 2023-24 (train) settings; defaults until the backtest has run."""
    bt = load(BT) or {}
    out = {k: {"params": v, "source": "default"} for k, v in DEFAULTS.items()}
    for r in bt.get("all", []):
        st = r["strategy"]
        if r["train"].get("trades", 0) >= 100 and (out[st]["source"] == "default" or r["train"]["avgTradePct"] > out[st]["trainAvg"]):
            out[st] = {"params": r["params"], "source": "history", "trainAvg": r["train"]["avgTradePct"], "testAvg": r["test"].get("avgTradePct")}
    return out


def parse(inp):
    def bar(b):
        if "begins_at" in b:
            return {"t": datetime.fromisoformat(b["begins_at"].replace("Z", "+00:00")), "o": float(b["open_price"]), "h": float(b["high_price"]),
                    "l": float(b["low_price"]), "c": float(b["close_price"]), "v": float(b.get("volume") or 0)}
        return {"t": datetime.fromisoformat(str(b["t"]).replace("Z", "+00:00")), "o": float(b["o"]), "h": float(b["h"]), "l": float(b["l"]), "c": float(b["c"]), "v": float(b.get("v") or 0)}
    syms = {}
    pc = inp.get("prevClose") or {}
    for r in (inp.get("data") or {}).get("results") or inp.get("results") or []:
        syms[r["symbol"]] = {"prevClose": pc.get(r["symbol"]), "bars": [bar(b) for b in r.get("bars") or []]}
    for s, v in (inp.get("symbols") or {}).items():
        syms[s] = {"prevClose": v.get("prevClose", pc.get(s)), "bars": [bar(b) for b in v["bars"]]}
    for v in syms.values():
        v["bars"] = sorted((b for b in v["bars"] if b["t"].astimezone(dtb.ET).date().isoformat() == inp["date"]), key=lambda b: b["t"])
    return syms


def stats(trades):
    n = len(trades)
    w = [t["pnlUsd"] for t in trades if t["pnlUsd"] > 0]; l = [t["pnlUsd"] for t in trades if t["pnlUsd"] <= 0]
    return {"trades": n, "wins": len(w), "pnlUsd": round(sum(w) + sum(l), 2), "avgPct": round(sum(t["retPct"] for t in trades) / n, 3) if n else None,
            "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None}


def run(inp, led, now=None):
    now = now or datetime.now(timezone.utc)
    day = inp["date"]
    if day in led.get("days", []):
        return {"status": "skip", "detail": f"{day} already recorded"}
    syms = parse(inp)
    complete = [s for s, v in syms.items() if v["bars"] and dtb.hm(v["bars"][-1]) >= dtb.EXIT_HM[0] * 60 + dtb.EXIT_HM[1]]
    if not complete:
        return {"status": "wait", "detail": "today's bars don't reach 15:40 ET yet; run again at the 2:44 PM CT check"}
    cfg = settings()
    led.setdefault("strategies", {})
    made = []
    for st, c in cfg.items():
        S = led["strategies"].setdefault(st, {"name": dtb.NAMES[st], "trades": []})
        S["params"], S["source"] = c["params"], c["source"]
        for sym in complete:
            t = dtb.simulate(st, c["params"], syms[sym]["bars"], syms[sym]["prevClose"])
            if t:
                rec = {"day": day, "symbol": sym, "entryT": t["entryT"], "entry": t["entry"], "exit": t["exit"], "retPct": round(100 * t["ret"], 3),
                       "pnlUsd": round(POSITION_USD * t["ret"], 3), "reason": t["reason"], "why": t["why"]}
                S["trades"].append(rec); made.append(f"{dtb.NAMES[st]} {sym} {rec['retPct']:+.2f}%")
        S["stats"] = stats(S["trades"])
    led["days"] = (led.get("days", []) + [day])[-400:]
    led["updatedAt"] = now.isoformat().replace("+00:00", "Z")
    led["leaderboard"] = sorted(({"id": k, "name": v["name"], **v["stats"]} for k, v in led["strategies"].items()), key=lambda r: -(r["pnlUsd"] or 0))
    bt = load(BT) or {}
    led["history"] = {"verdict": bt.get("verdict", "not run yet"), "text": bt.get("verdictText", ""), "baselineTest": (bt.get("baseline") or {}).get("test")}
    led.setdefault("runs", []).append({"t": led["updatedAt"], "action": "paper-day", "detail": f"{day}: {len(made)} paper trades" + (": " + ", ".join(made[:6]) if made else " (no signals)")})
    led["runs"] = led["runs"][-60:]
    return {"status": "ok", "detail": led["runs"][-1]["detail"]}


def main(argv=None):
    argv = argv or sys.argv[1:]
    led = load(LEDGER) or {"schemaVersion": 1, "mode": "paper", "note": "PAPER ONLY day-trade desk: $25 pretend trades replayed on real 5-minute bars. Never trades real money. Live needs board approval.",
                           "positionUsd": POSITION_USD, "days": [], "strategies": {}, "runs": []}
    if argv[0] == "run":
        out = run(load(argv[1]), led)
        if out["status"] == "ok":
            with open(LEDGER, "w") as f:
                json.dump(led, f, indent=1); f.write("\n")
        print(json.dumps(out, indent=1)); return 0
    if argv[0] == "show":
        print(json.dumps(led.get("leaderboard", []), indent=1)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())
