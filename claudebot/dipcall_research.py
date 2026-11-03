#!/usr/bin/env python3
"""Calls AND puts that ride a proven signal, exiting on the signal's own rule (board, 2026-11-03:
"figure out options calls and puts to make money"). RESEARCH ONLY, real historical option prices.

Why this is different from what already lost:
  * the old tests sold at a fixed +10-50% target or after N days, mostly on cheap out-of-the-money
    contracts, and lost on costs and time decay;
  * here the option is held exactly as long as the PROVEN stock trade (exit when the fund closes
    back above its 5-day average, after 10 days, or on a 5% adverse move), so the option only has
    to amplify a move that history says tends to happen;
  * contracts are at-the-money or in-the-money with 30-60 days left, so time decay per day is small
    and more of the move is captured (higher delta).
Calls: the Dip signal (RSI(2) < 5 above the 200-day average).
Puts: the mirror image (RSI(2) > 95 BELOW the 200-day average: an oversold-bounce's opposite).
Funds: KRE XLF SMH XLK IWM QQQ DIA SPY. Data: Alpaca daily option bars (Feb 2024 on, expired
contracts included). Fills: buy = close + half spread (rounded up), sell = close - half spread
(rounded down), $0.05/contract each way. Budget is NOT capped here (the question is whether an edge
exists at all); affordability at a ~$117 account is reported separately.
Split: 2024 = pick, 2025-26 = unseen. Writes docs/data/claudebot-dipcall-research.json.
"""
from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-dipcall-research.json")
sp = importlib.util.spec_from_file_location("ob2", os.path.join(HERE, "optbuy_backtest.py"))
ob2 = importlib.util.module_from_spec(sp); sp.loader.exec_module(ob2)
SYMS = ob2.SYMS; START, SPLIT, FEE = ob2.START, ob2.SPLIT, ob2.FEE


def occ(und, exp, typ, k):
    return f"{und}{exp[2:4]}{exp[5:7]}{exp[8:10]}{typ}{int(round(k * 1000)):08d}"


def strikes(px, typ, money):
    # calls: ITM = below the price; puts: ITM = above the price
    if money == "atm":
        lo, hi = px * 0.985, px * 1.015
    elif typ == "C":
        lo, hi = px * 0.93, px * 0.97
    else:
        lo, hi = px * 1.03, px * 1.07
    step = 0.5 if px < 100 else 1.0
    k = math.floor(lo / step) * step; out = []
    while k <= hi + 1e-9:
        out.append(round(k, 2)); k += step
    return out


def signals(days):
    out = []
    for s, bars in days.items():
        c = [x for _, x in bars]; d = [x for x, _ in bars]
        for i in range(210, len(c) - 1):
            if d[i] < START:
                continue
            sma = sum(c[i - 199:i + 1]) / 200; r = ob2.rsi2(c[i - 30:i + 1])
            side = "C" if (c[i] > sma and r < 5) else "P" if (c[i] < sma and r > 95) else None
            if not side:
                continue
            exit_i = None
            for j in range(i + 1, min(i + 11, len(c))):
                s5 = sum(c[j - 4:j + 1]) / 5
                if side == "C" and (c[j] <= c[i] * 0.95 or c[j] > s5):
                    exit_i = j; break
                if side == "P" and (c[j] >= c[i] * 1.05 or c[j] < s5):
                    exit_i = j; break
            exit_i = exit_i or min(i + 10, len(c) - 1)
            ret = (c[exit_i] / c[i] - 1) * (1 if side == "C" else -1)
            out.append({"sym": s, "side": side, "day": d[i], "exitDay": d[exit_i], "px": c[i], "etfRetPct": round(100 * ret - 0.06, 3)})
    return sorted(out, key=lambda x: x["day"])


