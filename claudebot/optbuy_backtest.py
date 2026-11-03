#!/usr/bin/env python3
"""Backtest: buy a call when the Dip signal fires (board request 2026-11-02). RESEARCH ONLY.

Signal = the live Dip/options-buying rule: RSI(2) < 5 and close above the 200-day average,
on KRE, XLF, SMH, XLK, IWM, QQQ, DIA, SPY. Entry at the signal day's close (the bot buys in the
last hour). Data: REAL daily option trade bars from Alpaca (Feb 2024 on, expired contracts included).
Contract: the Friday expiry nearest the target days-to-expiry; strike at-the-money or ~5% out of
the money; one contract if its price fits the budget (min $50, 43% of account).
Fills: buy = close + half spread rounded UP, sell = price - half spread rounded DOWN (spread
max($0.01-0.03 by price, 3% of price) for sector ETFs, plain $0.01-0.03 for SPY/QQQ/IWM);
fees $0.05/contract/side. Exits checked on daily bars: take profit (resting limit) if the day's
high allows it, stop if the day's low hits it (if both happen the same day, the STOP counts),
time exit after N trading days, or 5 days before expiry. One position at a time.
Grid: take profit 10/20/30/50%, stop 40/60%, hold 5/7/10 days, expiry ~14/21/35 days, ATM vs 5% OTM.
Split: 2024 = pick, 2025-26 = unseen check. Baseline: buying the ETF itself on the same signals.
Writes docs/data/claudebot-optbuy-backtest.json.
"""
from __future__ import annotations

import importlib.util
import itertools
import json
import math
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "docs", "data", "claudebot-optbuy-backtest.json")
SYMS = ["KRE", "XLF", "SMH", "XLK", "IWM", "QQQ", "DIA", "SPY"]
TIGHT = {"SPY", "QQQ", "IWM"}
START, SPLIT = "2024-02-05", "2025-01-01"
FEE = 0.05
H = None


def spread(sym, p):
    base = 0.01 if p < 1 else 0.02 if p < 3 else 0.03
    return base if sym in TIGHT else max(base, round(0.03 * p, 2))


def buy_px(sym, p):
    return math.ceil(round((p + spread(sym, p) / 2) * 100, 6)) / 100


def sell_px(sym, p):
    return max(0.01, math.floor(round((p - spread(sym, p) / 2) * 100, 6)) / 100)


def get(url):
    for i in range(4):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60).read())
        except Exception as e:  # noqa: BLE001
            if i == 3:
                print("fetch failed", url[:110], e, file=sys.stderr); return {}
            time.sleep(2 + 3 * i)


def rsi2(c):
    g = l = 0.0
    for i in range(1, len(c)):
        d = c[i] - c[i - 1]; up, dn = max(d, 0), max(-d, 0)
        if i <= 2: g += up / 2; l += dn / 2
        else: g = (g + up) / 2; l = (l + dn) / 2
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def fridays_near(d, target):
    t = date.fromisoformat(d) + timedelta(days=target)
    cands = [t + timedelta(days=k) for k in range(-6, 7)]
    fr = [x for x in cands if x.weekday() == 4]
    return min(fr, key=lambda x: abs((x - t).days)).isoformat()


def occ(und, exp, k):
    return f"{und}{exp[2:4]}{exp[5:7]}{exp[8:10]}C{int(round(k * 1000)):08d}"


def strikes(px, money):
    lo, hi = (px * 0.99, px * 1.02) if money == "atm" else (px * 1.03, px * 1.07)
    step = 0.5 if px < 100 else 1.0
    k = math.floor(lo / step) * step; out = []
    while k <= hi + 1e-9:
        out.append(round(k, 2)); k += step
    return out


def opt_daily(syms, start, end):
    res, tok = {}, None
    while True:
        d = get("https://data.alpaca.markets/v1beta1/options/bars?timeframe=1Day&limit=10000"
                f"&start={start}&end={end}&symbols={','.join(syms)}" + (f"&page_token={tok}" if tok else ""))
        for s, bars in (d.get("bars") or {}).items():
            res[s] = {b["t"][:10]: (b["o"], b["h"], b["l"], b["c"], b.get("n", 0)) for b in bars}
        tok = d.get("next_page_token")
        if not tok:
            break
    time.sleep(0.32)
    return res


