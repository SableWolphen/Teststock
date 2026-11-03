#!/usr/bin/env python3
"""Options quick-profit PAPER race (board request 2026-11-02: "pick the best options and sell as soon as
it makes money"; upgraded 2026-11-03: "build everything"). Runs every 5 minutes in GitHub Actions during
market hours. Free, no Claude usage, NEVER places a real order.

Variant groups racing on the same live prices:
  momentum  bet the 30-min move continues (call if rising, put if falling); fixed targets x stops
  fade      bet the move snaps back (OpenAI #107 dip-reversal idea)
  timed     +5% target or a 30/60-minute time stop (OpenAI #107)
  ens       ENSEMBLE + FORECAST: five specialists vote on every stock each run (momentum, breakout of
            the last hour's range, reversal after an unusually large move, volatility "is it moving
            enough", liquidity via the option spread). The selector trades only when at least two
            directional specialists agree, volatility says yes, AND the option forecast is positive;
            otherwise NO TRADE. Forecast = delta x expected stock move + theta over 30 min - the
            bid/ask cost - fees, where the expected move is LEARNED from this desk's own records (each
            run logs every 30-min move, and 30 minutes later what really happened).
            Two exits: a trailing sell (locks in once up 4%, sells on a 3-point give-back, runs to
            +15%, stop -20%, 60 min max) and a fixed +5%.
  baseline  "No trade" ($0) is always on the board: a variant must beat it.

Fills are conservative: buy at the ASK, sell at the BID, $0.05 per contract each way, never overnight
(sold by 2:45 PM CT). Affordable contracts only (<= $50; at ~$117 that means cheaper stocks or up to 10%
out of the money). Execution intelligence: per-stock spread and "nothing affordable" stats are kept,
and stocks whose options keep costing > 5% to cross are skipped. Tournament: a variant with 30+ trades,
profit factor < 0.8 and a net loss is RETIRED (no new entries).

Prices: Alpaca option snapshots (free "indicative" feed: close to, but not exactly, real quotes) and
IEX 5-minute stock bars. Writes docs/data/claudebot-optscalp-paper.json (Paper scorecard format).

Going live is NOT automatic. Gates (OpenAI advisor #107): a variant becomes a board proposal only after
50+ paper trades over 30+ sessions with net profit, profit factor > 1.2, a 95% bootstrap lower bound on
the average trade above $0, and still profitable when the bid/ask cost is doubled. Real money also needs
the board's explicit approval and the risk governor (claudebot/governor.py).
"""
from __future__ import annotations

import json
import math
import sys
import os
import random
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-optscalp-paper.json")
CT = ZoneInfo("America/Chicago")
UNDER = ["SPY", "QQQ", "IWM", "NVDA", "TSLA", "AAPL", "AMD", "META", "AMZN", "PLTR", "SOFI", "F", "INTC", "HOOD", "BAC", "NIO", "RIVN", "AAL", "SNAP"]
FEE, BUDGET, MAX_SPREAD, MIN_MOVE = 0.05, 50.0, 0.06, 0.25
VARIANTS = [{"id": f"tp{t}_sl{s}", "mode": "mom", "tp": t, "sl": s, "name": f"Sell at +{t}% (stop -{s}%)"} for t in (3, 5, 8, 10) for s in (15, 30)]
VARIANTS += [{"id": f"fade_tp{t}_sl30", "mode": "fade", "tp": t, "sl": 30, "name": f"Fade the move: bet on a snap-back, sell at +{t}% (stop -30%)"} for t in (5, 10)]
VARIANTS += [{"id": f"tp5_sl30_t{m}", "mode": "mom", "tp": 5, "sl": 30, "maxMin": m, "name": f"Sell at +5% or after {m} min (stop -30%)"} for m in (30, 60)]
VARIANTS += [{"id": "ens_trail", "mode": "ens", "tp": 15, "sl": 20, "maxMin": 60, "trail": (4, 3), "name": "Ensemble + forecast, trailing sell (locks in after +4%)"},
             {"id": "ens_tp5", "mode": "ens", "tp": 5, "sl": 30, "maxMin": 60, "name": "Ensemble + forecast, sell at +5% (stop -30%, 60 min)"},
             {"id": "ens_gated", "mode": "ens", "tp": 15, "sl": 20, "maxMin": 60, "trail": (4, 3), "gated": True,
              "name": "Gatekeeper-approved only (net profit, beats ETF/cash, survivable), trailing sell"}]
