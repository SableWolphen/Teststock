#!/usr/bin/env python3
"""Dip-call PAPER desk: the first options idea that won on real historical option prices
(claudebot-dipcall-research.json, 2026-11-03: at-the-money calls ~45 days out, bought on the Dip
signal and sold when the fund bounces; +4.8%/trade on 2024, +4.7%/trade on unseen 2025-26, PF 2.1,
61 unseen trades; every one of 6 settings positive in both periods). Puts on the mirror signal had
no edge and are not traded.

Runs after each close in GitHub (free). Never places orders. One pretend contract per signal:
  entry  Dip signal at today's close (RSI(2) < 5 above the 200-day average) on KRE XLF SMH XLK IWM
         QQQ DIA SPY -> buy the at-the-money call nearest 45 days out at the ASK
  exit   the fund closes above its 5-day average, after 10 trading days, or 5% below entry -> sell at the BID
Fees $0.05/contract each way. Writes docs/data/claudebot-dipcall-paper.json.

Real money: these contracts cost roughly $950-3,000 each, far above the governor's $50 hard cap, so at
the current account size this can only be paper. Going live would need the evidence below AND the
board raising the cap (which needs a bigger account): 20+ paper trades, profit factor > 1.3, net profit.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-dipcall-paper.json")
SYMS = ["KRE", "XLF", "SMH", "XLK", "IWM", "QQQ", "DIA", "SPY"]
FEE = 0.05
OCC = re.compile(r"^([A-Z]+)(\d{6})([CP])(\d{8})$")
H = None


def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=40).read())


def rsi2(c):
    g = l = 0.0
    for i in range(1, len(c)):
        d = c[i] - c[i - 1]; up, dn = max(d, 0), max(-d, 0)
        if i <= 2: g += up / 2; l += dn / 2
        else: g = (g + up) / 2; l = (l + dn) / 2
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def pick_call(sym, px, today):
    lo, hi = today + timedelta(days=35), today + timedelta(days=56)
    url = (f"https://data.alpaca.markets/v1beta1/options/snapshots/{sym}?feed=indicative&type=call&limit=1000"
           f"&expiration_date_gte={lo}&expiration_date_lte={hi}&strike_price_gte={px * 0.98:.2f}&strike_price_lte={px * 1.02:.2f}")
    best = None
    for occ, sn in (get(url).get("snapshots") or {}).items():
        q = sn.get("latestQuote") or {}; a, b = float(q.get("ap") or 0), float(q.get("bp") or 0)
        mo = OCC.match(occ)
        if not mo or a <= 0 or b <= 0:
            continue
        k = int(mo.group(4)) / 1000; exp = datetime.strptime(mo.group(2), "%y%m%d").date()
        key = (abs(k - px), abs((exp - today).days - 45))
        if best is None or key < best[0]:
            best = (key, {"symbol": occ, "strike": k, "expiration": exp.isoformat(), "ask": a, "bid": b})
    return best[1] if best else None


def main():
    global H
    H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    sp = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); ob = importlib.util.module_from_spec(sp); sp.loader.exec_module(ob)
    try:
        led = json.load(open(OUT))
    except Exception:  # noqa: BLE001
        led = {"schemaVersion": 1, "mode": "paper", "lastDay": None,
               "note": "PAPER ONLY. At-the-money calls ~45 days out on the Dip signal, sold on the bounce. Won on real historical option prices; contracts cost ~$950-3,000, above the $50 cap.",
               "strategies": {"dipcall": {"name": "Dip calls (ATM, ~45 days, sell on the bounce)", "open": {}, "trades": []}}, "runs": []}
    st = led["strategies"]["dipcall"]; today = datetime.now(timezone.utc).date(); made = []
    for s in SYMS:
        bars = ob.daily_bars(s, (today - timedelta(days=600)).isoformat())[0]   # helper needs 300+ bars
        d = [x for x, _ in bars]; c = [x for _, x in bars]
        if len(c) < 210 or (led.get("lastDay") and d[-1] <= led["lastDay"]):
            continue
        day = d[-1]; pos = st["open"].get(s)
        if pos:
            held = sum(1 for x in d if pos["in"] < x <= day)
            why = "5% stop" if c[-1] <= pos["etfPx"] * 0.95 else "bounce" if c[-1] > sum(c[-5:]) / 5 else "time" if held >= 10 else None
            if why:
                q = get(f"https://data.alpaca.markets/v1beta1/options/snapshots?symbols={pos['symbol']}&feed=indicative").get("snapshots") or {}
                bid = float(((q.get(pos["symbol"]) or {}).get("latestQuote") or {}).get("bp") or 0)
                pnl = round((bid - pos["ask"]) * 100 - 2 * FEE, 2)
                st["trades"].append({**pos, "out": day, "exitBid": bid, "why": why, "pnlUsd": pnl, "retPct": round(100 * (bid / pos["ask"] - 1), 1),
                                     "etfRetPct": round(100 * (c[-1] / pos["etfPx"] - 1), 2), "days": held})
                del st["open"][s]; made.append(f"sold {pos['symbol']} {why} {pnl:+.2f}")
        elif c[-1] > sum(c[-200:]) / 200 and rsi2(c[-31:]) < 5:
            opt = pick_call(s, c[-1], today)
            if opt:
                st["open"][s] = {**opt, "in": day, "etfPx": c[-1], "underlying": s}; made.append(f"bought {opt['symbol']} at {opt['ask']}")
        led["_day"] = max(led.get("_day") or "", day)
    if led.get("_day"):
        led["lastDay"] = led.pop("_day")
    t = st["trades"]; w = [x["pnlUsd"] for x in t if x["pnlUsd"] > 0]; l = [x["pnlUsd"] for x in t if x["pnlUsd"] <= 0]
    led["leaderboard"] = [{"id": "dipcall", "name": st["name"], "trades": len(t), "wins": len(w), "winRatePct": round(100 * len(w) / len(t), 1) if t else None,
                           "pnlUsd": round(sum(w + l), 2), "avgRetPct": round(sum(x["retPct"] for x in t) / len(t), 1) if t else None,
                           "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, "open": len(st["open"])}]
    led["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    led["runs"] = (led.get("runs", []) + [{"t": led["updatedAt"], "detail": ", ".join(made) or "no signals"}])[-60:]
    json.dump(led, open(OUT, "w"), indent=1)
    print(led["runs"][-1]["detail"])


if __name__ == "__main__":
    main()
