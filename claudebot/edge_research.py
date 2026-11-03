#!/usr/bin/env python3
"""Second-edge research (CEO, 2026-11-02): classic daily ETF strategies, tested on history. RESEARCH ONLY.

Strategies (long only, whole-day closes, one position per fund):
  tom     Turn of the month: buy at the close of the last trading day of the month, sell at the
          close of the Nth trading day of the new month (N = 2, 3, 4).
  down3   N down closes in a row while above the 200-day average; sell on the first up close or
          after M days (N = 3, 4; M = 5, 10).
  double7 Close at a K-day low while above the 200-day average; sell at a K-day high or after
          10 days (K = 5, 7, 10).
Costs 0.03% per side. Pick period 2016-2022, unseen check 2023-now. A strategy "wins" only if its
best-on-pick settings are also profitable on unseen data AND most nearby settings are too.
Also reports how often each one overlaps the live Dip desk (so it would add trades, not repeat them).
Writes docs/data/claudebot-edge-research.json.
"""
from __future__ import annotations

import importlib.util
import itertools
import json
import os
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-edge-research.json")
SYMS = ["SPY", "QQQ", "DIA", "IWM", "SMH", "XLK", "KRE", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU"]
COST, SPLIT, START = 0.0003, "2023-01-01", "2016-01-01"


def rsi2(c, i):
    g = l = 0.0
    for k in range(i - 30, i + 1):
        d = c[k] - c[k - 1]; up, dn = max(d, 0), max(-d, 0)
        g = (g + up) / 2; l = (l + dn) / 2
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def run(bars, kind, p):
    d = [x for x, _ in bars]; c = [x for _, x in bars]; out = []; i = 210
    while i < len(c) - 1:
        sma = sum(c[i - 199:i + 1]) / 200
        entry = False
        if kind == "tom":
            entry = d[i][:7] != d[i + 1][:7]                      # last trading day of the month
        elif kind == "down3":
            entry = c[i] > sma and all(c[i - k] < c[i - k - 1] for k in range(p["n"]))
        elif kind == "double7":
            entry = c[i] > sma and c[i] <= min(c[i - p["k"] + 1:i + 1])
        if not entry or d[i] < START:
            i += 1; continue
        j = i + 1
        while j < len(c):
            held = j - i
            if kind == "tom" and held >= p["n"]: break
            if kind == "down3" and (c[j] > c[j - 1] or held >= p["m"]): break
            if kind == "double7" and (c[j] >= max(c[j - p["k"] + 1:j + 1]) or held >= 10): break
            j += 1
        j = min(j, len(c) - 1)
        out.append({"in": d[i], "out": d[j], "ret": c[j] / c[i] * (1 - COST) / (1 + COST) - 1, "days": j - i,
                    "dip": c[i] > sma and rsi2(c, i) < 5})
        i = j + 1
    return out


def summ(t):
    if not t:
        return {"trades": 0}
    w = [x["ret"] for x in t if x["ret"] > 0]; l = [x["ret"] for x in t if x["ret"] <= 0]
    return {"trades": len(t), "winRatePct": round(100 * len(w) / len(t), 1), "avgTradePct": round(100 * sum(w + l) / len(t), 3),
            "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, "avgDays": round(sum(x["days"] for x in t) / len(t), 1),
            "overlapWithDipPct": round(100 * sum(1 for x in t if x["dip"]) / len(t), 1)}


def main():
    sp = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); ob = importlib.util.module_from_spec(sp); sp.loader.exec_module(ob)
    data = {}
    for s in SYMS:
        try:
            data[s] = ob.daily_bars(s, "2015-01-01")[0]
        except Exception as e:  # noqa: BLE001
            print(s, "failed", e)
    grids = {"tom": [{"n": n} for n in (2, 3, 4)],
             "down3": [{"n": n, "m": m} for n, m in itertools.product((3, 4), (5, 10))],
             "double7": [{"k": k} for k in (5, 7, 10)]}
    names = {"tom": "Turn of the month", "down3": "Down days in an uptrend", "double7": "New short-term low in an uptrend (Double 7s)"}
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "symbols": list(data), "pickPeriod": [START, SPLIT], "costPerSidePct": COST * 100, "strategies": {}}
    for kind, grid in grids.items():
        rows = []
        for p in grid:
            t = [x for s in data for x in run(data[s], kind, p)]
            rows.append({"params": p, "train": summ([x for x in t if x["in"] < SPLIT]), "test": summ([x for x in t if x["in"] >= SPLIT])})
        best = max(rows, key=lambda r: r["train"].get("avgTradePct") or -9)
        pos = sum(1 for r in rows if (r["test"].get("avgTradePct") or -1) > 0)
        won = (best["test"].get("avgTradePct") or -1) > 0.05 and (best["test"].get("profitFactor") or 0) >= 1.2 and pos > len(rows) / 2
        out["strategies"][kind] = {"name": names[kind], "chosenOnTrain": best, "combosPositiveTest": f"{pos}/{len(rows)}", "verdict": "edge" if won else "no-edge", "all": rows}
        print(kind, best["params"], "TRAIN", best["train"], "TEST", best["test"], pos, "/", len(rows), "edge" if won else "no-edge")
    json.dump(out, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
