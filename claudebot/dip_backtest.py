#!/usr/bin/env python3
"""Strategist research: RSI(2) dip-buying on index ETFs (long only, fractional shares).

Rule family (classic short-term mean reversion):
  enter at the close when RSI(2) < entry AND close > trend average (uptrend filter)
  exit at the close when close > SMA(5) (or RSI(2) > 70), or after max_hold days,
  or on a stop at -stop_pct from entry (checked on closes).
Costs: 0.03% per side (spread/slippage on liquid ETFs; Robinhood has no commission).
Train 2023-01..2024-12, test 2025-01..now (walk-forward style, test never used for picking).
Writes docs/data/claudebot-dip-backtest.json.
"""
import importlib.util, itertools, json, os, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py"))
ob = importlib.util.module_from_spec(spec); spec.loader.exec_module(ob)
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-dip-backtest.json")
SYMS = ["SPY", "QQQ", "DIA", "IWM"]
COST = 0.0003
SECTORS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "SMH", "KRE", "XBI"]


def rsi2(c):
    out = [50.0] * len(c); g = l = 0.0
    for i in range(1, len(c)):
        d = c[i] - c[i - 1]; up, dn = max(d, 0), max(-d, 0)
        if i <= 2: g += up / 2; l += dn / 2
        else: g = (g + up) / 2; l = (l + dn) / 2
        if i >= 2: out[i] = 100.0 if l == 0 else 100 - 100 / (1 + g / l)
    return out


def sma(c, n, i):
    return sum(c[i - n + 1:i + 1]) / n if i >= n - 1 else None


def run(bars, p):
    dates = [d for d, _ in bars]; c = [x for _, x in bars]; r = rsi2(c)
    trades, pos = [], None
    for i in range(210, len(c)):
        if pos:
            held = i - pos["i"]; s5 = sma(c, 5, i)
            why = None
            if c[i] <= pos["px"] * (1 - p["stop"]): why = "stop"
            elif c[i] > s5 or r[i] > 70: why = "bounce"
            elif held >= p["hold"]: why = "time"
            if why:
                ret = c[i] / pos["px"] * (1 - COST) / (1 + COST) - 1
                trades.append({"in": dates[pos["i"]], "out": dates[i], "ret": ret, "why": why, "days": held}); pos = None
            continue
        tr = sma(c, p["trend"], i)
        if tr and c[i] > tr and r[i] < p["entry"]:
            pos = {"i": i, "px": c[i]}
    return trades


def summ(t):
    if not t: return {"trades": 0}
    w = [x["ret"] for x in t if x["ret"] > 0]; l = [x["ret"] for x in t if x["ret"] <= 0]
    eq = 1.0
    for x in t: eq *= 1 + x["ret"]
    return {"trades": len(t), "winRatePct": round(100 * len(w) / len(t), 1), "avgTradePct": round(100 * sum(w + l) / len(t), 3),
            "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, "compoundedPct": round(100 * (eq - 1), 2),
            "avgDays": round(sum(x["days"] for x in t) / len(t), 1)}


def main():
    data = {s: ob.daily_bars(s, "2022-01-01")[0] for s in SYMS}
    grid = []
    for entry, trend, hold, stop in itertools.product((5, 10, 15), (200, 50), (5, 10), (0.03, 0.05, 1.0)):
        p = dict(entry=entry, trend=trend, hold=hold, stop=stop)
        tr = {s: run(data[s], p) for s in SYMS}
        allt = [x for v in tr.values() for x in v]
        train = [x for x in allt if x["in"] < "2025-01-01"]; test = [x for x in allt if x["in"] >= "2025-01-01"]
        grid.append({"params": p, "train": summ(train), "test": summ(test), "bySymbolTest": {s: summ([x for x in v if x["in"] >= "2025-01-01"]) for s, v in tr.items()}})
    ok = [g for g in grid if g["train"].get("trades", 0) >= 30]
    best = max(ok, key=lambda g: (g["train"].get("avgTradePct") or -9))
    positive_test = sum(1 for g in ok if (g["test"].get("avgTradePct") or -1) > 0)
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "symbols": SYMS, "costPerSidePct": COST * 100,
           "chosenOnTrain": best, "combosWithPositiveTest": f"{positive_test}/{len(ok)}",
           "top": sorted(ok, key=lambda g: -(g["train"].get("avgTradePct") or -9))[:10]}
    # Sector Analyst: does the LIVE rule (chosen on index ETFs) also work on sector funds?
    # Parameters are frozen (no re-fitting), so this is a clean out-of-sample check per fund.
    live = best["params"]; sec = {}
    for s in SECTORS:
        try:
            bars = ob.daily_bars(s, "2022-01-01")[0]
        except Exception as e:  # noqa: BLE001
            sec[s] = {"error": str(e)[:80]}; continue
        t = run(bars, live)
        sec[s] = {"train": summ([x for x in t if x["in"] < "2025-01-01"]), "test": summ([x for x in t if x["in"] >= "2025-01-01"])}
    good = [s for s, v in sec.items() if v.get("train", {}).get("trades", 0) >= 8 and (v["train"].get("avgTradePct") or -1) > 0.3
            and v.get("test", {}).get("trades", 0) >= 5 and (v["test"].get("avgTradePct") or -1) > 0.3 and (v["test"].get("profitFactor") or 0) >= 1.5]
    out["sectorScan"] = {"params": live, "rule": "add a fund only if train avg > 0.3%/trade (8+ trades) AND test avg > 0.3% with PF >= 1.5 (5+ trades)",
                         "bySymbol": sec, "qualified": good}
    print("SECTOR qualified:", good)
    for s, v in sec.items():
        print(s, v)
    json.dump(out, open(OUT, "w"), indent=1)
    print(json.dumps({k: out[k] for k in ("chosenOnTrain", "combosWithPositiveTest")}, indent=1))
    for g in out["top"]:
        print(g["params"], "TRAIN", g["train"], "TEST", g["test"])


if __name__ == "__main__":
    main()
