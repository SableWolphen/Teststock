#!/usr/bin/env python3
"""Intraday single-leg options scalping research (board request 2026-11-02). RESEARCH ONLY.

Data: REAL historical 5-minute option trade bars (Alpaca, Feb 2024 on, expired contracts included)
and 5-minute underlying bars for SPY, QQQ, IWM. Train 2024-02..2024-12 (choose), test 2025-01..now.

Signals (on the underlying, both directions, fresh crosses only):
  orb    15-min opening range breakout: call when a bar closes above the range high and above VWAP;
         put when it closes below the range low and below VWAP.
  vwapx  after 10:00 ET, EMA9 crosses EMA21, price on the same side of VWAP and of the day's open.
Filters: liquidity (the option traded in the previous 5-min bar, >= 3 trades, price >= $0.05),
optional trend filter (calls only above the 20-day average, puts only below), volatility filter
(skip days when the prior VIX close is above 30).
Contract: 0DTE or 1DTE, the closest-to-the-money call/put whose price fits the budget.
Fills (realistic): buy = next bar's first trade + half a spread rounded UP to the cent; sell = price
minus half a spread rounded DOWN; stops fill a further $0.01 worse. Spread model from live
Robinhood quotes on 2026-11-02 ($0.01 under $1, $0.02 under $3, $0.03 above). Fees $0.05/contract/side.
Exits: take profit +5/8/10% (resting limit), stop -15/-25%, time stop 30/60 min, flat by 15:30 ET.
Risk: one position at a time, max 4 trades/day, stop for the day after -8% of the day's starting
equity, no averaging down, size = min(25% of equity, budget) per trade.
Accounts simulated: $120 (today's size) and $1,000 (for comparison). Writes
docs/data/claudebot-scalp-backtest.json.
"""
from __future__ import annotations

import importlib.util
import bisect
import itertools
import json
import math
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "docs", "data", "claudebot-scalp-backtest.json")
ET = ZoneInfo("America/New_York")
UNDS = ["SPY", "QQQ", "IWM"]
START, SPLIT = "2024-02-01", "2025-01-01"
FEE = 0.05
H = None


def spread(p):
    return 0.01 if p < 1 else 0.02 if p < 3 else 0.03


def buy_px(p):
    return math.ceil(round((p + spread(p) / 2) * 100, 6)) / 100


def sell_px(p):
    return max(0.01, math.floor(round((p - spread(p) / 2) * 100, 6)) / 100)


def get(url):
    for i in range(4):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60).read())
        except Exception as e:  # noqa: BLE001
            if i == 3:
                print("fetch failed", url[:120], e, file=sys.stderr); return {}
            time.sleep(2 + 3 * i)


def mins(ts):
    t = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(ET)
    return t.date().isoformat(), t.hour * 60 + t.minute


def stock_bars(sym):
    out, tok = {}, None
    while True:
        d = get(f"https://data.alpaca.markets/v2/stocks/{sym}/bars?timeframe=5Min&start=2024-01-01T00:00:00Z&adjustment=split&feed=iex&limit=10000" + (f"&page_token={tok}" if tok else ""))
        for b in d.get("bars") or []:
            day, m = mins(b["t"])
            if 570 <= m < 960:
                out.setdefault(day, []).append((m, b["o"], b["h"], b["l"], b["c"], max(b["v"], 1)))
        tok = d.get("next_page_token")
        if not tok:
            return out


def occ(und, exp, cp, k):
    return f"{und}{exp[2:4]}{exp[5:7]}{exp[8:10]}{cp}{int(round(k * 1000)):08d}"


