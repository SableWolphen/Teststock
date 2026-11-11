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
from datetime import datetime, timedelta, timezone

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


ALPACA_DATA = "https://data.alpaca.markets/v2"


def _auth():
    k, s_ = os.environ.get("ALPACA_API_KEY"), os.environ.get("ALPACA_API_SECRET")
    return {"APCA-API-KEY-ID": k, "APCA-API-SECRET-KEY": s_} if k and s_ else None


def optionable_stocks(get=None):
    """Every active US stock with listed options (board 2026-11-11: 'make sure it watches all stocks').
    Tries the live, then the paper trading API (the same keys work on one of them)."""
    get = get or obt.get; h = _auth(); last = None
    for base in ("https://api.alpaca.markets", "https://paper-api.alpaca.markets"):
        try:
            assets = json.loads(get(f"{base}/v2/assets?status=active&asset_class=us_equity&attributes=options_enabled", h))
            syms = sorted({a["symbol"] for a in assets if a.get("tradable") and "." not in a["symbol"] and "/" not in a["symbol"]})
            if syms:
                return syms
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"asset list unavailable: {last}")


def multi_bars(symbols, start, get=None, batch=100):
    """{symbol: [(day, close, volume), ...]} for many symbols at once (multi-symbol bars endpoint)."""
    get = get or obt.get; h = _auth(); out = {}
    for i in range(0, len(symbols), batch):
        chunk, tok = symbols[i:i + batch], None
        for _ in range(200):
            url = (f"{ALPACA_DATA}/stocks/bars?symbols={','.join(chunk)}&timeframe=1Day&start={start}"
                   f"&adjustment=split&feed=iex&limit=10000" + (f"&page_token={tok}" if tok else ""))
            d = json.loads(get(url, h))
            for sym, bs in (d.get("bars") or {}).items():
                out.setdefault(sym, []).extend((b["t"][:10], float(b["c"]), float(b.get("v") or 0)) for b in bs)
            tok = d.get("next_page_token")
            if not tok:
                break
    return out


def discover(sc, today, get=None):
    """All optionable stocks whose price could put them inside the cheap-stock rule, with enough trading
    to matter. Returns (symbols, note). Two passes: a cheap 3-week look at everything, then the caller
    fetches full history only for the survivors."""
    allsyms = optionable_stocks(get)
    start = (datetime.fromisoformat(today) - timedelta(days=21)).date().isoformat()
    recent = multi_bars(allsyms, start, get)
    hi = sc["cheapCeiling"] * (1 + sc["maxDropPct"] / 100)
    keep = []
    for sym, bs in recent.items():
        if len(bs) < 5:
            continue
        px = bs[-1][1]; vol = sum(v for _, _, v in bs[-10:]) / min(10, len(bs))
        if sc["minPrice"] <= px <= hi and vol >= sc["minIexVolume"]:
            keep.append(sym)
    return sorted(keep), f"{len(allsyms)} optionable stocks, {len(keep)} priced ${sc['minPrice']}-{hi:.2f} with enough volume"


def main():
    cfg = json.load(open(os.path.join(HERE, "optbuy_config.json")))
    s, sc = cfg["signal"], cfg["scan"]
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    # after 21:00 UTC (4-5 PM ET) today's bar is final; before that only earlier sessions count
    cutoff = today if now.hour < 21 else "9999"
    rows, watch, errors = {}, [], []
    universe, found, note, hist = list(cfg["scanUniverse"]), [], None, {}
    if sc.get("allOptionableStocks") and _auth():
        try:
            found, note = discover(sc, today)
            extra = [x for x in found if x not in universe]
            hist = {k: [(d, c_) for d, c_, _ in v] for k, v in multi_bars(extra, "2025-06-01").items()}
            universe += extra
            print(note, "|", len(extra), "added to the fixed list")
        except Exception as e:  # noqa: BLE001
            errors.append(f"all-stocks discovery failed, fixed list only: {e}")
    for sym in universe:
        try:
            bars, src = (hist[sym], "alpaca") if sym in hist else obt.daily_bars(sym, "2025-06-01")
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
           "watch": watch, "dipWatch": dip_watch, "symbols": rows, "errors": errors,
           "discovered": found, "discoveryNote": note}
    json.dump(out, open(OUT, "w"), indent=1)
    print(f"{len(rows)} scanned, {len(watch)} on watch, {len(errors)} errors")
    return 0 if rows else 1


if __name__ == "__main__":
    sys.exit(main())