PAPER_ACCOUNT = 117.0
# CEO decision 2026-11-03 (board: "no negative"): every version that buys WITHOUT a positive after-cost
# forecast is retired now. Evidence: 0/96 such versions won on real historical option prices, and on
# 2026-11-03 live prices they averaged -12% per trade (8% bid/ask cost, and 30-min moves reversed 14%).
# Only the ensemble versions (forecast must be positive) and the Gatekeeper-approved version keep trading.
CEO_RETIRED = {v["id"] for v in VARIANTS if v["mode"] != "ens"}
HOLIDAYS = {"2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"}
H = None
DEBUG = []
OCC = re.compile(r"^([A-Z]+)(\d{6})([CP])(\d{8})$")


def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30).read())


def load():
    try:
        with open(OUT) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def group_of(v):
    return "timed" if v.get("maxMin") and v["mode"] == "mom" else v["mode"]


# ---------- specialists ----------
def features(bars):
    """Inputs for the specialists from recent 5-minute bars (newest last)."""
    c = [b["c"] for b in bars]; h = [b["h"] for b in bars]; lo = [b["l"] for b in bars]
    move = 100 * (c[-1] / c[-7] - 1)
    rets = [math.log(c[i] / c[i - 1]) for i in range(1, len(c))]
    m = sum(rets) / len(rets)
    vol5 = 100 * math.sqrt(sum((x - m) ** 2 for x in rets) / max(1, len(rets) - 1))
    norm30 = vol5 * math.sqrt(6) or 1e-9
    prev_hi, prev_lo = max(h[-13:-1]), min(lo[-13:-1])
    return {"move": move, "px": c[-1], "vol5Pct": round(vol5, 3), "z": round(move / norm30, 2),
            "breakout": 1 if c[-1] > prev_hi else (-1 if c[-1] < prev_lo else 0)}


def votes(f):
    mom = (1 if f["move"] > 0 else -1) if abs(f["move"]) >= MIN_MOVE else 0
    rev = (-1 if f["move"] > 0 else 1) if abs(f["z"]) >= 2 else 0
    return {"momentum": mom, "breakout": f["breakout"], "reversal": rev, "volatilityOk": f["vol5Pct"] >= 0.08}


def ensemble_dir(f):
    v = votes(f); total = v["momentum"] + v["breakout"] + v["reversal"]
    return (1 if total > 0 else -1) if abs(total) >= 2 and v["volatilityOk"] else 0


# ---------- option forecast ----------
def ncdf(x):
    return 0.5 * (1 + math.erf(x / 2 ** 0.5))


def bs(S, K, iv, days, typ):
    """Black-Scholes delta and theta per 30 trading minutes (no rates)."""
    iv = max(iv, 0.05); T = max(days, 0.5) / 365; sd = iv * math.sqrt(T)
    d1 = (math.log(S / K) + 0.5 * sd * sd) / sd
    delta = ncdf(d1) if typ == "call" else ncdf(d1) - 1
    theta_year = -S * math.exp(-d1 * d1 / 2) / math.sqrt(2 * math.pi) * iv / (2 * math.sqrt(T))
    return delta, theta_year / (365 * 13)


def moves(now):
    start = (now - timedelta(minutes=90)).isoformat().replace("+00:00", "Z"); end = now.isoformat().replace("+00:00", "Z")
    d = get(f"https://data.alpaca.markets/v2/stocks/bars?symbols={','.join(UNDER)}&timeframe=5Min&start={start}&end={end}&feed=iex&limit=10000")
    return {s: features(b) for s, b in (d.get("bars") or {}).items() if len(b) >= 14}


