#!/usr/bin/env python3
"""Day-trading research: do classic intraday strategies make money on our ETFs, after costs?

Four long-only strategies (Robinhood fractional shares can't be shorted), each with a small
parameter grid, simulated on 5-minute bars:
  orb   Opening-range breakout: buy when a bar closes above the first N minutes' high.
        Stop at the range low; optional target at R x risk.
  gap   Gap-down buy: if the open is g% below yesterday's close, buy after the first bar.
        Target = yesterday's close (gap fill); stop s% below entry.
  vwap  VWAP dip: after 10:30 ET, buy when price closes k% below VWAP. Target = VWAP; stop k% below entry.
  mom   Midday momentum: at 12:30 ET, if price is m% above the open and above VWAP, buy and hold.
Every trade is flat by 15:40 ET (the 2:44 PM CT run can check the whole day). One trade per
fund per day. Signals use a bar's close; fills are at the NEXT bar's open. If a bar touches both
the stop and the target, the stop counts (conservative). Costs: 0.03% per side.
Train 2023-01..2024-12 (choose), test 2025-01..now (never used to choose).
Baseline: buy at the 9:35 open and sell at 15:40 every day (plain intraday drift).
Writes docs/data/claudebot-daytrade-backtest.json. Data: Alpaca 5-minute bars (IEX feed).
"""
from __future__ import annotations

import itertools
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "docs", "data", "claudebot-daytrade-backtest.json")
ET = ZoneInfo("America/New_York")
SYMS = ["SPY", "QQQ", "DIA", "IWM", "SMH", "XLK", "KRE"]
COST = 0.0003
EXIT_HM = (15, 40)

GRID = {
    "orb": [{"mins": m, "r": r} for m, r in itertools.product((15, 30, 60), (1.0, 2.0, None))],
    "gap": [{"gap": g, "stop": s} for g, s in itertools.product((0.5, 1.0, 1.5), (0.5, 1.0))],
    "vwap": [{"k": k} for k in (0.3, 0.5, 0.8)],
    "mom": [{"m": m} for m in (0.3, 0.6, 1.0)],
}
NAMES = {"orb": "Opening-range breakout", "gap": "Gap-down buy", "vwap": "VWAP dip", "mom": "Midday momentum"}


# ---------------------------------------------------------------- core (shared with daytrade_paper.py)
def hm(b):
    t = b["t"].astimezone(ET)
    return t.hour * 60 + t.minute


