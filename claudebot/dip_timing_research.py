#!/usr/bin/env python3
"""Does the Dip desk make more money checking for buys earlier in the day? (board, 2026-11-06:
"2:14 and 2:44 should be throughout the day as well"). RESEARCH ONLY.

For each check time (9:45, 11:15, 13:15 and 14:45 CT), the live Dip rule is evaluated using the price
AT THAT TIME as today's price (RSI(2) < 5 on yesterday's closes + that price, above the 200-day
average). A buy fills at that price + 0.03%. Exits use the live rule on daily closes (close above the
5-day average, 10 days, or a 5% stop). Same 7 funds as the live desk. Hourly IEX bars from Alpaca.
Pick 2018-2022, unseen 2023-now. Writes docs/data/claudebot-dip-timing.json.
"""
from __future__ import annotations

import importlib.util
import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-dip-timing.json")
SYMS = ["SPY", "QQQ", "IWM", "DIA", "XLK", "SMH", "KRE"]
CT = ZoneInfo("America/Chicago")
TIMES = {"9:45": (9, 45), "11:15": (11, 15), "13:15": (13, 15), "14:45": (14, 45)}
COST = 0.0003
H = None


def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60).read())


def intraday(sym):
    """{date: [(minute_of_day_CT, close)]} from 15-minute bars."""
    out, tok = {}, None
    while True:
        d = get(f"https://data.alpaca.markets/v2/stocks/{sym}/bars?timeframe=15Min&start=2017-06-01&feed=iex&limit=10000&adjustment=split"
                + (f"&page_token={tok}" if tok else ""))
        for b in d.get("bars") or []:
            t = datetime.fromisoformat(b["t"].replace("Z", "+00:00")).astimezone(CT)
            out.setdefault(t.date().isoformat(), []).append((t.hour * 60 + t.minute + 15, b["c"]))   # bar close time
        tok = d.get("next_page_token")
        if not tok:
            return out


def rsi2(c):
    g = l = 0.0
    for i in range(1, len(c)):
        d = c[i] - c[i - 1]; up, dn = max(d, 0), max(-d, 0)
        if i <= 2: g += up / 2; l += dn / 2
        else: g = (g + up) / 2; l = (l + dn) / 2
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def qualifies(c, i, px):
    return px > sum(c[i - 199:i] + [px]) / 200 and rsi2(c[i - 30:i] + [px]) < 5


def run(daily, intr, hm):
    """hm = (h, m) one check time; (15, 0) = the close; "all" = buy at the FIRST of the 4 check times that qualifies."""
    d = [x for x, _ in daily]; c = [x for _, x in daily]; trades = []; i = 210
    while i < len(c) - 1:
        bars = intr.get(d[i]) or []
        if hm == "all":
            px = None
            for h_, m_ in TIMES.values():
                p_ = next((p for m, p in bars if m >= h_ * 60 + m_), None)
                if p_ and qualifies(c, i, p_):
                    px = p_; break
        elif hm == (15, 0):
            px = c[i]
        else:
            px = next((p for m, p in bars if m >= hm[0] * 60 + hm[1]), None)
        if px and d[i] >= "2018-01-01" and qualifies(c, i, px):
            entry = px * (1 + COST); j = i
            while j < len(c) - 1:
                j += 1; held = j - i
                if c[j] <= entry * 0.95 or c[j] > sum(c[j - 4:j + 1]) / 5 or held >= 10:
                    break
            trades.append({"in": d[i], "ret": c[j] * (1 - COST) / entry - 1}); i = j + 1
        else:
            i += 1
    return trades


def summ(t):
    if not t:
        return {"trades": 0}
    r = [x["ret"] for x in t]; w = [x for x in r if x > 0]; l = [x for x in r if x <= 0]
    return {"trades": len(t), "winRatePct": round(100 * len(w) / len(t), 1), "avgTradePct": round(100 * sum(r) / len(t), 3),
            "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, "worstPct": round(100 * min(r), 2)}


def main():
    global H
    H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    sp = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); ob = importlib.util.module_from_spec(sp); sp.loader.exec_module(ob)
    res = {k: [] for k in TIMES}; res["close (backtest baseline)"] = []; res["all 4 checks (first that qualifies)"] = []
    for s in SYMS:
        daily = ob.daily_bars(s, "2016-06-01")[0]; intr = intraday(s)
        for k, hm in TIMES.items():
            res[k] += run(daily, intr, hm)
        res["close (backtest baseline)"] += run(daily, intr, (15, 0))
        res["all 4 checks (first that qualifies)"] += run(daily, intr, "all")
    rows = {k: {"pick": summ([x for x in t if x["in"] < "2023-01-01"]), "unseen": summ([x for x in t if x["in"] >= "2023-01-01"])} for k, t in res.items()}
    live = rows["14:45"]
    better = [k for k in list(TIMES) + ["all 4 checks (first that qualifies)"] if k != "14:45" and (rows[k]["pick"].get("avgTradePct") or -9) > (live["pick"].get("avgTradePct") or -9)
              and (rows[k]["unseen"].get("avgTradePct") or -9) > (live["unseen"].get("avgTradePct") or -9)]
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "researchOnly": True, "rows": rows, "betterThanLive": better,
           "verdict": ("earlier checks beat the live 2:44 timing on BOTH periods: " + ", ".join(better)) if better else "keep the live 2:14/2:44 timing: no earlier check time beat it on both periods"}
    json.dump(out, open(OUT, "w"), indent=1)
    print(out["verdict"])
    for k, v in rows.items():
        print(f"{k:28s} pick {v['pick']}  unseen {v['unseen']}")


if __name__ == "__main__":
    main()