def pick(now, mv, mode="mom", carry=0.2, ex=None):
    ex = ex if ex is not None else {}
    bad = {k for k, e in ex.items() if e.get("quotes", 0) >= 10 and e.get("avgSpreadPct", 0) > 5}
    if mode == "ens":
        cands = [(k, m) for k, m in mv.items() if ensemble_dir(m) and k not in bad]
    else:
        cands = [(k, m) for k, m in mv.items() if abs(m["move"]) >= MIN_MOVE and k not in bad]
    cands.sort(key=lambda km: -abs(km[1]["move"]))
    today = now.astimezone(CT).date()
    for sym, m in cands[:8]:
        up = ensemble_dir(m) > 0 if mode == "ens" else ((m["move"] > 0) != (mode == "fade"))
        typ = "call" if up else "put"
        rng = (f"&strike_price_gte={m['px']:.2f}&strike_price_lte={m['px'] * 1.10:.2f}" if typ == "call"
               else f"&strike_price_gte={m['px'] * 0.90:.2f}&strike_price_lte={m['px']:.2f}")
        url = (f"https://data.alpaca.markets/v1beta1/options/snapshots/{sym}?feed=indicative&type={typ}&limit=1000"
               f"&expiration_date_gte={today + timedelta(days=5)}&expiration_date_lte={today + timedelta(days=21)}" + rng)
        snaps = get(url).get("snapshots") or {}
        e = ex.setdefault(sym, {"quotes": 0, "avgSpreadPct": 0.0, "scans": 0, "noAffordable": 0})
        best = None; why = {"found": len(snaps), "noQuote": 0, "tooExpensive": 0, "wideSpread": 0, "negativeForecast": 0}
        for occ, sn in snaps.items():
            q = sn.get("latestQuote") or {}; a, b = float(q.get("ap") or 0), float(q.get("bp") or 0)
            mo = OCC.match(occ)
            if not mo or a <= 0 or b <= 0:
                why["noQuote"] += 1; continue
            mid = (a + b) / 2; spr = (a - b) / mid
            e["avgSpreadPct"] = round((e["avgSpreadPct"] * e["quotes"] + 100 * spr) / (e["quotes"] + 1), 2); e["quotes"] += 1
            if a * 100 + FEE > BUDGET:
                why["tooExpensive"] += 1; continue
            if spr > MAX_SPREAD:
                why["wideSpread"] += 1; continue
            strike = int(mo.group(4)) / 1000; dist = abs(strike - m["px"]) / m["px"]
            days = (datetime.strptime(mo.group(2), "%y%m%d").date() - today).days
            iv = float(sn.get("impliedVolatility") or 0) or m["vol5Pct"] / 100 * math.sqrt(78 * 252) * 1.2
            delta, theta30 = bs(m["px"], strike, iv, days, typ)
            dS = m["px"] * carry * m["move"] / 100                  # learned expected stock move over 30 min
            ev = delta * dS + theta30 - (a - b) - 2 * FEE / 100     # $/share after crossing the spread and fees
            info = {"symbol": occ, "underlying": sym, "type": typ, "ask": a, "bid": b, "spreadPct": round(100 * spr, 1),
                    "move30mPct": round(m["move"], 2), "delta": round(delta, 2), "forecastUsd": round(100 * ev, 2)}
            if mode == "ens":
                if ev <= 0:
                    why["negativeForecast"] += 1; continue
                info["votes"] = votes(m); score = (-ev, spr)
            else:
                score = (dist, spr)
            if best is None or score < best[0]:
                best = (score, info)
        e["scans"] += 1; e["noAffordable"] += 0 if best else 1
        DEBUG.append({mode + ":" + sym: why})
        if best:
            return best[1]
    return None


def learn(st, mv, now):
    """Forecast learning: each 30-min move vs what the stock did over the following 30 minutes."""
    f = st.setdefault("forecast", {"pending": [], "pairs": [], "carry": 0.2})
    keep = []
    for p in f["pending"]:
        age = (now - datetime.fromisoformat(p["t"].replace("Z", "+00:00"))).total_seconds() / 60
        if age >= 30 and p["sym"] in mv:
            f["pairs"].append([p["move"], round(100 * (mv[p["sym"]]["px"] / p["px"] - 1), 3)])
        elif age < 90:
            keep.append(p)
    f["pairs"] = f["pairs"][-2000:]
    nowz = now.isoformat().replace("+00:00", "Z")
    f["pending"] = keep + [{"t": nowz, "sym": k, "px": m["px"], "move": round(m["move"], 3)} for k, m in mv.items() if abs(m["move"]) >= MIN_MOVE]
    if len(f["pairs"]) >= 30:
        num = sum(a * b for a, b in f["pairs"]); den = sum(a * a for a, _ in f["pairs"]) or 1e-9
        f["carry"] = round(max(-0.5, min(0.5, num / den)), 3)     # share of a move that carries on (negative = snaps back)
    f["samples"] = len(f["pairs"])
    return f["carry"]


