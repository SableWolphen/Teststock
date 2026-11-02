#!/usr/bin/env python3
"""Nightly scan for the options-buying desk's wider universe (stocks + extra ETFs).

For every symbol in optbuy_config.json `scanUniverse`, pulls completed daily closes and works out
the two prices that decide the Dip signal for TODAY's price P (the live run supplies P):
  trendFloor = P must be above this for P > SMA(200) incl. today  ( = sum of last 199 closes / 199 )
  rsiTrigger = P must be below this for RSI(2) < rsi2Below          (solved by bisection)
A signal is possible only when trendFloor < rsiTrigger. Symbols whose trigger is reachable
within `scanMaxDropPct` of the last close are listed in `watch`; the hourly run fetches live
quotes only for those. Places no orders and touches no account data.
Also publishes `dipWatch`: how far each live Dip desk ETF is from a buy signal (Scout's job).
Writes docs/data/claudebot-optbuy-scan.json.
"""
import importlib.util, json, os, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-optbuy-scan.json")
_s = importlib.util.spec_from_file_location("obt", os.path.join(HERE, "options_backtest.py"))
obt = importlib.util.module_from_spec(_s); _s.loader.exec_module(obt)
_d = importlib.util.spec_from_file_location("dipb", os.path.join(HERE, "dip_bot.py"))
dipb = importlib.util.module_from_spec(_d); _d.loader.exec_module(dipb)


def triggers(closes, trend, rsi_below):
    """closes = completed daily closes (oldest first). Returns (trendFloor, rsiTrigger)."""
    floor = sum(closes[-(trend - 1):]) / (trend - 1)
    hist = closes[-(trend + 10):]
    lo, hi = closes[-1] * 0.5, closes[-1]
    if dipb.rsi2(hist + [lo]) >= rsi_below:
        return floor, None
    for _ in range(60):
        mid = (lo + hi) / 2
        if dipb.rsi2(hist + [mid]) < rsi_below:
            lo = mid
        else:
            hi = mid
    return floor, lo


def main():
    cfg = json.load(open(os.path.join(HERE, "optbuy_config.json")))
    s, sc = cfg["signal"], cfg["scan"]
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    # after 21:00 UTC (4-5 PM ET) today's bar is final; before that only earlier sessions count
    cutoff = today if now.hour < 21 else "9999"
    rows, watch, errors = {}, [], []
    for sym in cfg["scanUniverse"]:
        try:
            bars, src = obt.daily_bars(sym, "2025-06-01")
            bars = [b for b in bars if b[0] < cutoff]         # completed sessions only
            c = [x for _, x in bars]
            if len(c) < s["trendSma"] + 10:
                errors.append(f"{sym}: only {len(c)} closes"); continue
            last = c[-1]
            if not (sc["minPrice"] <= last <= sc["maxPrice"]):
                rows[sym] = {"lastClose": round(last, 2), "lastDate": bars[-1][0], "skip": "price outside range"}; continue
            floor, trig = triggers(c, s["trendSma"], s["rsi2Below"])
            r = {"lastClose": round(last, 2), "lastDate": bars[-1][0], "trendFloor": round(floor, 4),
                 "rsiTrigger": round(trig, 4) if trig else None, "source": src}
            if trig and trig > floor and (last - trig) / last * 100 <= sc["maxDropPct"]:
                watch.append(sym)
            rows[sym] = r
        except Exception as e:  # noqa: BLE001
            errors.append(f"{sym}: {e}")
    # Scout's dip watch: how far each live Dip desk ETF is from a buy signal (no price filter)
    dip_watch = []
    for sym in json.load(open(os.path.join(HERE, "dip_config.json")))["symbols"]:
        try:
            bars, _ = obt.daily_bars(sym, "2025-06-01")
            c = [x for d, x in bars if d < cutoff]
            if len(c) < s["trendSma"] + 10:
                continue
            floor, trig = triggers(c, s["trendSma"], s["rsi2Below"])
            last = c[-1]
            dip_watch.append({"symbol": sym, "lastClose": round(last, 2), "rsi2": round(dipb.rsi2(c[-(s["trendSma"] + 10):]), 1),
                              "trendFloor": round(floor, 2), "rsiTrigger": round(trig, 2) if trig else None,
                              "uptrend": last > floor,
                              "dropNeededPct": round(100 * (last - trig) / last, 2) if trig and trig > floor else None})
        except Exception as e:  # noqa: BLE001
            errors.append(f"dip {sym}: {e}")
    dip_watch.sort(key=lambda r: (r["dropNeededPct"] is None, r["dropNeededPct"] or 0))
    dates = sorted({r["lastDate"] for r in rows.values()})
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "asOf": dates[-1] if dates else None,
           "rule": f"signal when trendFloor < price < rsiTrigger (RSI2 < {s['rsi2Below']}, above {s['trendSma']}-day average)",
           "watch": watch, "dipWatch": dip_watch, "symbols": rows, "errors": errors}
    json.dump(out, open(OUT, "w"), indent=1)
    print(f"{len(rows)} scanned, {len(watch)} on watch, {len(errors)} errors")
    return 0 if rows else 1


if __name__ == "__main__":
    sys.exit(main())
