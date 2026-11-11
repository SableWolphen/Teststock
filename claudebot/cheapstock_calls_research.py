#!/usr/bin/env python3
"""Dip calls on CHEAP STOCKS (board, 2026-11-11: "options on cheap stocks as well, not just the big
ones"). RESEARCH ONLY, real historical option prices.

On the big funds a $50 call has to sit far above the price. On a cheap stock a $50 call can sit right
AT the price, which is the feature the winning dip-call recipe had. So: the same signal (RSI(2) < 5 above
the 200-day average) and the same exit (close back above the 5-day average, 10 days, or 5% against),
applied to every name in the bot's own options scan list (optbuy_config.json "scanUniverse") whose price
was $25 or less on the signal day. Contract = the call closest to the price (from 3% in the money up to
15% above) that costs $50 or less with fees, 30 or 45 days out.

Honest limits, stated in the output: single stocks gap on earnings and this test cannot skip earnings
dates; the list is today's liquid names (stocks that died are missing); the standard fill model is
kind to thinly traded contracts, so every result is also shown with a wide buy/sell gap (4 cents or 8%).
Writes docs/data/claudebot-cheapstock-calls-research.json. Never trades.
"""
from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-cheapstock-calls-research.json")
sp = importlib.util.spec_from_file_location("dr", os.path.join(HERE, "dipcall_research.py"))
dr = importlib.util.module_from_spec(sp); sp.loader.exec_module(dr)
ob2 = dr.ob2
CAP, MAX_PX, DTES, FEE = 50.0, 25.0, (30, 45), dr.FEE


def strikes(px):
    k = math.floor(px * 0.97 / 0.5) * 0.5; out = []
    while k <= px * 1.15 + 1e-9:
        if k > 0:
            out.append(round(k, 2))
        k += 0.5
    return out


def fills(sym, entry_close, exit_close, tick=0.0):
    """(buy, sell) at the standard gap, and at a wide gap: 4 cents or 8% of the price, whichever is larger.
    The wide gap is in line with what the bot's own paper desk measured on live quotes for cheap contracts."""
    h1, h2 = ob2.spread(sym, entry_close) / 2, ob2.spread(sym, exit_close) / 2
    w1, w2 = max(0.04, 0.08 * entry_close) / 2, max(0.04, 0.08 * exit_close) / 2
    up = lambda v: math.ceil(round(v * 100, 6)) / 100
    dn = lambda v: max(0.0, math.floor(round(v * 100, 6)) / 100)
    return (up(entry_close + h1), dn(exit_close - h2 - tick)), (up(entry_close + max(h1, w1)), dn(exit_close - max(h2, w2) - tick))


def pick(g, bars_by):
    best = None
    for sym, bars in bars_by.items():
        b = bars.get(g["day"])
        if not b or b[4] < 3:
            continue
        entry = ob2.buy_px(g["sym"], b[3])
        if entry * 100 + FEE > CAP:
            continue
        k = int(sym[-8:]) / 1000; key = (abs(k - g["px"]), k)
        if best is None or key < best[0]:
            best = (key, k, sym)
    return best and best[1:]


def run(sigs, dte, data):
    trades, nofit, noexit = [], 0, 0
    for g in sigs:
        bars_by = data.get((g["sym"], g["day"], dte), {})
        best = pick(g, bars_by)
        if not best:
            nofit += 1; continue
        k, sym = best; bars = bars_by[sym]
        xb, tick = bars.get(g["exitDay"]), 0.0
        if not xb:                                  # no trade that day: the last bar before it, minus a tick
            prior = [d for d in bars if g["day"] < d <= g["exitDay"]]
            if not prior:
                noexit += 1; continue
            xb, tick = bars[max(prior)], 0.01
        (b1, s1), (b2, s2) = fills(g["sym"], bars[g["day"]][3], xb[3], tick)
        p1, p2 = (s1 - b1) * 100 - 2 * FEE, (s2 - b2) * 100 - 2 * FEE
        trades.append({"day": g["day"], "sym": g["sym"], "px": round(g["px"], 2), "distPct": round(100 * (k / g["px"] - 1), 1),
                       "premiumUsd": round(b1 * 100, 2), "pnl": round(p1, 2), "retPct": round(100 * p1 / (b1 * 100 + FEE), 1),
                       "pnl2": round(p2, 2), "retPct2": round(100 * p2 / (b2 * 100 + FEE), 1), "etfRetPct": g["etfRetPct"]})
    return trades, nofit, noexit