def quotes(symbols):
    if not symbols:
        return {}
    d = get(f"https://data.alpaca.markets/v1beta1/options/snapshots?symbols={','.join(sorted(symbols))}&feed=indicative")
    return {s: float((v.get("latestQuote") or {}).get("bp") or 0) for s, v in (d.get("snapshots") or {}).items()}


def boot_low(x, n=2000):
    """95% lower bound of the average trade P&L (bootstrap, fixed seed so it is reproducible)."""
    r = random.Random(7); means = sorted(sum(r.choice(x) for _ in x) / len(x) for _ in range(n))
    return round(means[int(0.025 * n)], 2)


def board(st):
    rows = []
    for v in VARIANTS:
        s = st["strategies"][v["id"]]; t = s["trades"]; n = len(t)
        w = [x["pnlUsd"] for x in t if x["pnlUsd"] > 0]; l = [x["pnlUsd"] for x in t if x["pnlUsd"] <= 0]
        days = len({x["day"] for x in t})
        pf = round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None
        lo = boot_low([x["pnlUsd"] for x in t]) if n >= 10 else None
        stress = round(sum(x.get("stressPnlUsd", x["pnlUsd"]) for x in t), 2)
        ready = n >= 50 and days >= 30 and sum(w + l) > 0 and (pf or 0) > 1.2 and (lo or 0) > 0 and stress > 0
        avg_ret = sum(x.get("retPct", 0) for x in t) / n if n else 0
        if v["id"] in CEO_RETIRED:
            s["retired"] = True
        if (n >= 30 and (pf or 0) < 0.8 and sum(w + l) < 0) or (n >= 10 and sum(w + l) < 0 and avg_ret <= -5 and (pf or 0) < 0.5):
            s["retired"] = True       # costs-dominated losers retire early (2026-11-03: -12%/trade on live prices)
        rows.append({"id": v["id"], "name": v["name"], "group": group_of(v), "trades": n, "wins": len(w),
                     "winRatePct": round(100 * len(w) / n, 1) if n else None, "pnlUsd": round(sum(w + l), 2), "profitFactor": pf,
                     "worstUsd": min(l) if l else None, "days": days, "open": 1 if s.get("open") else 0, "avgLow95Usd": lo,
                     "pnlDoubleCostUsd": stress, "boardProposal": ready, "retired": bool(s.get("retired"))})
    rows.append({"id": "notrade", "name": "No trade (baseline to beat)", "group": "baseline", "trades": 0, "wins": 0, "winRatePct": None,
                 "pnlUsd": 0.0, "profitFactor": None, "worstUsd": None, "days": 0, "open": 0, "avgLow95Usd": None,
                 "pnlDoubleCostUsd": 0.0, "boardProposal": False, "retired": False})
    return sorted(rows, key=lambda r: -r["pnlUsd"])