def main():
    global H
    H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    sp = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); obm = importlib.util.module_from_spec(sp); sp.loader.exec_module(obm)
    days = {s: obm.daily_bars(s, "2023-01-01")[0] for s in SYMS}
    sigs = []
    for s, bars in days.items():
        c = [x for _, x in bars]; dts = [d for d, _ in bars]
        for i in range(210, len(c)):
            if dts[i] < START:
                continue
            sma = sum(c[i - 199:i + 1]) / 200
            if c[i] > sma and rsi2(c[i - 30:i + 1]) < 5:
                # ETF baseline: Dip desk exit (close > SMA5 or 10 days or -5% stop)
                j, ex = i, None
                for j in range(i + 1, min(i + 11, len(c))):
                    if c[j] <= c[i] * 0.95 or c[j] > sum(c[j - 4:j + 1]) / 5:
                        ex = c[j]; break
                ex = ex or c[min(i + 10, len(c) - 1)]
                sigs.append({"sym": s, "day": dts[i], "px": c[i], "etfRetPct": round(100 * (ex / c[i] - 1) - 0.06, 3)})
    sigs.sort(key=lambda x: x["day"])
    print("signals", len(sigs), file=sys.stderr)
    # fetch option paths once per (signal, expiry target, moneyness)
    paths = {}
    for g in sigs:
        for dte in (14, 21, 35):
            exp = fridays_near(g["day"], dte)
            if exp <= g["day"]:
                continue
            for money in ("atm", "otm"):
                syms = [occ(g["sym"], exp, k) for k in strikes(g["px"], money)]
                end = (date.fromisoformat(exp) + timedelta(days=1)).isoformat()
                paths[(g["sym"], g["day"], dte, money)] = (exp, opt_daily(syms, g["day"], end))
    grid = [dict(tp=tp, stop=st, hold=hd, dte=dt, money=m) for tp, st, hd, dt, m in itertools.product((10, 20, 30, 50), (40, 60), (5, 7, 10), (14, 21, 35), ("atm", "otm"))]

    def simulate(p, eq0, per):
        eq, trades, free_day = eq0, [], ""
        for g in sigs:
            if (g["day"] < SPLIT) != (per == "train") or g["day"] <= free_day or eq < 10:
                continue
            key = (g["sym"], g["day"], p["dte"], p["money"])
            if key not in paths:
                continue
            exp, data = paths[key]
            budget = min(50.0, 0.43 * eq) if eq0 < 500 else min(250.0, 0.25 * eq)
            best = None
            for sym, bars in data.items():
                b = bars.get(g["day"])
                if not b or b[4] < 3:
                    continue
                px = buy_px(g["sym"], b[3])
                if px * 100 + FEE > budget or px < 0.05:
                    continue
                if not best or px > best[1]:
                    best = (sym, px)
            if not best:
                continue
            sym, entry = best; bars = data[sym]
            tp = math.ceil(round(entry * (1 + p["tp"] / 100) * 100, 6)) / 100; st = entry * (1 - p["stop"] / 100)
            later = sorted(d for d in bars if d > g["day"])
            ex, why, last, held, xd = None, "time", entry, 0, g["day"]
            for d in later:
                o, h, l, c, n = bars[d]; held += 1; xd = d
                if sell_px(g["sym"], l) <= st:
                    ex = max(0.01, min(math.floor(st * 100) / 100, sell_px(g["sym"], o)) - 0.01); why = "stop"; break
                if sell_px(g["sym"], h) >= tp:
                    ex = tp; why = "target"; break
                last = c
                if held >= p["hold"] or (date.fromisoformat(exp) - date.fromisoformat(d)).days <= 5:
                    ex = sell_px(g["sym"], c); why = "time"; break
            if ex is None:
                ex = sell_px(g["sym"], last) - 0.01; why = "no data"
            pnl = (ex - entry) * 100 - 2 * FEE
            eq += pnl; free_day = xd
            trades.append({"day": g["day"], "sym": g["sym"], "contract": sym, "entry": entry, "exit": ex, "pnl": round(pnl, 2),
                           "retPct": round(100 * pnl / (entry * 100 + FEE), 1), "why": why, "days": held, "etfRetPct": g["etfRetPct"]})
        return eq, trades

    def summ(eq0, eq, t):
        if not t:
            return {"trades": 0}
        w = [x["pnl"] for x in t if x["pnl"] > 0]; l = [x["pnl"] for x in t if x["pnl"] <= 0]
        run, peak, mdd = eq0, eq0, 0.0
        for x in t:
            run += x["pnl"]; peak = max(peak, run); mdd = min(mdd, run / peak - 1)
        return {"trades": len(t), "winRatePct": round(100 * len(w) / len(t), 1), "avgRetPct": round(sum(x["retPct"] for x in t) / len(t), 1),
                "netUsd": round(eq - eq0, 2), "returnPct": round(100 * (eq / eq0 - 1), 1), "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None,
                "worstTradeUsd": min(x["pnl"] for x in t), "maxDrawdownPct": round(100 * mdd, 1),
                "sameSignalsEtfAvgPct": round(sum(x["etfRetPct"] for x in t) / len(t), 2), "exits": {k: sum(1 for x in t if x["why"] == k) for k in ("target", "stop", "time", "no data")}}

    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "symbols": SYMS, "signals": len(sigs), "signalsTrain": sum(1 for g in sigs if g["day"] < SPLIT),
           "signalsTest": sum(1 for g in sigs if g["day"] >= SPLIT), "period": [START, sigs[-1]["day"] if sigs else None], "split": SPLIT,
           "etfBaselineAvgPct": {"train": round(sum(g["etfRetPct"] for g in sigs if g["day"] < SPLIT) / max(1, sum(1 for g in sigs if g["day"] < SPLIT)), 2),
                                 "test": round(sum(g["etfRetPct"] for g in sigs if g["day"] >= SPLIT) / max(1, sum(1 for g in sigs if g["day"] >= SPLIT)), 2)},
           "modes": {}}
    for mk, e0 in (("acct117", 117.0), ("acct1000", 1000.0)):
        rows = []
        for p in grid:
            ea, ta = simulate(p, e0, "train"); eb, tb = simulate(p, e0, "test")
            rows.append({"params": p, "train": summ(e0, ea, ta), "test": summ(e0, eb, tb), "testTrades": tb})
        ok = [r for r in rows if r["train"].get("trades", 0) >= 5]
        best = max(ok, key=lambda r: r["train"]["netUsd"]) if ok else None
        live = next((r for r in rows if r["params"] == dict(tp=10, stop=40, hold=7, dte=21, money="otm")), None)
        live_atm = next((r for r in rows if r["params"] == dict(tp=10, stop=40, hold=7, dte=21, money="atm")), None)
        out["modes"][mk] = {"startEquity": e0, "chosenOnTrain": best and {k: best[k] for k in ("params", "train", "test")},
                            "chosenTestTrades": best["testTrades"] if best else [],
                            "currentLiveRules": live and {k: live[k] for k in ("params", "train", "test")},
                            "currentLiveRulesATM": live_atm and {k: live_atm[k] for k in ("params", "train", "test")},
                            "combosPositiveTest": f"{sum(1 for r in ok if (r['test'].get('netUsd') or -1) > 0)}/{len(ok)}",
                            "combosPositiveBoth": f"{sum(1 for r in ok if (r['test'].get('netUsd') or -1) > 0 and r['train']['netUsd'] > 0)}/{len(ok)}",
                            "all": [{k: r[k] for k in ('params', 'train', 'test')} for r in rows]}
        print(mk, "BEST", best and best["params"], best and best["train"], best and best["test"])
        print(mk, "LIVE", live and live["train"], live and live["test"], out["modes"][mk]["combosPositiveTest"], out["modes"][mk]["combosPositiveBoth"])
    json.dump(out, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