def summ(t):
    if not t:
        return {"trades": 0}
    pf = lambda xs: (round(sum(x for x in xs if x > 0) / -sum(x for x in xs if x <= 0), 2) if sum(x for x in xs if x <= 0) < 0 else None)
    p, p2 = [x["pnl"] for x in t], [x["pnl2"] for x in t]
    prem = sorted(x["premiumUsd"] for x in t)
    return {"trades": len(t), "winRatePct": round(100 * sum(1 for x in p if x > 0) / len(t), 1),
            "avgRetPct": round(sum(x["retPct"] for x in t) / len(t), 1), "medianRetPct": sorted(x["retPct"] for x in t)[len(t) // 2],
            "profitFactor": pf(p), "netUsd": round(sum(p), 2), "worstRetPct": min(x["retPct"] for x in t),
            "wideGap": {"winRatePct": round(100 * sum(1 for x in p2 if x > 0) / len(t), 1), "avgRetPct": round(sum(x["retPct2"] for x in t) / len(t), 1),
                            "profitFactor": pf(p2), "netUsd": round(sum(p2), 2)},
            "stockMoveAvgPct": round(sum(x["etfRetPct"] for x in t) / len(t), 2), "medianPremiumUsd": prem[len(prem) // 2],
            "avgDistPct": round(sum(x["distPct"] for x in t) / len(t), 1)}


def by_period(t, split):
    return {"train": summ([x for x in t if x["day"] < split]), "test": summ([x for x in t if x["day"] >= split])}


def analyse(sigs, data, split):
    rows = []
    for dte in DTES:
        t, nofit, noexit = run(sigs, dte, data)
        by = {}
        for x in t:
            by.setdefault(x["sym"], []).append(x)
        rows.append({"dte": dte, "signals": len(sigs), "noAffordableContract": nofit, "noExitPrice": noexit, **by_period(t, split),
                     "byDistance": {"at the price (within 3%)": by_period([x for x in t if abs(x["distPct"]) <= 3], split),
                                    "3 to 8% above": by_period([x for x in t if 3 < x["distPct"] <= 8], split),
                                    "more than 8% above": by_period([x for x in t if x["distPct"] > 8], split)},
                     "byStockPrice": {"under $10": by_period([x for x in t if x["px"] < 10], split),
                                      "$10 to $25": by_period([x for x in t if x["px"] >= 10], split)},
                     "bySymbol": {s: by_period(v, split) for s, v in sorted(by.items(), key=lambda kv: -len(kv[1])) if len(v) >= 5},
                     "trades": [[x["day"], x["sym"], x["px"], x["distPct"], x["premiumUsd"], x["retPct"], x["pnl"], x["pnl2"]] for x in t]})
    ok = lambda r: ((r["train"].get("avgRetPct") or -1) > 0 and (r["test"].get("avgRetPct") or -1) > 0)
    cand = [r for r in rows if r["train"].get("trades", 0) >= 10]
    best = max(cand, key=lambda r: r["train"].get("avgRetPct", -99)) if cand else None
    held = bool(best and ok(best) and (best["test"].get("profitFactor") or 0) > 1.2 and best["test"]["trades"] >= 20
                and (best["test"]["wideGap"]["avgRetPct"] or -1) > 0)
    return {"tradeColumns": ["day", "symbol", "stockPrice", "pctFromPrice", "premiumUsd", "retPct", "pnlUsd", "pnlUsdWideGap"], "rows": rows,
            "settingsPositiveBoth": f"{sum(1 for r in cand if ok(r))}/{len(cand)}", "verdict": "held up" if held else "did not hold up"}


def main():
    ob2.H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    sp2 = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); obm = importlib.util.module_from_spec(sp2); sp2.loader.exec_module(obm)
    universe = json.load(open(os.path.join(HERE, "optbuy_config.json")))["scanUniverse"]
    days, skipped = {}, []
    for s in universe:
        try:
            b = obm.daily_bars(s, "2023-01-01")[0]
            if len(b) > 300:
                days[s] = b
            else:
                skipped.append(s)
        except Exception as e:  # noqa: BLE001
            skipped.append(s); print("no bars", s, str(e)[:60], file=sys.stderr)
    sigs = [g for g in dr.signals(days) if g["side"] == "C" and g["px"] <= MAX_PX]
    names = sorted({g["sym"] for g in sigs})
    print("universe", len(universe), "with bars", len(days), "| call signals at $25 or less:", len(sigs), "on", len(names), "names", file=sys.stderr)
    data = {}
    for n, g in enumerate(sigs):
        for dte in DTES:
            exp = ob2.fridays_near(g["day"], dte)
            end = min(date.fromisoformat(exp), date.fromisoformat(g["exitDay"]) + timedelta(days=4)).isoformat()
            data[(g["sym"], g["day"], dte)] = ob2.opt_daily([dr.occ(g["sym"], exp, "C", k) for k in strikes(g["px"])], g["day"], end)
        if n % 50 == 0:
            print("fetched", n, "of", len(sigs), file=sys.stderr)
    res = analyse(sigs, data, dr.SPLIT)
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "researchOnly": True, "split": dr.SPLIT, "capUsd": CAP, "maxStockPriceUsd": MAX_PX,
           "universe": "optbuy_config.json scanUniverse", "namesWithSignals": names, "noPriceHistory": skipped,
           "rule": "Dip signal on names priced $25 or less; the call closest to the price costing $50 or less; exit by the stock rule.",
           "limits": ["Earnings dates are not skipped: single stocks can gap on a report.", "The list is today's liquid names; companies that were delisted are missing.",
                      "Thinly traded contracts fill worse than the standard model assumes: read the wideGap figures too (4 cents or 8% between buy and sell).",
                      "Split-adjusted prices can hide contracts around a stock split; those signals count as no contract found."],
           "note": "Research only, real historical option prices. Past results do not predict future results.", **res}
    json.dump(out, open(OUT, "w"), indent=1)
    for r in res["rows"]:
        print(r["dte"], "days | no contract fit", r["noAffordableContract"], "of", r["signals"], "\n   TRAIN", r["train"], "\n   TEST ", r["test"])
    print("verdict:", res["verdict"], res["settingsPositiveBoth"])


if __name__ == "__main__":
    main()
