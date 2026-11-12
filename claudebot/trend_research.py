#!/usr/bin/env python3
"""Trend following on the bot's ETFs (board, 2026-11-11, from a TikTok idea: 20/50 EMA trend following).
RESEARCH ONLY: long only (the account cannot short), daily closes, the live Dip desk's 7 funds.

Variants (all buy and sell at the close, 0.03% cost per side):
  ema_cross   hold while the 20-day EMA is above the 50-day EMA
  ema_price   hold while the close is above the 20-day EMA and the 20-day EMA is above the 50-day EMA
  sma200      hold while the close is above the 200-day average (classic slow trend filter)
Compared with simply holding the same fund, and with the live Dip rule (RSI(2) < 5 above the 200-day,
sell back above the 5-day average / 10 days / 5% stop) on the same data. Periods: up to 2022, 2023-now.
The second question: does trend following make money when the Dip rule does not (does it diversify)?
Writes docs/data/claudebot-trend-research.json. Past results do not predict future results.
"""
from __future__ import annotations

import importlib.util
import json
import os
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-trend-research.json")
sp = importlib.util.spec_from_file_location("db", os.path.join(HERE, "dip_backtest.py")); db = importlib.util.module_from_spec(sp); sp.loader.exec_module(db)
SYMS = ["SMH", "IWM", "SPY", "DIA", "XLK", "KRE", "QQQ"]
COST, SPLIT = 0.0003, "2023-01-01"


def ema(c, n):
    k, e, out = 2 / (n + 1), None, []
    for x in c:
        e = x if e is None else e + k * (x - e); out.append(e)
    return out


def positions(c, kind):
    """1 = hold at the close of day i, else 0."""
    e20, e50 = ema(c, 20), ema(c, 50); pos = []
    for i in range(len(c)):
        if i < 200:
            pos.append(0); continue
        if kind == "ema_cross":
            pos.append(1 if e20[i] > e50[i] else 0)
        elif kind == "ema_price":
            pos.append(1 if c[i] > e20[i] > e50[i] else 0)
        else:
            pos.append(1 if c[i] > sum(c[i - 199:i + 1]) / 200 else 0)
    return pos


def daily_returns(c, pos):
    """Return earned on day i from the position held at the close of day i-1, costs on each change."""
    r = [0.0]
    for i in range(1, len(c)):
        x = pos[i - 1] * (c[i] / c[i - 1] - 1)
        if pos[i] != pos[i - 1]:
            x -= COST
        r.append(x)
    return r


def dip_returns(c):
    r, pos, held = [0.0] * len(c), None, 0
    r2 = db.rsi2(c)
    for i in range(1, len(c)):
        if pos is not None:
            r[i] = c[i] / c[i - 1] - 1; held += 1
            chg = c[i] / pos - 1
            if chg <= -0.05 or c[i] > db.sma(c, 5, i) or r2[i] > 70 or held >= 10:
                r[i] -= COST; pos = None
            continue
        if i >= 200 and c[i] > db.sma(c, 200, i) and r2[i] < 5:
            pos, held = c[i], 0; r[i] -= COST
    return r


def stats(days, rets):
    if not rets:
        return {}
    eq, peak, dd, inmkt = 1.0, 1.0, 0.0, sum(1 for x in rets if x != 0)
    for x in rets:
        eq *= 1 + x; peak = max(peak, eq); dd = min(dd, eq / peak - 1)
    yrs = len(rets) / 252
    return {"totalPct": round(100 * (eq - 1), 1), "perYearPct": round(100 * (eq ** (1 / yrs) - 1), 1) if yrs > 0 else None,
            "worstDropPct": round(100 * dd, 1), "daysInMarketPct": round(100 * inmkt / len(rets), 0), "from": days[0], "to": days[-1]}


def main():
    res, first = {}, {}
    per = {"to-2022": lambda d: d < SPLIT, "2023-now": lambda d: d >= SPLIT}
    corr_pairs = []
    for s in SYMS:
        bars, _ = db.ob.daily_bars(s, "2017-01-01"); d = [x for x, _ in bars]; c = [x for _, x in bars]; first[s] = d[0]
        hold = [0.0] + [c[i] / c[i - 1] - 1 for i in range(1, len(c))]
        series = {"buyAndHold": hold, "dipRule": dip_returns(c), **{k: daily_returns(c, positions(c, k)) for k in ("ema_cross", "ema_price", "sma200")}}
        res[s] = {}
        for name, r in series.items():
            res[s][name] = {p: stats([x for x in d[200:] if f(x)], [y for x, y in zip(d[200:], r[200:]) if f(x)]) for p, f in per.items()}
        # does trend make money in the months the dip rule loses?
        months = {}
        for x, a, b in zip(d[200:], series["dipRule"][200:], series["ema_cross"][200:]):
            m = months.setdefault(x[:7], [0.0, 0.0]); m[0] += a; m[1] += b
        bad = [v for v in months.values() if v[0] < -0.005]
        corr_pairs.append({"fund": s, "dipLosingMonths": len(bad), "trendInThoseMonthsAvgPct": round(100 * sum(v[1] for v in bad) / len(bad), 2) if bad else None})
    avg = {}
    for name in ("buyAndHold", "dipRule", "ema_cross", "ema_price", "sma200"):
        avg[name] = {p: {k: round(sum(res[s][name][p].get(k) or 0 for s in SYMS) / len(SYMS), 1) for k in ("totalPct", "perYearPct", "worstDropPct", "daysInMarketPct")} for p in per}
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "researchOnly": True, "funds": SYMS, "firstBar": first,
           "note": "Long only, daily closes, 0.03% per side. Averages are across the 7 funds. Past results do not predict future results.",
           "averageAcrossFunds": avg, "byFund": res, "inDipLosingMonths": corr_pairs}
    json.dump(out, open(OUT, "w"), indent=1)
    for name, v in avg.items():
        print(f"{name:11}", "| to-2022:", v["to-2022"], "| 2023-now:", v["2023-now"])
    print(corr_pairs)


if __name__ == "__main__":
    main()