def option_day(und, day, exps, s0):
    step = 1
    lo, hi = math.floor(s0 * 0.985), math.ceil(s0 * 1.015)
    syms = [occ(und, e, cp, k) for e in exps for cp in "CP" for k in range(lo, hi + 1, step)]
    res = {}
    for i in range(0, len(syms), 100):
        chunk, tok = syms[i:i + 100], None
        while True:
            d = get("https://data.alpaca.markets/v1beta1/options/bars?timeframe=5Min&limit=10000"
                    f"&start={day}T13:00:00Z&end={day}T21:30:00Z&symbols={','.join(chunk)}" + (f"&page_token={tok}" if tok else ""))
            for s, bars in (d.get("bars") or {}).items():
                for b in bars:
                    dd, m = mins(b["t"])
                    if dd == day:
                        res.setdefault(s, {})[m] = (b["o"], b["h"], b["l"], b["c"], b.get("n", 0))
            tok = d.get("next_page_token")
            if not tok:
                break
        time.sleep(0.32)
    return res


def ema(vals, n):
    k, out, e = 2 / (n + 1), [], None
    for v in vals:
        e = v if e is None else e + k * (v - e); out.append(e)
    return out


def signals(bars):
    """-> list of (minute_of_signal_bar, kind, dir) with dir +1 call / -1 put."""
    m = [b[0] for b in bars]; c = [b[4] for b in bars]
    pv = vol = 0.0; vw = []
    for b in bars:
        tp = (b[2] + b[3] + b[4]) / 3; pv += tp * b[5]; vol += b[5]; vw.append(pv / vol)
    out = []
    if len(bars) < 10:
        return out
    orh, orl = max(b[2] for b in bars[:3]), min(b[3] for b in bars[:3])
    e9, e21 = ema(c, 9), ema(c, 21); o0 = bars[0][1]
    for i in range(3, len(bars)):
        if m[i] > 900:   # no new entries after 15:00 ET (14:00 CT)
            break
        if c[i] > orh >= c[i - 1] and c[i] > vw[i]:
            out.append((m[i], "orb", 1))
        if c[i] < orl <= c[i - 1] and c[i] < vw[i]:
            out.append((m[i], "orb", -1))
        if m[i] >= 600 and i >= 1:
            if e9[i] > e21[i] and e9[i - 1] <= e21[i - 1] and c[i] > vw[i] and c[i] > o0:
                out.append((m[i], "vwapx", 1))
            if e9[i] < e21[i] and e9[i - 1] >= e21[i - 1] and c[i] < vw[i] and c[i] < o0:
                out.append((m[i], "vwapx", -1))
    return out


def next_weekday(d):
    d = date.fromisoformat(d) + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.isoformat()


