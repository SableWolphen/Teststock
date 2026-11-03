#!/usr/bin/env python3
"""Moonshot desk (board, 2026-11-03: "I want to be like the GameStop guy"). PAPER ONLY. Free, runs in
GitHub Actions after each close. Never places a real order.

The Roaring Kitty pattern, as rules: find a company the market has given up on (down 50%+ from its
1-year high) that is starting to turn (back above a RISING 50-day average) while interest returns
(20-day volume well above its 100-day volume). Then make a small, long-dated bet: a cheap call
90-200 days out, 10-40% above today's price, costing <= $15. Hold for months. No stop: the most it
can lose is what it cost.
  Exits: sold at +200% ("moonshot hit"), 30 days before expiry (time), or if the stock breaks below
  its 1-year low (thesis broken). Max 5 paper bets open, one per stock.
Prices: Alpaca daily bars (IEX) and option snapshots (indicative feed). Fills: buy at the ask, sell at
the bid. Writes docs/data/claudebot-moonshot-paper.json.

Most of these bets are expected to expire worthless; the question is whether the few winners pay
for all of them. Real money would need months of paper evidence AND the board's approval, would be
capped at $15 per bet, and would pass the risk governor.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "docs", "data", "claudebot-moonshot-paper.json")
SCAN = os.path.join(ROOT, "docs", "data", "claudebot-optbuy-scan.json")
ETFS = {"SPY", "QQQ", "IWM", "DIA", "XLE", "XLV", "XLI", "XLU", "XLB", "XLP", "XLY", "XBI", "EEM", "FXI", "KWEB", "SLV", "TLT", "HYG",
        "ARKK", "GDX", "EWZ", "XLK", "XLF", "SMH", "KRE", "GLD", "USO"}
EXTRA = ["GME", "AMC", "BB", "NOK", "BBBY", "CHPT", "OPEN", "SIRI", "PTON", "BYND", "WOLF", "RUN", "NVAX", "SPCE", "CVNA", "MPW", "WBA", "PARA", "LUMN", "TLRY"]
BUDGET, FEE, MAX_OPEN, TARGET = 15.0, 0.05, 5, 3.0
OCC = re.compile(r"^([A-Z]+)(\d{6})([CP])(\d{8})$")
H = None


def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=40).read())


def load(p, d=None):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return d


def universe():
    # operating companies only: the daily most-actives list is full of leveraged/inverse funds (NVD, TSLG...)
    # that always look "down 50%" because they decay, so it is not used.
    syms = set((load(SCAN, {}) or {}).get("symbols") or {}) | set(EXTRA)
    return sorted(s for s in syms if s not in ETFS and s.isalpha() and len(s) <= 5)


def daily(syms):
    start = (datetime.now(timezone.utc) - timedelta(days=400)).date().isoformat(); out = {}
    for i in range(0, len(syms), 50):
        tok = None
        while True:
            d = get(f"https://data.alpaca.markets/v2/stocks/bars?symbols={','.join(syms[i:i + 50])}&timeframe=1Day&start={start}&adjustment=split&feed=iex&limit=10000"
                    + (f"&page_token={tok}" if tok else ""))
            for s, b in (d.get("bars") or {}).items():
                out.setdefault(s, []).extend(b)
            tok = d.get("next_page_token")
            if not tok:
                break
    return out


def screen(sym, bars):
    if len(bars) < 160:
        return None
    c = [b["c"] for b in bars]; v = [b["v"] for b in bars]
    px = c[-1]; hi = max(c[-252:]); lo = min(c[-252:])
    sma50 = sum(c[-50:]) / 50; sma50_prev = sum(c[-60:-10]) / 50
    vr = (sum(v[-20:]) / 20) / max(1.0, sum(v[-100:]) / 100)
    dd = 1 - px / hi; m1 = 100 * (px / c[-22] - 1)
    info = {"symbol": sym, "price": round(px, 2), "offHighPct": round(100 * dd, 1), "volumeRatio": round(vr, 2), "month1Pct": round(m1, 1),
            "low52": round(lo, 2), "above50d": px > sma50, "rising50d": sma50 > sma50_prev}
    if px < 2 or dd < 0.5 or px <= sma50 or sma50 <= sma50_prev or vr < 1.2:
        return None
    info["score"] = round(100 * dd + 20 * (vr - 1) + max(-20, min(40, m1)), 1)
    info["why"] = (f"down {info['offHighPct']}% from its 1-year high, back above a rising 50-day average, "
                   f"volume {info['volumeRatio']}x normal, {info['month1Pct']:+}% this month")
    return info


def find_call(sym, px, today):
    url = (f"https://data.alpaca.markets/v1beta1/options/snapshots/{sym}?feed=indicative&type=call&limit=1000"
           f"&expiration_date_gte={today + timedelta(days=90)}&expiration_date_lte={today + timedelta(days=200)}"
           f"&strike_price_gte={px * 1.10:.2f}&strike_price_lte={px * 1.40:.2f}")
    best = None
    for occ, sn in (get(url).get("snapshots") or {}).items():
        q = sn.get("latestQuote") or {}; a, b = float(q.get("ap") or 0), float(q.get("bp") or 0)
        mo = OCC.match(occ)
        if not mo or a <= 0 or b <= 0 or a * 100 + FEE > BUDGET or (a - b) / ((a + b) / 2) > 0.30:
            continue
        strike = int(mo.group(4)) / 1000; exp = datetime.strptime(mo.group(2), "%y%m%d").date()
        key = (strike, -(exp - today).days)             # closest strike first, then the longest time
        if best is None or key < best[0]:
            best = (key, {"symbol": occ, "underlying": sym, "strike": strike, "expiration": exp.isoformat(), "ask": a, "bid": b})
    return best[1] if best else None


def main():
    global H
    H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    now = datetime.now(timezone.utc); today = now.date(); nowz = now.isoformat().replace("+00:00", "Z")
    st = load(OUT, {}) or {}
    st.update({"schemaVersion": 1, "mode": "paper", "note": "Paper only. Cheap long-dated calls on beaten-down stocks that are turning. Most expire worthless; the test is whether the winners pay for all of them."})
    s = st.setdefault("strategies", {}).setdefault("moonshot", {"name": "Moonshot: long-dated calls on beaten-down turnarounds", "trades": [], "open": []})
    events = []
    syms = universe(); bars = daily(syms)
    cands = sorted(filter(None, (screen(k, b) for k, b in bars.items())), key=lambda r: -r["score"])
    st["candidates"] = cands[:15]; st["scanned"] = len(bars)
    # exits first
    if s["open"]:
        q = get(f"https://data.alpaca.markets/v1beta1/options/snapshots?symbols={','.join(p['symbol'] for p in s['open'])}&feed=indicative").get("snapshots") or {}
        keep = []
        for p in s["open"]:
            bid = float(((q.get(p["symbol"]) or {}).get("latestQuote") or {}).get("bp") or 0)
            p["lastBid"] = bid; p["peakBid"] = max(p.get("peakBid", 0), bid)
            ub = bars.get(p["underlying"]) or []
            broke = bool(ub) and ub[-1]["c"] < p.get("low52AtEntry", 0)
            days_left = (datetime.fromisoformat(p["expiration"]).date() - today).days
            why = "moonshot hit (+200%)" if bid >= p["ask"] * TARGET else "30 days to expiry" if days_left <= 30 else "thesis broken (new 1-year low)" if broke else None
            if why:
                pnl = round((bid - p["ask"]) * 100 - 2 * FEE, 2)
                s["trades"].append({**p, "exitBid": bid, "exitAt": nowz, "why": why, "pnlUsd": pnl, "retPct": round(100 * (bid / p["ask"] - 1), 1), "day": today.isoformat()})
                events.append(f"sold {p['symbol']} ({why}) {pnl:+.2f}")
            else:
                keep.append(p)
        s["open"] = keep
    held = {p["underlying"] for p in s["open"]}
    for c in cands:
        if len(s["open"]) >= MAX_OPEN:
            break
        if c["symbol"] in held:
            continue
        try:
            opt = find_call(c["symbol"], c["price"], today)
        except Exception as e:  # noqa: BLE001
            events.append(f"{c['symbol']}: option lookup failed ({e})"); continue
        if not opt:
            continue
        s["open"].append({**opt, "boughtAt": nowz, "day": today.isoformat(), "low52AtEntry": c["low52"], "why": c["why"], "score": c["score"]})
        held.add(c["symbol"]); events.append(f"bought {opt['symbol']} at {opt['ask']} ({c['why']})")
    t = s["trades"]; w = [x["pnlUsd"] for x in t if x["pnlUsd"] > 0]; l = [x["pnlUsd"] for x in t if x["pnlUsd"] <= 0]
    open_val = round(sum((p.get("lastBid", p["bid"]) - p["ask"]) * 100 for p in s["open"]), 2)
    st["leaderboard"] = [{"id": "moonshot", "name": s["name"], "trades": len(t), "wins": len(w), "winRatePct": round(100 * len(w) / len(t), 1) if t else None,
                          "pnlUsd": round(sum(w + l), 2), "openPaperPnlUsd": open_val, "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None,
                          "open": len(s["open"]), "biggestWinUsd": max(w) if w else None}]
    st["runs"] = (st.get("runs", []) + [{"t": nowz, "events": events or ["no change"]}])[-120:]
    st["updatedAt"] = nowz
    with open(OUT, "w") as f:
        json.dump(st, f, indent=1); f.write("\n")
    print(json.dumps({"scanned": len(bars), "candidates": [c["symbol"] for c in cands[:10]], "events": events}))


if __name__ == "__main__":
    main()
