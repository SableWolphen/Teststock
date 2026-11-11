#!/usr/bin/env python3
"""The winning dip-call recipe with contracts the account can afford (board, 2026-11-11: "can't we
just do the same but cheaper options we can afford"). RESEARCH ONLY, real historical option prices.

Everything is the same as claudebot/dipcall_research.py: the signal (Dip signal: RSI(2) < 5 above the
200-day average), the 8 funds, the exit (the fund closes back above its 5-day average, 10 days, or a
5% adverse move), the 30/45/60-day expiries and the fill model. The ONLY change is the contract:
instead of at/in the money (about $950-3,200 each), buy the call CLOSEST TO THE PRICE that costs $50 or
less with fees, which is as much option as the bot's cap can buy. Strikes are searched from the price
up to 15% above it.

Reported per expiry: the pick period (2024) and the unseen period (2025-26), how far above the price
the affordable contract sat, how often no contract fit at all, and results by fund.
Writes docs/data/claudebot-dipcall-cheap-research.json. Never trades. Past results do not predict
future results.
"""
from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-dipcall-cheap-research.json")
sp = importlib.util.spec_from_file_location("dr", os.path.join(HERE, "dipcall_research.py"))
dr = importlib.util.module_from_spec(sp); sp.loader.exec_module(dr)
ob2 = dr.ob2
CAP, MAX_OTM, DTES = 50.0, 0.15, (30, 45, 60)


def otm_strikes(px):
    step = 0.5 if px < 100 else 1.0
    k = math.ceil(px / step - 1e-9) * step; out = []
    while k <= px * (1 + MAX_OTM) + 1e-9:
        out.append(round(k, 2)); k += step
    return out


def pick(g, bars_by):
    """The call closest to the price that traded on the signal day and costs <= CAP including the fee."""
    best = None
    for sym, bars in bars_by.items():
        b = bars.get(g["day"])
        if not b or b[4] < 3:
            continue
        entry = ob2.buy_px(g["sym"], b[3])
        if entry * 100 + dr.FEE > CAP:
            continue
        k = int(sym[-8:]) / 1000
        if best is None or k < best[0]:
            best = (k, sym, entry)
    return best


def run(sigs, dte, data):
    trades, nofit, noexit = [], 0, 0
    for g in sigs:
        bars_by = data.get((g["sym"], g["day"], dte), {})
        best = pick(g, bars_by)
        if not best:
            nofit += 1; continue
        k, sym, entry = best; bars = bars_by[sym]
        xb = bars.get(g["exitDay"])
        if not xb:                                  # no trade that day: use the last bar before it, minus a tick
            prior = [d for d in bars if g["day"] < d <= g["exitDay"]]
            if not prior:
                noexit += 1; continue
            ex = ob2.sell_px(g["sym"], bars[max(prior)][3]) - 0.01
        else:
            ex = ob2.sell_px(g["sym"], xb[3])
        ex = max(0.0, ex)
        pnl = (ex - entry) * 100 - 2 * dr.FEE
        trades.append({"day": g["day"], "sym": g["sym"], "contract": sym, "entry": entry, "exit": round(ex, 2),
                       "premiumUsd": round(entry * 100, 2), "otmPct": round(100 * (k / g["px"] - 1), 1), "pnl": round(pnl, 2),
                       "retPct": round(100 * pnl / (entry * 100 + dr.FEE), 1), "etfRetPct": g["etfRetPct"]})
    return trades, nofit, noexit


def summ(t):
    s = dr.summ(t)
    if t:
        s["avgOtmPct"] = round(sum(x["otmPct"] for x in t) / len(t), 1)
        s["netUsd"] = s.pop("netUsdOneContractEach")
        s.pop("affordableAt117Pct", None)
    return s


def analyse(sigs, data, split):
    rows = []
    for dte in DTES:
        t, nofit, noexit = run(sigs, dte, data)
        by = {}
        for x in t:
            by.setdefault(x["sym"], []).append(x)
        rows.append({"dte": dte, "signals": len(sigs), "noAffordableContract": nofit, "noExitPrice": noexit,
                     "train": summ([x for x in t if x["day"] < split]), "test": summ([x for x in t if x["day"] >= split]),
                     "byFund": {s: summ(v) for s, v in sorted(by.items())}})
    cand = [r for r in rows if r["train"].get("trades", 0) >= 5]
    best = max(cand, key=lambda r: r["train"].get("avgRetPct", -99)) if cand else None
    both = [r for r in cand if (r["train"].get("avgRetPct") or -1) > 0 and (r["test"].get("avgRetPct") or -1) > 0]
    held = bool(best and (best["test"].get("avgRetPct") or -1) > 0 and (best["test"].get("profitFactor") or 0) > 1.2 and best["test"].get("trades", 0) >= 10)
    return {"rows": rows, "chosenOnPick": best and {k: best[k] for k in ("dte", "train", "test")},
            "settingsPositiveBoth": f"{len(both)}/{len(cand)}", "verdict": "held up" if held else "did not hold up"}


def main():
    ob2.H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    sp2 = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); obm = importlib.util.module_from_spec(sp2); sp2.loader.exec_module(obm)
    days = {s: obm.daily_bars(s, "2023-01-01")[0] for s in dr.SYMS}
    sigs = [g for g in dr.signals(days) if g["side"] == "C"]
    print("call signals", len(sigs), file=sys.stderr)
    data = {}
    for n, g in enumerate(sigs):
        for dte in DTES:
            exp = ob2.fridays_near(g["day"], dte)
            end = min(date.fromisoformat(exp), date.fromisoformat(g["exitDay"]) + timedelta(days=4)).isoformat()
            syms = [dr.occ(g["sym"], exp, "C", k) for k in otm_strikes(g["px"])]
            got = {}
            for i in range(0, len(syms), 90):
                got.update(ob2.opt_daily(syms[i:i + 90], g["day"], end))
            data[(g["sym"], g["day"], dte)] = got
        if n % 20 == 0:
            print("fetched", n, "of", len(sigs), file=sys.stderr)
    res = analyse(sigs, data, dr.SPLIT)
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "researchOnly": True, "split": dr.SPLIT, "capUsd": CAP, "maxOtmPct": 100 * MAX_OTM,
           "rule": "Same Dip signal, same funds, same exit as the dip-call research; contract = the call closest to the price costing $50 or less with fees.",
           "note": "Research only, real historical option prices. Past results do not predict future results.", **res}
    json.dump(out, open(OUT, "w"), indent=1)
    for r in res["rows"]:
        print(r["dte"], "days | no contract fit", r["noAffordableContract"], "of", r["signals"], "| TRAIN", r["train"], "| TEST", r["test"])
    print("verdict:", res["verdict"], res["settingsPositiveBoth"])


if __name__ == "__main__":
    main()
