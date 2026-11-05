#!/usr/bin/env python3
"""Put credit spreads, PAPER, on GitHub (board, 2026-11-05: "do everything on paper right now so we
can see the results on the web page for the options and spreads"). Free, every 5 minutes inside
the market loop, never places an order (Robinhood blocks bot multi-leg orders anyway).

Rules come from claudebot/options_config.json (the same rules the old Claude-run desk used):
  entry  9:00-13:30 CT, not on event-pause dates, fund above its 50-day average; expiry 12-21 days
         out (nearest 16); sell the highest-strike put with |delta| <= 0.22, buy the put $1 lower;
         net credit >= $0.14 using EXECUTABLE prices (short at the bid, long at the ask); each leg's
         bid/ask gap <= $0.06. One spread per fund at a time (5 funds), so evidence builds faster.
  exit   buy back (short at the ask, long at the bid) when 65% of the credit is kept, when the cost
         reaches 2.5x the credit, or 1 day before expiry. $0.20 fees per round trip.
Writes docs/data/claudebot-spread-paper.json.
"""
from __future__ import annotations

import json
import math
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-spread-paper.json")
CT = ZoneInfo("America/Chicago")
OCC = re.compile(r"^([A-Z]+)(\d{6})([CP])(\d{8})$")
H = None


def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30).read())


def ncdf(x):
    return 0.5 * (1 + math.erf(x / 2 ** 0.5))


def put_delta(S, K, iv, days):
    iv = max(iv or 0.2, 0.05); T = max(days, 0.5) / 365; sd = iv * math.sqrt(T)
    return ncdf((math.log(S / K) + 0.5 * sd * sd) / sd) - 1


def snaps(sym, today, e, px):
    url = (f"https://data.alpaca.markets/v1beta1/options/snapshots/{sym}?feed=indicative&type=put&limit=1000"
           f"&expiration_date_gte={today + timedelta(days=e['minDte'])}&expiration_date_lte={today + timedelta(days=e['maxDte'])}"
           f"&strike_price_gte={px * 0.85:.2f}&strike_price_lte={px:.2f}")
    return get(url).get("snapshots") or {}


def main():
    global H
    H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    cfg = json.load(open(os.path.join(HERE, "options_config.json"))); e, x, r = cfg["entry"], cfg["exit"], cfg["risk"]
    fees = float(cfg.get("model", {}).get("feesPerRoundTrip", 0.2))
    now = datetime.now(timezone.utc); loc = now.astimezone(CT); today = loc.date(); day = today.isoformat(); m = loc.hour * 60 + loc.minute
    if loc.weekday() >= 5 or not (8 * 60 + 35 <= m <= 15 * 60):
        print("market closed"); return
    try:
        led = json.load(open(OUT))
    except Exception:  # noqa: BLE001
        led = {"schemaVersion": 1, "mode": "paper", "strategies": {"spreads": {"name": "Put credit spreads ($1 wide, ~0.20 delta, 12-21 days)", "open": {}, "trades": []}},
               "runs": [], "note": "PAPER ONLY. Robinhood blocks bot spreads; this measures the rules on live executable prices."}
    led["strategies"].setdefault("spreads_nopause", {"name": "Put credit spreads, ignoring event pauses (tests whether the pause helps)", "open": {}, "trades": []})
    nowz = now.isoformat().replace("+00:00", "Z"); ev = []
    cache = {}
    for sid, respect in (("spreads", True), ("spreads_nopause", False)):
        run_variant(led["strategies"][sid], sid, respect, cfg, e, x, r, fees, now, loc, today, day, m, nowz, ev, cache)
    led["leaderboard"] = []
    for sid, st in led["strategies"].items():
        t = st["trades"]; w = [y["pnlUsd"] for y in t if y["pnlUsd"] > 0]; l = [y["pnlUsd"] for y in t if y["pnlUsd"] <= 0]
        led["leaderboard"].append({"id": sid, "name": st["name"], "trades": len(t), "wins": len(w), "winRatePct": round(100 * len(w) / len(t), 1) if t else None,
                                   "pnlUsd": round(sum(w + l), 2), "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, "open": len(st["open"]),
                                   "openRiskUsd": round(sum(p["maxLossUsd"] for p in st["open"].values()), 2)})
    led["updatedAt"] = nowz; led["runs"] = (led.get("runs", []) + [{"t": nowz, "events": ev or ["watching"]}])[-200:]
    json.dump(led, open(OUT, "w"), indent=1)
    print(json.dumps(ev or ["watching"]))


