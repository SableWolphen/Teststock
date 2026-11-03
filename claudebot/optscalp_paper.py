#!/usr/bin/env python3
"""Options quick-profit PAPER desk (board request 2026-11-02: "pick the best options and sell as soon as
it makes money"). Runs every 5 minutes in GitHub Actions during market hours. Free, no Claude usage,
NEVER places a real order.

Every run:
  1. Picks the "best" option right now: among liquid underlyings, the one moving most in the last 30
     minutes (|move| >= 0.25%); a CALL if it is rising, a PUT if it is falling; expiry 5-21 days out,
     closest to at-the-money, bid/ask gap <= 6% of the mid, costs <= $50 for one contract.
  2. Each variant (profit target x stop) that is flat "buys" it at the ASK. Positions are marked at
     the BID (what a real sale gets). Exit at the first bid >= target, at the stop, or at 2:45 PM CT
     (never held overnight). Fees $0.05 per contract each way.
Prices: Alpaca option snapshots (free "indicative" feed: close to, but not exactly, real quotes) and
IEX 5-minute stock bars. Writes docs/data/claudebot-optscalp-paper.json (Paper scorecard format).

Going live is NOT automatic: a variant becomes a board proposal only after 40+ paper trades over
15+ trading days with net profit, profit factor >= 1.3 and wins that beat costs. Real money still
needs the board's explicit approval (board rule for options scalping, 2026-11-02).
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-optscalp-paper.json")
CT = ZoneInfo("America/Chicago")
UNDER = ["SPY", "QQQ", "IWM", "NVDA", "TSLA", "AAPL", "AMD", "META", "AMZN"]
FEE, BUDGET, MAX_SPREAD, MIN_MOVE = 0.05, 50.0, 0.06, 0.25
VARIANTS = [{"id": f"tp{t}_sl{s}", "tp": t, "sl": s, "name": f"Sell at +{t}% (stop -{s}%)"} for t in (3, 5, 10) for s in (15, 30)]
HOLIDAYS = {"2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"}
H = None
OCC = re.compile(r"^([A-Z]+)(\d{6})([CP])(\d{8})$")


def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30).read())


def load():
    try:
        with open(OUT) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def moves(now):
    start = (now - timedelta(minutes=60)).isoformat().replace("+00:00", "Z")
    out = {}
    d = get(f"https://data.alpaca.markets/v2/stocks/bars?symbols={','.join(UNDER)}&timeframe=5Min&start={start}&feed=iex&limit=1000")
    for s, bars in (d.get("bars") or {}).items():
        if len(bars) >= 7:
            out[s] = {"move": 100 * (bars[-1]["c"] / bars[-7]["c"] - 1), "px": bars[-1]["c"]}
    return out


def pick(now, mv):
    cands = sorted((m for m in mv.items() if abs(m[1]["move"]) >= MIN_MOVE), key=lambda m: -abs(m[1]["move"]))
    today = now.astimezone(CT).date()
    for sym, m in cands[:3]:
        typ = "call" if m["move"] > 0 else "put"
        url = (f"https://data.alpaca.markets/v1beta1/options/snapshots/{sym}?feed=indicative&type={typ}&limit=1000"
               f"&expiration_date_gte={today + timedelta(days=5)}&expiration_date_lte={today + timedelta(days=21)}"
               f"&strike_price_gte={m['px'] * 0.97:.2f}&strike_price_lte={m['px'] * 1.03:.2f}")
        snaps = get(url).get("snapshots") or {}
        best = None
        for occ, sn in snaps.items():
            q = sn.get("latestQuote") or {}; a, b = float(q.get("ap") or 0), float(q.get("bp") or 0)
            mo = OCC.match(occ)
            if not mo or a <= 0 or b <= 0 or a * 100 + FEE > BUDGET:
                continue
            mid = (a + b) / 2; spr = (a - b) / mid
            if spr > MAX_SPREAD:
                continue
            strike = int(mo.group(4)) / 1000; dist = abs(strike - m["px"]) / m["px"]
            score = (dist, spr)
            if best is None or score < best[0]:
                best = (score, {"symbol": occ, "underlying": sym, "type": typ, "ask": a, "bid": b, "spreadPct": round(100 * spr, 1),
                                "move30mPct": round(m["move"], 2)})
        if best:
            return best[1]
    return None


def quotes(symbols):
    if not symbols:
        return {}
    d = get(f"https://data.alpaca.markets/v1beta1/options/snapshots?symbols={','.join(sorted(symbols))}&feed=indicative")
    return {s: float((v.get("latestQuote") or {}).get("bp") or 0) for s, v in (d.get("snapshots") or {}).items()}


def board(st):
    rows = []
    for v in VARIANTS:
        s = st["strategies"][v["id"]]; t = s["trades"]; n = len(t)
        w = [x["pnlUsd"] for x in t if x["pnlUsd"] > 0]; l = [x["pnlUsd"] for x in t if x["pnlUsd"] <= 0]
        days = len({x["day"] for x in t})
        pf = round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None
        ready = n >= 40 and days >= 15 and sum(w + l) > 0 and (pf or 0) >= 1.3
        rows.append({"id": v["id"], "name": v["name"], "trades": n, "wins": len(w), "winRatePct": round(100 * len(w) / n, 1) if n else None,
                     "pnlUsd": round(sum(w + l), 2), "profitFactor": pf, "worstUsd": min(l) if l else None, "days": days,
                     "open": 1 if s.get("open") else 0, "boardProposal": ready})
    return sorted(rows, key=lambda r: -r["pnlUsd"])


def main():
    global H
    H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    now = datetime.now(timezone.utc); local = now.astimezone(CT); day = local.date().isoformat()
    mins = local.hour * 60 + local.minute
    if os.environ.get("OPTSCALP_TEST"):                  # test: show today's pick from the last session, write nothing
        last = now - timedelta(hours=int(os.environ["OPTSCALP_TEST"]))
        mv = moves(last); print("moves", {k: round(v["move"], 2) for k, v in mv.items()})
        global MIN_MOVE
        MIN_MOVE = 0.0; print("pick", pick(now, mv)); return
    if local.weekday() >= 5 or day in HOLIDAYS or not (8 * 60 + 35 <= mins <= 15 * 60):
        print("market closed"); return
    st = load() or {}
    st.setdefault("schemaVersion", 1); st["mode"] = "paper"
    st["note"] = "Paper only: options bought at the ask, sold at the bid at the first profit target. Never trades real money."
    st.setdefault("strategies", {}); st.setdefault("runs", [])
    for v in VARIANTS:
        st["strategies"].setdefault(v["id"], {"name": v["name"], "trades": [], "open": None})
    nowz = now.isoformat().replace("+00:00", "Z")
    opens = {s["open"]["symbol"] for s in st["strategies"].values() if s.get("open")}
    bids = quotes(opens)
    events = []
    for v in VARIANTS:                                       # exits first
        s = st["strategies"][v["id"]]; p = s.get("open")
        if not p:
            continue
        bid = bids.get(p["symbol"], 0.0)
        why = None
        if bid > 0 and bid >= p["ask"] * (1 + v["tp"] / 100):
            why = "profit target"
        elif bid > 0 and bid <= p["ask"] * (1 - v["sl"] / 100):
            why = "stop"
        elif mins >= 14 * 60 + 45 or p["day"] != day:
            why = "end of day"
        if why:
            px = bid if bid > 0 else p["ask"] * 0.5          # no quote at the close: assume a bad fill
            pnl = round((px - p["ask"]) * 100 - 2 * FEE, 2)
            s["trades"].append({**p, "exitBid": px, "exitAt": nowz, "why": why, "pnlUsd": pnl, "retPct": round(100 * (px / p["ask"] - 1), 1)})
            s["open"] = None; events.append(f"{v['id']} sold {p['symbol']} {why} {pnl:+.2f}")
    if 8 * 60 + 45 <= mins <= 13 * 60 + 30 and any(not st["strategies"][v["id"]].get("open") for v in VARIANTS):
        try:
            choice = pick(now, moves(now))
        except Exception as e:  # noqa: BLE001
            choice = None; events.append(f"scan error {e}")
        if choice:
            for v in VARIANTS:
                s = st["strategies"][v["id"]]
                if not s.get("open") and sum(1 for t in s["trades"] if t["day"] == day) < 6:
                    s["open"] = {**choice, "day": day, "boughtAt": nowz}
            events.append(f"bought {choice['symbol']} at {choice['ask']} (move {choice['move30mPct']}%)")
    st["runs"] = (st["runs"] + [{"t": nowz, "events": events}])[-200:]
    st["leaderboard"] = board(st); st["updatedAt"] = nowz
    st["proposals"] = [r["name"] for r in st["leaderboard"] if r["boardProposal"]]
    with open(OUT, "w") as f:
        json.dump(st, f, indent=1); f.write("\n")
    print(json.dumps({"events": events, "top": st["leaderboard"][:2]}))


if __name__ == "__main__":
    main()
