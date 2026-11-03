#!/usr/bin/env python3
"""Crypto PAPER desk, 24/7 (runs inside the free hourly signal workflow; no Claude usage, no orders).

Two pretend-money strategies on the hourly scan, $15 per trade, one coin at a time each, with the
measured Robinhood round-trip cost (1.9%) charged on every trade:
  rules     the live crypto rules (every filter must pass)
  nofilter  same entry setup but IGNORING the market risk-off and cost/edge filters
Exits: stop at entry - 2 ATR, target at entry + 3 ATR, or the trend exit (close below EMA50).
Writes docs/data/claudebot-crypto-paper.json.
"""
import json, os
from datetime import datetime, timezone
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIG = os.path.join(ROOT, "docs", "data", "claudebot-signal.json")
OUT = os.path.join(ROOT, "docs", "data", "claudebot-crypto-paper.json")
USD, COST = 15.0, 0.019
NAMES = {"rules": "Crypto, live rules (paper)", "nofilter": "Crypto, no filters (paper)"}
FILTERS = ("market risk-off", "this rule lost money")


def wants(kind, c):
    if kind == "rules":
        return bool(c.get("setup"))
    b = c.get("blockers") or []
    return bool(c.get("setup")) or (bool(b) and all(x.startswith(FILTERS) for x in b))


def main():
    sig = json.load(open(SIG))
    try:
        led = json.load(open(OUT))
    except Exception:  # noqa: BLE001
        led = {"schemaVersion": 1, "mode": "paper", "note": "PAPER ONLY crypto desk, every hour around the clock in GitHub Actions. $15 pretend trades, 1.9% Robinhood round-trip cost charged.",
               "strategies": {k: {"name": v, "open": None, "trades": []} for k, v in NAMES.items()}, "lastBar": None, "runs": []}
    bar = max(c["barTime"] for c in sig["coins"])
    if led.get("lastBar") == bar:
        print("bar already processed"); return
    coins = {c["symbol"]: c for c in sig["coins"]}; made = []
    for k, st in led["strategies"].items():
        o = st.get("open")
        if o:
            c = coins.get(o["symbol"])
            if c:
                px = c["lastClose"]; why = "stop" if px <= o["stop"] else "target" if px >= o["target"] else "trend exit" if c.get("exitSignal") else None
                if why:
                    ret = px / o["entry"] - 1 - COST
                    st["trades"].append({"symbol": o["symbol"], "in": o["at"], "out": bar, "entry": o["entry"], "exit": px, "retPct": round(100 * ret, 2), "pnlUsd": round(USD * ret, 3), "why": why})
                    st["open"] = None; made.append(f"{NAMES[k]} sold {o['symbol']} {100 * ret:+.1f}%")
        if not st.get("open"):
            cands = sorted((c for c in sig["coins"] if wants(k, c)), key=lambda c: -(c.get("score") or 0))
            if cands:
                c = cands[0]; px = c["lastClose"]
                st["open"] = {"symbol": c["symbol"], "at": bar, "entry": px, "stop": c["plan"]["refStop"], "target": c["plan"]["refTarget"]}
                made.append(f"{NAMES[k]} bought {c['symbol']}")
    lb = []
    for k, st in led["strategies"].items():
        t = st["trades"]; w = [x["pnlUsd"] for x in t if x["pnlUsd"] > 0]; l = [x["pnlUsd"] for x in t if x["pnlUsd"] <= 0]
        lb.append({"id": k, "name": st["name"], "trades": len(t), "wins": len(w), "winRatePct": round(100 * len(w) / len(t), 1) if t else None,
                   "pnlUsd": round(sum(w) + sum(l), 2), "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, "open": st["open"]["symbol"] if st.get("open") else None})
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    led.update(lastBar=bar, leaderboard=lb, updatedAt=now)
    led["runs"] = (led.get("runs", []) + [{"t": now, "action": "paper-hour", "detail": ", ".join(made) or "no change"}])[-80:]
    json.dump(led, open(OUT, "w"), indent=1)
    print(led["runs"][-1]["detail"])


if __name__ == "__main__":
    main()