def simulate(strategy, p, bars, prev_close):
    """bars: one regular session of 5-min bars [{t (aware dt), o, h, l, c, v}], in order.
    Returns a trade dict or None."""
    bars = [b for b in bars if 9 * 60 + 30 <= hm(b) < 16 * 60]
    if len(bars) < 20:
        return None
    exit_min = EXIT_HM[0] * 60 + EXIT_HM[1]
    pv = vol = 0.0
    vw = []
    for b in bars:
        typ = (b["h"] + b["l"] + b["c"]) / 3; w = max(b["v"], 1.0)
        pv += typ * w; vol += w; vw.append(pv / vol)
    entry_i = stop = target = None
    why = ""
    o0 = bars[0]["o"]
    if strategy == "orb":
        n = p["mins"] // 5
        hi = max(b["h"] for b in bars[:n]); lo = min(b["l"] for b in bars[:n])
        for i in range(n, len(bars) - 1):
            if hm(bars[i + 1]) >= exit_min - 30:
                break
            if bars[i]["c"] > hi:
                entry_i, stop = i + 1, lo; why = f"broke the {p['mins']}-min high"; break
    elif strategy == "gap":
        if prev_close and o0 <= prev_close * (1 - p["gap"] / 100):
            entry_i = 1; target = prev_close; why = f"gapped down {100 * (o0 / prev_close - 1):.1f}%"
    elif strategy == "vwap":
        for i in range(12, len(bars) - 1):          # 12 bars = 10:30 ET
            if hm(bars[i + 1]) >= exit_min - 30:
                break
            if bars[i]["c"] < vw[i] * (1 - p["k"] / 100):
                entry_i = i + 1; why = f"{p['k']}% below VWAP"; break
    elif strategy == "mom":
        i = next((j for j, b in enumerate(bars) if hm(b) >= 12 * 60 + 25), None)   # bar closing 12:30
        if i is not None and i + 1 < len(bars) and bars[i]["c"] > o0 * (1 + p["m"] / 100) and bars[i]["c"] > vw[i]:
            entry_i = i + 1; why = f"up {100 * (bars[i]['c'] / o0 - 1):.1f}% at midday, above VWAP"
    elif strategy == "base":
        entry_i = 1; why = "baseline"
    if entry_i is None or entry_i >= len(bars) or hm(bars[entry_i]) >= exit_min:
        return None
    px = bars[entry_i]["o"]
    if strategy == "orb":
        if stop >= px:
            return None
        if p["r"]:
            target = px + p["r"] * (px - stop)
    elif strategy == "gap":
        stop = px * (1 - p["stop"] / 100)
        if target <= px:
            return None
    elif strategy == "vwap":
        stop = px * (1 - p["k"] / 100)
    elif strategy == "mom":
        stop = px * (1 - 0.5 / 100)
    out_px, reason = None, "time"
    for j in range(entry_i, len(bars)):
        b = bars[j]
        if hm(b) >= exit_min:
            out_px = b["o"]; break
        if stop is not None and b["l"] <= stop:
            out_px, reason = min(stop, b["o"]), "stop"; break
        tgt = vw[j - 1] if strategy == "vwap" and j > entry_i else target
        if tgt is not None and j > entry_i and b["h"] >= tgt:
            out_px, reason = max(tgt, b["o"]), "target"; break
    if out_px is None:
        out_px = bars[-1]["c"]
    ret = out_px / px * (1 - COST) / (1 + COST) - 1
    return {"entryT": bars[entry_i]["t"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"), "entry": round(px, 4),
            "exit": round(out_px, 4), "ret": ret, "reason": reason, "why": why}


def summ(t):
    if not t:
        return {"trades": 0}
    w = [x["ret"] for x in t if x["ret"] > 0]; l = [x["ret"] for x in t if x["ret"] <= 0]
    eq = 1.0
    for x in t:
        eq *= 1 + x["ret"]
    return {"trades": len(t), "winRatePct": round(100 * len(w) / len(t), 1), "avgTradePct": round(100 * sum(w + l) / len(t), 4),
            "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, "compoundedPct": round(100 * (eq - 1), 2)}


# ---------------------------------------------------------------- data
def alpaca_5min(sym, start):
    import urllib.request
    key, sec = os.environ["ALPACA_API_KEY"], os.environ["ALPACA_API_SECRET"]
    out, tok = [], None
    while True:
        url = (f"https://data.alpaca.markets/v2/stocks/{sym}/bars?timeframe=5Min&start={start}"
               f"&adjustment=split&feed=iex&limit=10000" + (f"&page_token={tok}" if tok else ""))
        req = urllib.request.Request(url, headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": sec, "User-Agent": "teststock"})
        d = json.loads(urllib.request.urlopen(req, timeout=60).read())
        for b in d.get("bars") or []:
            out.append({"t": datetime.fromisoformat(b["t"].replace("Z", "+00:00")), "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b["v"]})
        tok = d.get("next_page_token")
        if not tok:
            return out


def by_day(bars):
    days = {}
    for b in bars:
        days.setdefault(b["t"].astimezone(ET).date().isoformat(), []).append(b)
    return dict(sorted(days.items()))


def main():
    data = {}
    for s in SYMS:
        try:
            data[s] = by_day(alpaca_5min(s, "2023-01-01T00:00:00Z")); print(s, len(data[s]), "days", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(s, "failed", e, file=sys.stderr)
    def run_all(strategy, p):
        tr = []
        for s, days in data.items():
            prev = None
            for d, bars in days.items():
                sess = [b for b in bars if 9 * 60 + 30 <= hm(b) < 16 * 60]
                t = simulate(strategy, p, bars, prev)
                if t:
                    tr.append({**t, "symbol": s, "day": d})
                if sess:
                    prev = sess[-1]["c"]
        return tr
    split = lambda tr: ([x for x in tr if x["day"] < "2025-01-01"], [x for x in tr if x["day"] >= "2025-01-01"])
    base = run_all("base", {}); btr, bte = split(base)
    rows = []
    for st, plist in GRID.items():
        for p in plist:
            tr = run_all(st, p); a, b = split(tr)
            rows.append({"strategy": st, "name": NAMES[st], "params": p, "train": summ(a), "test": summ(b),
                         "bySymbolTest": {s: summ([x for x in b if x["symbol"] == s]) for s in data}})
    ok = [r for r in rows if r["train"].get("trades", 0) >= 100]
    best = max(ok, key=lambda r: r["train"]["avgTradePct"]) if ok else None
    pos_test = sum(1 for r in ok if (r["test"].get("avgTradePct") or -1) > 0)
    # Verdict: a strategy earns a paper desk if the train pick also beats costs on unseen test data.
    edge = bool(best and best["train"]["avgTradePct"] > 0.05 and (best["test"].get("avgTradePct") or -1) > 0.05
                and (best["test"].get("profitFactor") or 0) >= 1.2 and best["test"].get("trades", 0) >= 50)
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "symbols": list(data), "bar": "5Min (Alpaca IEX)",
           "costPerSidePct": COST * 100, "exitBy": "15:40 ET", "trainYears": "2023-2024", "testYears": "2025-now",
           "baseline": {"train": summ(btr), "test": summ(bte)},
           "chosenOnTrain": best, "combosWithPositiveTest": f"{pos_test}/{len(ok)}",
           "verdict": ("edge" if edge else "no-edge"),
           "verdictText": (f"{best['name']} {best['params']} beat costs on both periods." if edge else
                           "No day-trade rule beat costs reliably on unseen 2025-26 data. Paper-testing only."),
           "all": sorted(rows, key=lambda r: -(r["train"].get("avgTradePct") or -9))}
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1); f.write("\n")
    print("BASELINE", out["baseline"])
    print("CHOSEN", best and (best["name"], best["params"], best["train"], best["test"]))
    print("POSITIVE TEST", out["combosWithPositiveTest"], "VERDICT", out["verdict"])
    for r in out["all"]:
        print(r["strategy"], r["params"], "TRAIN", r["train"].get("trades"), r["train"].get("avgTradePct"), "| TEST", r["test"].get("trades"), r["test"].get("winRatePct"), r["test"].get("avgTradePct"), r["test"].get("profitFactor"))


if __name__ == "__main__":
    main()