def run_day(sim, p, day, events, opt, cand):
    """Simulate one day for one parameter set; mutates sim (equity, trades, curve)."""
    eq0 = sim["eq"]; day_pnl = 0.0; n_today = 0; free_at = 0
    for (m, und, kind, dr, exp_k) in events:
        if kind != p["sig"] or exp_k != p["dte"] or m < free_at or n_today >= 4 or day_pnl <= -0.08 * eq0:
            continue
        if p["trend"] and dr * sim["trend"][und].get(day, 0) <= 0:
            continue
        budget = min(sim["eq"] * 0.25, sim["eq"] - 1)
        cands = cand.get((m, und, exp_k, dr), [])
        j = bisect.bisect_right(cands, ((budget - FEE) / 100, "\uffff")) - 1   # (px, sym) sorted; highest price that fits
        if j < 0:
            continue
        best = (cands[j][1], cands[j][0]); cp = "C" if dr > 0 else "P"
        s, entry = best; bars = opt[(und, exp_k)][s]
        qty = int(budget // (entry * 100 + FEE))
        if qty < 1:
            continue
        tp = math.ceil(round(entry * (1 + p["tp"] / 100) * 100, 6)) / 100
        st = entry * (1 - p["stop"] / 100)
        exit_px, why, t = None, "cutoff", m + 5
        last = entry
        for t in range(m + 10, 935, 5):
            b = bars.get(t)
            if t - (m + 5) >= p["tstop"] or t >= 930:
                exit_px = sell_px(b[0] if b else last) - (0 if b else 0.01); why = "time" if t < 930 else "cutoff"; break
            if not b:
                continue
            o, h, l, c, n = b
            if sell_px(l) <= st:
                exit_px = max(0.01, min(math.floor(st * 100) / 100, sell_px(o)) - 0.01); why = "stop"; break
            if sell_px(h) >= tp:
                exit_px = tp; why = "target"; break
            last = c
        if exit_px is None:
            exit_px = sell_px(last) - 0.01; t = 930
        pnl = qty * ((exit_px - entry) * 100 - 2 * FEE)
        sim["eq"] += pnl; day_pnl += pnl; n_today += 1; free_at = t
        sim["trades"].append({"day": day, "und": und, "cp": cp, "entry": entry, "exit": exit_px, "qty": qty, "pnl": round(pnl, 2),
                              "ret": round(100 * ((exit_px - entry) * 100 - 2 * FEE) / (entry * 100 + FEE), 2), "why": why, "mins": t - (m + 5)})
        if sim["eq"] <= 5:
            break
    sim["days"].append((day, round(sim["eq"], 2), round(day_pnl, 2)))


def stats(trades, days, eq_start):
    if not trades:
        return {"trades": 0}
    w = [t["pnl"] for t in trades if t["pnl"] > 0]; l = [t["pnl"] for t in trades if t["pnl"] <= 0]
    eq = [eq_start] + [d[1] for d in days]
    peak, mdd = eq[0], 0.0
    for v in eq:
        peak = max(peak, v); mdd = min(mdd, v / peak - 1)
    nd = len(days)
    return {"trades": len(trades), "tradesPerDay": round(len(trades) / max(nd, 1), 2), "winRatePct": round(100 * len(w) / len(trades), 1),
            "avgNetPctPerTrade": round(sum(t["ret"] for t in trades) / len(trades), 2), "netUsd": round(sum(w) + sum(l), 2),
            "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None,
            "endEquity": round(eq[-1], 2), "returnPct": round(100 * (eq[-1] / eq_start - 1), 1), "maxDrawdownPct": round(100 * mdd, 1),
            "worstTradeUsd": round(min(t["pnl"] for t in trades), 2), "worstDayUsd": round(min(d[2] for d in days), 2),
            "bestDayUsd": round(max(d[2] for d in days), 2), "avgHoldMin": round(sum(t["mins"] for t in trades) / len(trades), 1),
            "exits": {k: sum(1 for t in trades if t["why"] == k) for k in ("target", "stop", "time", "cutoff")}}


def main():
    global H
    H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    sp = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); ob = importlib.util.module_from_spec(sp); sp.loader.exec_module(ob)
    try:
        vix = ob.vol_index("VIX")
    except Exception:  # noqa: BLE001
        vix = {}
    und = {u: stock_bars(u) for u in UNDS}
    trend = {}
    for u, days in und.items():
        ds = sorted(days); closes = [days[d][-1][4] for d in ds]; trend[u] = {}
        for i, d in enumerate(ds):
            if i >= 21:
                prev = closes[i - 1]; sma = sum(closes[i - 21:i - 1]) / 20
                trend[u][d] = 1 if prev > sma else -1
    days_all = sorted(d for d in und["SPY"] if d >= START)
    grid = [dict(sig=s, trend=tr, dte=dt, tp=tp, stop=st, tstop=ts) for s, tr, dt, tp, st, ts in
            itertools.product(("orb", "vwapx"), (True, False), (0, 1), (5, 8, 10), (15, 25), (30, 60))]
    modes = {"acct120": 120.0, "acct1000": 1000.0}
    # each period starts fresh from the starting equity, so 2025-26 is judged on its own
    sims = {(mk, i, per): {"eq": e0, "trades": [], "days": [], "trend": trend} for mk, e0 in modes.items() for i in range(len(grid)) for per in ("train", "test")}
    prev_vix = None; fetched = 0
    for day in days_all:
        vprev = None
        if vix:
            ks = [k for k in vix if k < day]
            vprev = vix[ks[-1]] * 100 if ks else None
        events, opt = [], {}
        if vprev is not None and vprev > 30:
            for (mk, i, per), s in sims.items():
                if (day < SPLIT) == (per == "train"):
                    s["days"].append((day, round(s["eq"], 2), 0.0))
            continue
        for u in UNDS:
            bars = und[u].get(day)
            if not bars:
                continue
            sg = signals(bars)
            if not sg:
                continue
            e0, e1 = day, next_weekday(day)
            od = option_day(u, day, [e0, e1], bars[0][1]); fetched += 1
            for k, e in ((0, e0), (1, e1)):
                opt[(u, k)] = {s: v for s, v in od.items() if s[len(u):len(u) + 6] == e[2:4] + e[5:7] + e[8:10]}
            for (m, kind, dr) in sg:
                for k in (0, 1):
                    events.append((m, u, kind, dr, k))
        events.sort()
        cand = {}
        for (m, u, kind, dr, k) in events:
            key = (m, u, k, dr)
            if key in cand:
                continue
            cp = "C" if dr > 0 else "P"; lst = []
            for sym, bars in opt.get((u, k), {}).items():
                if sym[len(u) + 6] != cp:
                    continue
                prev, nxt = bars.get(m), bars.get(m + 5)
                if prev and nxt and prev[4] >= 3 and nxt[0] >= 0.05:
                    lst.append((buy_px(nxt[0]), sym))
            cand[key] = sorted(lst)
        for (mk, i, per), s in sims.items():
            if (day < SPLIT) != (per == "train"):
                continue
            if s["eq"] <= 5:
                s["days"].append((day, round(s["eq"], 2), 0.0)); continue   # account wiped out
            run_day(s, grid[i], day, events, opt, cand)
        if fetched % 50 == 0:
            print(day, "fetched", fetched, file=sys.stderr)
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "underlyings": UNDS, "period": [START, days_all[-1]], "split": SPLIT,
           "dataSource": "Alpaca real 5-min option trade bars + IEX underlying bars", "spreadModel": "$0.01 <$1, $0.02 <$3, $0.03 above (live Robinhood quotes 2026-11-02)",
           "feePerContractPerSide": FEE, "modes": {}}
    for mk, e0 in modes.items():
        rows = []
        for i, p in enumerate(grid):
            a, b = sims[(mk, i, "train")], sims[(mk, i, "test")]
            rows.append({"params": p, "train": stats(a["trades"], a["days"], e0), "test": stats(b["trades"], b["days"], e0)})
        ok = [r for r in rows if r["train"].get("trades", 0) >= 20]
        best = max(ok, key=lambda r: r["train"]["netUsd"]) if ok else None
        pos = sum(1 for r in ok if (r["test"].get("netUsd") or -1) > 0)
        by_tp = {}
        for tpv in (5, 8, 10):
            cand = [r for r in ok if r["params"]["tp"] == tpv]
            if cand:
                b = max(cand, key=lambda r: r["train"]["netUsd"]); by_tp[tpv] = {"params": b["params"], "train": b["train"], "test": b["test"]}
        out["modes"][mk] = {"startEquity": e0, "chosenOnTrain": best, "combosPositiveInTest": f"{pos}/{len(ok)}", "bestByTakeProfit": by_tp,
                            "top10ByTrain": sorted(ok, key=lambda r: -r["train"]["netUsd"])[:10],
                            "allCombos": rows,
                            "sampleTradesChosenTest": sims[(mk, grid.index(best["params"]), "test")]["trades"][:25] if best else []}
        print(mk, "chosen", best and best["params"], "TRAIN", best and best["train"], "TEST", best and best["test"], "positive", pos, "/", len(ok))
    dip = json.load(open(os.path.join(ROOT, "docs", "data", "claudebot-dip-backtest.json"))).get("chosenOnTrain", {})
    out["dipComparison"] = {"params": dip.get("params"), "test": dip.get("test")}
    json.dump(out, open(OUT, "w"), indent=1)


if __name__ == "__main__":
    main()
