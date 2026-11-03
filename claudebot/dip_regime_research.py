#!/usr/bin/env python3
"""Issue #106 (RESEARCH ONLY): do volatility / trend-slope filters make the live Dip desk safer?

Baseline = the live Dip rules exactly (dip_config.json): buy at the close when RSI(2) < 5 and the
close is above the 200-day average; sell at the close when close > 5-day average or RSI(2) > 70,
after 10 days, or on a 5% stop (checked on closes, so a gap can fill worse than -5%: reported).
Costs 0.03% per side. Live funds: SMH IWM SPY DIA XLK KRE QQQ.

Filters tested (entry is skipped when the filter says "risky"):
  vol<T    trailing 20-day realized volatility (annualized) below T% (T = 20, 25, 30, 35, 40)
  slope>0  200-day average higher than it was N days ago (N = 20, 50)
  both     vol<T and slope>0
Pick period 2018-2022 (includes the 2018 Q4 selloff, the 2020 crash and the 2022 bear market);
the setting is frozen and then checked on unseen 2023-now, year by year. A filter is recommended
only if it beats the baseline on BOTH periods in average return per trade AND worst-trade/tail,
while keeping at least 60% of the baseline's trades. It never changes live rules by itself:
any change still needs the board's explicit approval. Writes docs/data/claudebot-dip-regime.json.
"""
from __future__ import annotations

import importlib.util
import json
import math
import os
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-dip-regime.json")
SYMS = ["SMH", "IWM", "SPY", "DIA", "XLK", "KRE", "QQQ"]
COST, START, PICK_END, TEST_START = 0.0003, "2018-01-01", "2023-01-01", "2023-01-01"


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


def vol20(c, i):
    r = [math.log(c[k] / c[k - 1]) for k in range(i - 19, i + 1)]
    m = sum(r) / len(r)
    return 100 * math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1)) * math.sqrt(252)


def ok_filter(c, i, f):
    if f["kind"] == "none":
        return True
    v_ok = vol20(c, i) < f["vol"] if f.get("vol") else True
    s_ok = sma(c, 200, i) > sma(c, 200, i - f["slope"]) if f.get("slope") else True
    return v_ok and s_ok


def run(bars, f):
    d = [x for x, _ in bars]; c = [x for _, x in bars]; r = rsi2(c); out = []; pos = None
    for i in range(260, len(c)):
        if pos:
            held = i - pos["i"]; why = None
            if c[i] <= pos["px"] * 0.95: why = "stop"
            elif c[i] > sma(c, 5, i) or r[i] > 70: why = "bounce"
            elif held >= 10: why = "time"
            if why:
                out.append({"in": d[pos["i"]], "ret": c[i] / pos["px"] * (1 - COST) / (1 + COST) - 1, "why": why, "days": held}); pos = None
            continue
        if d[i] >= START and c[i] > sma(c, 200, i) and r[i] < 5 and ok_filter(c, i, f):
            pos = {"i": i, "px": c[i]}
    return out


def summ(t):
    if not t:
        return {"trades": 0}
    rets = sorted(x["ret"] for x in t); w = [x for x in rets if x > 0]; l = [x for x in rets if x <= 0]
    k = max(1, len(rets) // 20)
    return {"trades": len(t), "winRatePct": round(100 * len(w) / len(t), 1), "avgTradePct": round(100 * sum(rets) / len(t), 3),
            "medianTradePct": round(100 * rets[len(rets) // 2], 3), "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None,
            "worstTradePct": round(100 * rets[0], 2), "worst5PctAvgPct": round(100 * sum(rets[:k]) / k, 2),
            "stops": sum(1 for x in t if x["why"] == "stop"), "gapsThroughStop": sum(1 for x in t if x["why"] == "stop" and x["ret"] < -0.0506)}


def main():
    spec = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py"))
    ob = importlib.util.module_from_spec(spec); spec.loader.exec_module(ob)
    data = {s: ob.daily_bars(s, "2016-06-01")[0] for s in SYMS}
    filters = [{"kind": "none", "name": "baseline (live rules)"}]
    filters += [{"kind": "vol", "vol": v, "name": f"vol<{v}%"} for v in (20, 25, 30, 35, 40)]
    filters += [{"kind": "slope", "slope": n, "name": f"200d avg rising over {n}d"} for n in (20, 50)]
    filters += [{"kind": "both", "vol": v, "slope": n, "name": f"vol<{v}% and rising {n}d"} for v in (25, 30, 35) for n in (20, 50)]
    rows = []
    for f in filters:
        t = [x for s in SYMS for x in run(data[s], f)]
        pick = [x for x in t if x["in"] < PICK_END]; test = [x for x in t if x["in"] >= TEST_START]
        years = sorted({x["in"][:4] for x in test})
        rows.append({"filter": f, "pick": summ(pick), "test": summ(test), "testByYear": {y: summ([x for x in test if x["in"][:4] == y]) for y in years}})
    base = rows[0]

    def better(a, b, keep):
        return (a.get("trades", 0) >= keep * b.get("trades", 0) and (a.get("avgTradePct") or -9) > (b.get("avgTradePct") or -9)
                and (a.get("worst5PctAvgPct") or -99) >= (b.get("worst5PctAvgPct") or -99))
    cands = [r for r in rows[1:] if better(r["pick"], base["pick"], 0.6)]
    chosen = max(cands, key=lambda r: r["pick"]["avgTradePct"]) if cands else None
    held_up = bool(chosen and better(chosen["test"], base["test"], 0.6))
    verdict = ("filter helps" if held_up else "no improvement") if chosen else "no improvement"
    text = (f"'{chosen['filter']['name']}' was best on 2018-22 and also beat the baseline on unseen 2023-now. Recommend to the board (not switched on automatically)."
            if held_up else
            f"'{chosen['filter']['name']}' looked better on 2018-22 but did not hold up on unseen 2023-now. Keep the live rules unchanged." if chosen else
            "No filter beat the baseline on 2018-22 without cutting too many trades or worsening the worst losses. Keep the live rules unchanged.")
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "issue": 106, "researchOnly": True, "symbols": SYMS,
           "periods": {"pick": f"{START[:4]}-2022", "test": "2023-now"}, "baseline": base, "chosenOnPick": chosen,
           "verdict": verdict, "verdictText": text, "all": rows,
           "rule": "Recommend only if better on BOTH periods in avg return and worst-5% losses while keeping >=60% of trades. Live rules change only with board approval."}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1); fh.write("\n")
    print(text)
    for r in rows:
        print(f"{r['filter']['name']:28s} PICK {r['pick']}  TEST {r['test']}")


if __name__ == "__main__":
    main()
