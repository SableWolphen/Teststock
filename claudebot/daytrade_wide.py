#!/usr/bin/env python3
"""ClaudeBot market-wide paper lab (PAPER ONLY): replays today on every stock we watch.

After each close, pulls today's real 5-minute bars (Alpaca, IEX feed) for the whole universe
(Dip desk ETFs + options desk scanUniverse, ~120 names) and runs the same four day-trade
strategies as the day-trade desk (daytrade_paper.py settings) on each one. Every signal is a $25
pretend trade. It also records how each stock did today (open->close and vs yesterday's close)
so the desk learns which strategies, stocks and kinds of days work.

Learning (no rule changes; suggestions only, the board approves anything live):
  - per strategy and per strategy+stock: trades, win rate, P&L, profit factor, over all days
  - `promising`: strategy+stock pairs with 20+ paper trades and profit factor >= 1.3
Places no orders and touches no account data. Writes docs/data/claudebot-daytrade-wide.json.

  python claudebot/daytrade_wide.py            # fetch today + record (skips if already done)
  python claudebot/daytrade_wide.py 2026-11-02 # replay a past day
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "docs", "data", "claudebot-daytrade-wide.json")
_s = importlib.util.spec_from_file_location("dtp", os.path.join(HERE, "daytrade_paper.py"))
dtp = importlib.util.module_from_spec(_s); _s.loader.exec_module(dtp)
dtb = dtp.dtb
POSITION_USD = dtp.POSITION_USD
KEEP_TRADES_DAYS = 30          # detailed trades kept; aggregate stats keep everything


def universe():
    ob = json.load(open(os.path.join(HERE, "optbuy_config.json")))
    dc = json.load(open(os.path.join(HERE, "dip_config.json")))
    seen, out = set(), []
    for s in dc["symbols"] + ob["symbols"] + ob.get("scanUniverse", []):
        if s not in seen:
            seen.add(s); out.append(s)
    return out


def alpaca(path):
    key, sec = os.environ["ALPACA_API_KEY"], os.environ["ALPACA_API_SECRET"]
    req = urllib.request.Request("https://data.alpaca.markets" + path,
                                 headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": sec, "User-Agent": "teststock"})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def bars_multi(syms, timeframe, start, end):
    out = {}
    for i in range(0, len(syms), 50):
        tok = None
        while True:
            q = (f"/v2/stocks/bars?symbols={','.join(syms[i:i + 50])}&timeframe={timeframe}&start={start}&end={end}"
                 f"&adjustment=split&feed=iex&limit=10000" + (f"&page_token={tok}" if tok else ""))
            d = alpaca(q)
            for s, bs in (d.get("bars") or {}).items():
                out.setdefault(s, []).extend(bs)
            tok = d.get("next_page_token")
            if not tok:
                break
    return out


def fetch(day):
    syms = universe()
    d0 = date.fromisoformat(day)
    intraday = bars_multi(syms, "5Min", f"{day}T13:00:00Z", f"{day}T21:00:00Z")
    daily = bars_multi(syms, "1Day", (d0 - timedelta(days=10)).isoformat(), f"{day}T00:00:00Z")
    out = {"date": day, "symbols": {}}
    for s in syms:
        prev = [b for b in daily.get(s, []) if b["t"][:10] < day]
        if s in intraday and prev:
            out["symbols"][s] = {"prevClose": prev[-1]["c"], "bars": intraday[s]}
    return out


def stats(trades):
    return dtp.stats(trades)


def record(inp, led, now=None):
    now = now or datetime.now(timezone.utc)
    day = inp["date"]
    if day in led.get("days", []):
        return {"status": "skip", "detail": f"{day} already recorded"}
    syms = dtp.parse(inp)
    end = dtb.EXIT_HM[0] * 60 + dtb.EXIT_HM[1]
    complete = {s: v for s, v in syms.items() if v["bars"] and dtb.hm(v["bars"][-1]) >= end and v["prevClose"]}
    if len(complete) < 10:
        return {"status": "wait", "detail": f"only {len(complete)} stocks have a full day of bars"}
    cfg = dtp.settings()
    made, movers = [], []
    agg = led.setdefault("strategies", {})
    pairs = led.setdefault("pairs", {})
    for sym, v in complete.items():
        b = v["bars"]
        movers.append({"symbol": sym, "dayPct": round(100 * (b[-1]["c"] / v["prevClose"] - 1), 2),
                       "openToClosePct": round(100 * (b[-1]["c"] / b[0]["o"] - 1), 2)})
        for st, c in cfg.items():
            t = dtb.simulate(st, c["params"], b, v["prevClose"])
            if not t:
                continue
            rec = {"day": day, "strategy": st, "symbol": sym, "entry": t["entry"], "exit": t["exit"], "retPct": round(100 * t["ret"], 3),
                   "pnlUsd": round(POSITION_USD * t["ret"], 3), "reason": t["reason"]}
            made.append(rec)
            for key, store, name in ((st, agg, dtb.NAMES[st]), (f"{st}|{sym}", pairs, f"{dtb.NAMES[st]} on {sym}")):
                a = store.setdefault(key, {"name": name, "trades": 0, "wins": 0, "gain": 0.0, "loss": 0.0, "retSum": 0.0})
                a["trades"] += 1; a["wins"] += rec["pnlUsd"] > 0; a["retSum"] += rec["retPct"]
                if rec["pnlUsd"] > 0:
                    a["gain"] += rec["pnlUsd"]
                else:
                    a["loss"] += -rec["pnlUsd"]
    def view(a):
        return {"name": a["name"], "trades": a["trades"], "winRatePct": round(100 * a["wins"] / a["trades"], 1) if a["trades"] else None,
                "pnlUsd": round(a["gain"] - a["loss"], 2), "avgPct": round(a["retSum"] / a["trades"], 3) if a["trades"] else None,
                "profitFactor": round(a["gain"] / a["loss"], 2) if a["loss"] > 0 else None}
    movers.sort(key=lambda m: -m["dayPct"])
    today = {"date": day, "stocks": len(complete), "trades": len(made), "byStrategy": {}, "best": sorted(made, key=lambda t: -t["retPct"])[:10],
             "worst": sorted(made, key=lambda t: t["retPct"])[:5], "topMovers": movers[:10], "bottomMovers": movers[-5:][::-1],
             "breadthUpPct": round(100 * sum(m["dayPct"] > 0 for m in movers) / len(movers), 1)}
    for st in cfg:
        today["byStrategy"][st] = {"name": dtb.NAMES[st], **stats([t for t in made if t["strategy"] == st])}
    led["today"] = today
    led["history"] = ([h for h in led.get("history", []) if h["date"] != day] + [{k: today[k] for k in ("date", "stocks", "trades", "breadthUpPct")} |
                      {"pnlUsd": round(sum(t["pnlUsd"] for t in made), 2), "byStrategy": {k: v["pnlUsd"] for k, v in today["byStrategy"].items()}}])[-400:]
    led["leaderboard"] = sorted((view(a) | {"id": k} for k, a in agg.items()), key=lambda r: -(r["pnlUsd"] or 0))
    pv = [view(a) | {"id": k} for k, a in pairs.items()]
    led["promising"] = sorted([p for p in pv if p["trades"] >= 20 and (p["profitFactor"] or 0) >= 1.3], key=lambda r: -(r["profitFactor"] or 0))[:15]
    led["bestPairs"] = sorted([p for p in pv if p["trades"] >= 3], key=lambda r: -(r["pnlUsd"] or 0))[:15]
    led["recentTrades"] = ([t for t in led.get("recentTrades", []) if t["day"] >= (date.fromisoformat(day) - timedelta(days=KEEP_TRADES_DAYS)).isoformat()] + made)[-3000:]
    led["days"] = (led.get("days", []) + [day])[-400:]
    led["updatedAt"] = now.isoformat().replace("+00:00", "Z")
    best = today["best"][0] if made else None
    detail = (f"{day}: {len(complete)} stocks, {len(made)} paper trades, {usd(sum(t['pnlUsd'] for t in made))}"
              + (f"; best {dtb.NAMES[best['strategy']]} on {best['symbol']} {best['retPct']:+.2f}%" if best else "")
              + f"; top mover {movers[0]['symbol']} {movers[0]['dayPct']:+.2f}%")
    led.setdefault("runs", []).append({"t": led["updatedAt"], "action": "paper-day", "detail": detail}); led["runs"] = led["runs"][-60:]
    return {"status": "ok", "detail": detail}


def usd(v):
    return ("-$" if v < 0 else "+$") + f"{abs(v):.2f}"


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    led = dtp.load(OUT) or {"schemaVersion": 1, "mode": "paper",
                            "note": "PAPER ONLY market-wide lab: the day-trade strategies replayed on every watched stock with $25 pretend trades. Never trades real money.",
                            "positionUsd": POSITION_USD, "days": [], "strategies": {}, "pairs": {}, "runs": []}
    now = datetime.now(timezone.utc)
    day = argv[0] if argv else (now - timedelta(hours=4)).date().isoformat()
    if date.fromisoformat(day).weekday() >= 5:
        print(json.dumps({"status": "skip", "detail": "weekend"})); return 0
    out = record(fetch(day), led, now)
    if out["status"] == "ok":
        with open(OUT, "w") as f:
            json.dump(led, f, indent=1); f.write("\n")
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