def run_variant(st, sid, respect, cfg, e, x, r, fees, now, loc, today, day, m, nowz, ev, cache):
    tag = "" if respect else "[no-pause] "
    # manage open spreads
    if st["open"]:
        syms = sorted({p["short"] for p in st["open"].values()} | {p["long"] for p in st["open"].values()})
        q = get(f"https://data.alpaca.markets/v1beta1/options/snapshots?symbols={','.join(syms)}&feed=indicative").get("snapshots") or {}
        for und, p in list(st["open"].items()):
            sq = (q.get(p["short"]) or {}).get("latestQuote") or {}; lq = (q.get(p["long"]) or {}).get("latestQuote") or {}
            sa, lb = float(sq.get("ap") or 0), float(lq.get("bp") or 0)
            if sa <= 0:
                continue
            cost = round(sa - lb, 2); dte = (datetime.fromisoformat(p["expiration"]).date() - today).days
            p["lastCost"] = cost
            why = ("profit target" if cost <= p["credit"] * (1 - x["takeProfitPctOfCredit"] / 100) else
                   "stop" if cost >= p["credit"] * x["stopAtMultipleOfCredit"] else "expiry close" if dte <= x["closeAtDte"] else None)
            if why:
                pnl = round((p["credit"] - cost) * 100 - fees, 2)
                st["trades"].append({**p, "underlying": und, "closeCost": cost, "out": nowz, "why": why, "pnlUsd": pnl})
                del st["open"][und]; ev.append(f"{tag}CLOSED {p['label']} {why}: kept {p['credit']} paid {cost} -> {pnl:+.2f} USD")
    # entries
    lo, hi = [int(a) * 60 + int(b) for a, b in (t.split(":") for t in e["entryWindowCT"])]
    paused = respect and day in (r.get("noNewEntryDates") or {})
    if lo <= m <= hi and not paused:
        dstart = (now - timedelta(days=120)).date().isoformat()
        if "daily" not in cache:
            cache["daily"] = get(f"https://data.alpaca.markets/v2/stocks/bars?symbols={','.join(cfg['underlyings'])}&timeframe=1Day&start={dstart}&feed=iex&limit=10000&adjustment=split").get("bars") or {}
            cache["lastq"] = get(f"https://data.alpaca.markets/v2/stocks/trades/latest?symbols={','.join(cfg['underlyings'])}&feed=iex").get("trades") or {}
        daily, lastq = cache["daily"], cache["lastq"]
        for und in cfg["underlyings"]:
            if und in st["open"] or any(t["underlying"] == und and t["in"][:10] == day for t in st["trades"]):
                continue
            dc = [b["c"] for b in daily.get(und) or []]; px = float((lastq.get(und) or {}).get("p") or 0)
            if len(dc) < 50 or px <= 0 or (e.get("trendFilter") and px <= sum(dc[-50:]) / 50):
                continue
            if ("chain", und) not in cache:
                cache[("chain", und)] = snaps(und, today, e, px)
            chain = cache[("chain", und)]; by = {}
            for occ, sn in chain.items():
                mo = OCC.match(occ)
                if mo:
                    by.setdefault(mo.group(2), {})[int(mo.group(4)) / 1000] = (occ, sn)
            exps = sorted(by, key=lambda yymmdd: abs((datetime.strptime(yymmdd, "%y%m%d").date() - today).days - e["targetDte"]))
            for ex in exps[:1]:
                strikes = by[ex]; dte = (datetime.strptime(ex, "%y%m%d").date() - today).days
                for K in sorted(strikes, reverse=True):
                    occ, sn = strikes[K]; q = sn.get("latestQuote") or {}
                    d = (sn.get("greeks") or {}).get("delta")
                    d = float(d) if d not in (None, 0) else put_delta(px, K, float(sn.get("impliedVolatility") or 0), dte)
                    if abs(d) > e["maxShortDelta"]:
                        continue
                    lk = round(K - e["widthUsd"], 2)
                    if lk not in strikes:
                        break
                    locc, lsn = strikes[lk]; lq = lsn.get("latestQuote") or {}
                    sb, sa, la, lb = float(q.get("bp") or 0), float(q.get("ap") or 0), float(lq.get("ap") or 0), float(lq.get("bp") or 0)
                    if min(sb, sa, la) <= 0 or sa - sb > e["maxLegSpreadUsd"] or la - lb > e["maxLegSpreadUsd"]:
                        break
                    credit = round(sb - la, 2)
                    if credit < e["minCreditUsd"]:
                        ev.append(f"{tag}{und} {K:g}/{lk:g}: credit {credit} below {e['minCreditUsd']}"); break
                    label = f"{und} {K:g}/{lk:g}P {datetime.strptime(ex, '%y%m%d').date():%b %d}"
                    st["open"][und] = {"short": occ, "long": locc, "credit": credit, "maxLossUsd": round((e["widthUsd"] - credit) * 100 + fees, 2),
                                       "shortDelta": round(d, 2), "expiration": datetime.strptime(ex, "%y%m%d").date().isoformat(), "in": nowz, "label": label, "underlyingPx": px}
                    ev.append(f"{tag}OPENED {label} for {credit} credit (max loss ${st['open'][und]['maxLossUsd']})"); break
    elif paused and lo <= m <= hi:
        ev.append(f"no new spreads today: {r['noNewEntryDates'][day]}")


if __name__ == "__main__":
    main()
