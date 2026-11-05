#!/usr/bin/env python3
"""Intraday dip desk, PAPER (board, 2026-11-05: "buy the dip throughout the day and sell it when it
goes up; I need to see trades today"). Runs every 5 minutes inside the GitHub market loop. Free,
never places a real order.

Funds: the live Dip desk's 7 (SPY QQQ IWM DIA XLK SMH KRE), only while each is above its 200-day
average (an uptrend, like the live rule).
  BUY   $25 when the fund has fallen >= 0.40% over the last 30 minutes AND sits >= 0.25% below
        today's average price (VWAP): a short-term dip. Filled at the live ASK.
  SELL  at the live BID when up +0.30% (take profit), down -0.50% (stop), after 90 minutes, or at
        2:50 PM CT (flat every night).
Max 3 open at once, max 2 trades per fund per day.
Our day-trade backtests found no reliable edge in intraday dip-buying after costs, so this stays
paper; it is here so the board can watch real-time trades and see the results honestly. It can
earn real money only through the same evidence gates as everything else.
Writes docs/data/claudebot-intraday-paper.json.
"""
from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-intraday-paper.json")
CT = ZoneInfo("America/Chicago")
SYMS = ["SPY", "QQQ", "IWM", "DIA", "XLK", "SMH", "KRE"]
USD, TP, SL, MAXMIN, MAXOPEN, PERDAY = 25.0, 0.30, 0.50, 90, 3, 2
H = None


def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30).read())


def main():
    global H
    H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    now = datetime.now(timezone.utc); loc = now.astimezone(CT); day = loc.date().isoformat(); m = loc.hour * 60 + loc.minute
    if loc.weekday() >= 5 or not (8 * 60 + 40 <= m <= 15 * 60):
        print("market closed"); return
    try:
        led = json.load(open(OUT))
    except Exception:  # noqa: BLE001
        led = {"schemaVersion": 1, "mode": "paper", "strategies": {"intraday": {"name": "Intraday dips: buy a 30-min dip below VWAP, sell +0.3%", "open": {}, "trades": []}}, "runs": [],
               "note": "PAPER ONLY. Real-time intraday dip buying on the live desk's 7 funds; filled at live ask/bid."}
    st = led["strategies"]["intraday"]; nowz = now.isoformat().replace("+00:00", "Z"); ev = []
    q = get(f"https://data.alpaca.markets/v2/stocks/quotes/latest?symbols={','.join(SYMS)}&feed=iex").get("quotes") or {}
    start = loc.replace(hour=8, minute=30, second=0, microsecond=0).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    bars = get(f"https://data.alpaca.markets/v2/stocks/bars?symbols={','.join(SYMS)}&timeframe=5Min&start={start}&feed=iex&limit=10000").get("bars") or {}
    dstart = (now - timedelta(days=320)).date().isoformat()
    daily = get(f"https://data.alpaca.markets/v2/stocks/bars?symbols={','.join(SYMS)}&timeframe=1Day&start={dstart}&feed=iex&limit=10000&adjustment=split").get("bars") or {}
    # exits first
    for s, p in list(st["open"].items()):
        bid = float((q.get(s) or {}).get("bp") or 0)
        if bid <= 0:
            continue
        r = 100 * (bid / p["ask"] - 1); age = (now - datetime.fromisoformat(p["at"].replace("Z", "+00:00"))).total_seconds() / 60
        why = "take profit" if r >= TP else "stop" if r <= -SL else "time limit" if age >= MAXMIN else "end of day" if m >= 14 * 60 + 50 or p["day"] != day else None
        if why:
            pnl = round(USD * (bid / p["ask"] - 1), 3)
            st["trades"].append({**p, "symbol": s, "exitBid": bid, "out": nowz, "why": why, "retPct": round(r, 3), "pnlUsd": pnl})
            del st["open"][s]; ev.append(f"SOLD {s} {why} {r:+.2f}% ({pnl:+.2f} USD)")
    # entries
    if m <= 14 * 60 + 30:
        for s in SYMS:
            if len(st["open"]) >= MAXOPEN or s in st["open"] or sum(1 for t in st["trades"] if t["symbol"] == s and t["day"] == day) >= PERDAY:
                continue
            b = bars.get(s) or []; dc = [x["c"] for x in daily.get(s) or []]
            a = float((q.get(s) or {}).get("ap") or 0)
            if len(b) < 7 or len(dc) < 200 or a <= 0:
                continue
            if dc[-1] <= sum(dc[-200:]) / 200:
                continue
            pv = sum(x["c"] * x["v"] for x in b); vv = sum(x["v"] for x in b) or 1; vwap = pv / vv
            drop = 100 * (b[-1]["c"] / b[-7]["c"] - 1); below = 100 * (b[-1]["c"] / vwap - 1)
            if drop <= -0.40 and below <= -0.25:
                st["open"][s] = {"ask": a, "at": nowz, "day": day, "drop30mPct": round(drop, 2), "vsVwapPct": round(below, 2)}
                ev.append(f"BOUGHT {s} at {a} (down {drop:.2f}% in 30 min, {below:.2f}% under VWAP)")
    t = st["trades"]; w = [x["pnlUsd"] for x in t if x["pnlUsd"] > 0]; l = [x["pnlUsd"] for x in t if x["pnlUsd"] <= 0]
    today = [x for x in t if x["day"] == day]
    led["leaderboard"] = [{"id": "intraday", "name": st["name"], "trades": len(t), "wins": len(w), "winRatePct": round(100 * len(w) / len(t), 1) if t else None,
                           "pnlUsd": round(sum(w + l), 2), "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, "open": len(st["open"]),
                           "todayTrades": len(today), "todayPnlUsd": round(sum(x["pnlUsd"] for x in today), 2)}]
    led["updatedAt"] = nowz; led["runs"] = (led.get("runs", []) + [{"t": nowz, "events": ev or ["watching"]}])[-200:]
    json.dump(led, open(OUT, "w"), indent=1)
    print(json.dumps(ev or ["watching"]))


if __name__ == "__main__":
    main()