def main():
    global H
    H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    now = datetime.now(timezone.utc); local = now.astimezone(CT); day = local.date().isoformat()
    mins = local.hour * 60 + local.minute
    if os.environ.get("OPTSCALP_TEST"):                  # test: show what each group would pick then, write nothing
        last = now - timedelta(hours=int(os.environ["OPTSCALP_TEST"]))
        mv = moves(last); print("moves", {k: round(v["move"], 2) for k, v in mv.items()})
        print("votes", {k: votes(f) for k, f in mv.items() if ensemble_dir(f)})
        for mode in ("mom", "fade", "ens"):
            print("pick", mode, pick(now, mv, mode=mode))
        print("why", DEBUG); return
    if local.weekday() >= 5 or day in HOLIDAYS or not (8 * 60 + 35 <= mins <= 15 * 60):
        print("market closed"); return
    st = load() or {}
    st.setdefault("schemaVersion", 1); st["mode"] = "paper"
    st["note"] = ("Paper only: options bought at the ask, sold at the bid. Momentum, fade, timed and ensemble+forecast "
                  "variants race against a no-trade baseline; losers retire. Never trades real money.")
    st.setdefault("strategies", {}); st.setdefault("runs", [])
    for v in VARIANTS:
        st["strategies"].setdefault(v["id"], {"name": v["name"], "trades": [], "open": None})
        st["strategies"][v["id"]]["name"] = v["name"]
    nowz = now.isoformat().replace("+00:00", "Z")
    opens = {s["open"]["symbol"] for s in st["strategies"].values() if s.get("open")}
    bids = quotes(opens)
    events = []
    for v in VARIANTS:                                       # exits first
        s = st["strategies"][v["id"]]; p = s.get("open")
        if not p:
            continue
        bid = bids.get(p["symbol"], 0.0)
        if bid > 0:
            p["peakBid"] = max(p.get("peakBid", 0), bid)
        why = None; tr = v.get("trail")
        if tr and bid > 0 and p.get("peakBid", 0) >= p["ask"] * (1 + tr[0] / 100) and bid <= p["peakBid"] - p["ask"] * tr[1] / 100:
            why = "trailing profit lock"
        elif bid > 0 and bid >= p["ask"] * (1 + v["tp"] / 100):
            why = "profit target"
        elif bid > 0 and bid <= p["ask"] * (1 - v["sl"] / 100):
            why = "stop"
        elif mins >= 14 * 60 + 45 or p["day"] != day:
            why = "end of day"
        elif v.get("maxMin") and now - datetime.fromisoformat(p["boughtAt"].replace("Z", "+00:00")) >= timedelta(minutes=v["maxMin"]):
            why = "time limit"
        if why:
            px = bid if bid > 0 else p["ask"] * 0.5          # no quote: assume a bad fill
            pnl = round((px - p["ask"]) * 100 - 2 * FEE, 2)
            s["trades"].append({**p, "stressPnlUsd": round(pnl - (p["ask"] - p["bid"]) * 100, 2), "exitBid": px, "exitAt": nowz,
                                "why": why, "pnlUsd": pnl, "retPct": round(100 * (px / p["ask"] - 1), 1)})
            s["open"] = None; events.append(f"{v['id']} sold {p['symbol']} {why} {pnl:+.2f}")
    if 8 * 60 + 45 <= mins <= 13 * 60 + 30:
        try:
            mv = moves(now)
        except Exception as e:  # noqa: BLE001
            mv = {}; events.append(f"scan error {e}")
        carry = learn(st, mv, now) if mv else st.get("forecast", {}).get("carry", 0.2)
        ex = st.setdefault("execution", {})
        for mode in ("mom", "fade", "ens"):
            group = [v for v in VARIANTS if v["mode"] == mode and not st["strategies"][v["id"]].get("open") and not st["strategies"][v["id"]].get("retired")]
            if not group or not mv:
                continue
            try:
                choice = pick(now, mv, mode=mode, carry=carry, ex=ex)
            except Exception as e:  # noqa: BLE001
                choice = None; events.append(f"{mode} scan error {e}")
            if not choice:
                if mode == "ens":
                    events.append("ensemble: NO TRADE (specialists disagree or the forecast is not positive)")
                continue
            import gatekeeper
            gk = gatekeeper.evaluate(choice, PAPER_ACCOUNT, hold_minutes=30)
            choice["gatekeeper"] = {"pass": gk["pass"], "failed": gk["failed"], "pctPerHour": gk["pctPerHour"]}
            st.setdefault("gatekeeperLog", {"checked": 0, "passed": 0, "failedBy": {}})
            gl = st["gatekeeperLog"]; gl["checked"] += 1; gl["passed"] += 1 if gk["pass"] else 0
            for k in gk["failed"]:
                gl["failedBy"][k] = gl["failedBy"].get(k, 0) + 1
            for v in group:
                if v.get("gated") and not gk["pass"]:
                    continue
                s = st["strategies"][v["id"]]
                if sum(1 for t in s["trades"] if t["day"] == day) < 6:
                    s["open"] = {**choice, "day": day, "boughtAt": nowz}
            events.append(f"{mode}: bought {choice['symbol']} at {choice['ask']} (move {choice['move30mPct']}%, forecast {choice['forecastUsd']:+.2f} USD)")
    st["runs"] = (st["runs"] + [{"t": nowz, "events": events}])[-200:]
    st["leaderboard"] = board(st); st["updatedAt"] = nowz
    st["proposals"] = [r["name"] for r in st["leaderboard"] if r["boardProposal"]]
    with open(OUT, "w") as f:
        json.dump(st, f, indent=1); f.write("\n")
    print(json.dumps({"events": events, "top": st["leaderboard"][:2]}))


if __name__ == "__main__":
    main()