def run(sigs, money, dte, data):
    trades = []
    for g in sigs:
        exp, bars_by = data.get((g["sym"], g["day"], g["side"], money, dte), (None, {}))
        best = None
        for sym, bars in bars_by.items():
            b = bars.get(g["day"])
            if not b or b[4] < 3:
                continue
            k = int(sym[-8:]) / 1000; dist = abs(k - g["px"])
            if best is None or dist < best[0]:
                best = (dist, sym, b)
        if not best:
            continue
        _, sym, b = best; bars = bars_by[sym]
        entry = ob2.buy_px(g["sym"], b[3])
        xb = bars.get(g["exitDay"])
        if not xb:                                  # no trade that day: use the last bar before it, minus a tick
            prior = [d for d in bars if g["day"] < d <= g["exitDay"]]
            if not prior:
                continue
            xb = bars[max(prior)]; ex = ob2.sell_px(g["sym"], xb[3]) - 0.01
        else:
            ex = ob2.sell_px(g["sym"], xb[3])
        pnl = (ex - entry) * 100 - 2 * FEE
        trades.append({"day": g["day"], "sym": g["sym"], "side": g["side"], "contract": sym, "entry": entry, "exit": round(ex, 2),
                       "premiumUsd": round(entry * 100, 2), "pnl": round(pnl, 2), "retPct": round(100 * pnl / (entry * 100 + FEE), 1), "etfRetPct": g["etfRetPct"]})
    return trades


def summ(t):
    if not t:
        return {"trades": 0}
    w = [x["pnl"] for x in t if x["pnl"] > 0]; l = [x["pnl"] for x in t if x["pnl"] <= 0]
    prem = sorted(x["premiumUsd"] for x in t)
    return {"trades": len(t), "winRatePct": round(100 * len(w) / len(t), 1), "avgRetPct": round(sum(x["retPct"] for x in t) / len(t), 1),
            "medianRetPct": sorted(x["retPct"] for x in t)[len(t) // 2], "netUsdOneContractEach": round(sum(w + l), 2),
            "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, "worstRetPct": min(x["retPct"] for x in t),
            "sameSignalsEtfAvgPct": round(sum(x["etfRetPct"] for x in t) / len(t), 2), "medianPremiumUsd": prem[len(prem) // 2],
            "affordableAt117Pct": round(100 * sum(1 for p in prem if p <= 50) / len(prem), 1)}


def main():
    ob2.H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    sp2 = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); obm = importlib.util.module_from_spec(sp2); sp2.loader.exec_module(obm)
    days = {s: obm.daily_bars(s, "2023-01-01")[0] for s in SYMS}
    sigs = signals(days)
    print("signals", len(sigs), "calls", sum(1 for g in sigs if g["side"] == "C"), "puts", sum(1 for g in sigs if g["side"] == "P"), file=sys.stderr)
    data = {}
    for g in sigs:
        for dte in (30, 45, 60):
            exp = ob2.fridays_near(g["day"], dte)
            end = min(date.fromisoformat(exp), date.fromisoformat(g["exitDay"]) + timedelta(days=4)).isoformat()
            for money in ("atm", "itm"):
                syms = [occ(g["sym"], exp, g["side"], k) for k in strikes(g["px"], g["side"], money)]
                data[(g["sym"], g["day"], g["side"], money, dte)] = (exp, ob2.opt_daily(syms, g["day"], end))
    rows = []
    for side in ("C", "P"):
        for money in ("atm", "itm"):
            for dte in (30, 45, 60):
                t = run([g for g in sigs if g["side"] == side], money, dte, data)
                tr = [x for x in t if x["day"] < SPLIT]; te = [x for x in t if x["day"] >= SPLIT]
                rows.append({"side": "calls" if side == "C" else "puts", "money": money, "dte": dte, "train": summ(tr), "test": summ(te), "testTrades": te})
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "split": SPLIT, "signals": len(sigs), "researchOnly": True, "rows": []}
    for side in ("calls", "puts"):
        cand = [r for r in rows if r["side"] == side and r["train"].get("trades", 0) >= 5]
        best = max(cand, key=lambda r: r["train"].get("avgRetPct", -99)) if cand else None
        both = [r for r in cand if (r["train"].get("avgRetPct") or -1) > 0 and (r["test"].get("avgRetPct") or -1) > 0]
        out[side] = {"chosenOnPick": best and {k: best[k] for k in ("money", "dte", "train", "test")},
                     "settingsPositiveBoth": f"{len(both)}/{len(cand)}",
                     "verdict": ("edge" if best and (best["test"].get("avgRetPct") or -1) > 0 and (best["test"].get("profitFactor") or 0) > 1.2
                                 and best["test"].get("trades", 0) >= 10 else "no edge")}
        print(side, out[side]["verdict"], best and (best["money"], best["dte"]), best and best["train"], best and best["test"], out[side]["settingsPositiveBoth"])
    out["rows"] = [{k: r[k] for k in ("side", "money", "dte", "train", "test")} for r in rows]
    json.dump(out, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
