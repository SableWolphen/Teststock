#!/usr/bin/env python3
"""Trade autopsy (board backlog #2, OpenAI #108). Research only: it reads closed option trades and
never trades, sizes or changes a rule.

For every closed option trade (options race, the option paper desks, and the live options-buying
desk) it compares the forecast with what happened and splits the result of ONE contract into:
  spread       the bid/ask cost paid to get in and out (-(ask - bid) x 100 at entry)
  fees         per-contract fees (whatever is left between the price move and the booked P&L)
  (every piece is a signed contribution to P&L: costs are negative)
  signal       what the stock move was worth: delta x stock change x 100 (calls +, puts -)
  timeDecay    the option's own drift that the stock move does not explain: time decay, plus
               volatility changes and delta error (exit bid - entry bid - signal)
  exitTiming   money given back from the best bid seen while held (exit bid - peak bid, <= 0)
signal + timeDecay = exit bid - entry bid; pnl = signal + timeDecay + spread + fees. exitTiming is
not added in: it says how much of the price move the exit rule gave back.
When the stock prices at entry and exit are unknown, signal and timeDecay stay combined
("priceMove") and are labelled so; in GitHub Actions the stock prices are fetched from Alpaca
(1-minute IEX bars) and cached in the output, so later runs need no network.

Race variants that bought the same contract at the same moment are ONE independent entry (they only
differ in the exit), so totals use independent entries and the variants show how much the exit rule
alone changed the result.

Writes docs/data/claudebot-trade-autopsy.json. Never stores quantities, balances or order ids.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "docs", "data")
OUT = os.path.join(DATA, "claudebot-trade-autopsy.json")
# desk file, desk label, mode
SOURCES = [("claudebot-optscalp-paper.json", "Options race", "paper"),
           ("claudebot-cheapcall-paper.json", "Dip-call paper", "paper"),
           ("claudebot-cheapstock-paper.json", "Cheap-stock call paper", "paper"),
           ("claudebot-dipcall-paper.json", "Dip-call research paper", "paper"),
           ("claudebot-moonshot-paper.json", "Moonshot paper", "paper"),
           ("claudebot-optbuy-ledger.json", "Options-buying desk", "live")]
OCC = re.compile(r"^([A-Z.]+)(\d{6})([CP])(\d{8})$")
COMPONENTS = ("spread", "fees", "signal", "timeDecay", "priceMove", "exitTiming")


def load(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def r2(x):
    return None if x is None else round(float(x), 2)


def closed_trades(doc, desk, mode):
    """Flatten a desk file into closed-trade rows: (variant, trade dict)."""
    rows = []
    if not isinstance(doc, dict):
        return rows
    if mode == "live":
        for t in doc.get("trades") or []:
            rows.append(("live", t))
        return rows
    for vid, s in (doc.get("strategies") or {}).items():
        for t in (s or {}).get("trades") or []:
            rows.append((vid, t))
    return rows


def normalise(t):
    """One contract's numbers from any desk's trade record. Returns None if it cannot be priced."""
    ask = t.get("ask", t.get("entryPrice"))
    out = t.get("exitBid", t.get("exitPrice"))
    if ask is None or out is None or t.get("pnlUsd") is None:
        return None
    ask, out, pnl = float(ask), float(out), float(t["pnlUsd"])
    bid = t.get("bid")
    bid = float(bid) if bid is not None else None
    m = OCC.match(str(t.get("symbol") or ""))
    kind = (t.get("type") or ("put" if m and m.group(3) == "P" else "call")).lower()
    return {"ask": ask, "bid": bid, "exit": out, "pnl": pnl, "kind": kind,
            "peak": float(t["peakBid"]) if t.get("peakBid") is not None else None,
            "delta": abs(float(t["delta"])) if t.get("delta") is not None else None,
            "forecast": float(t["forecastUsd"]) if t.get("forecastUsd") is not None else None,
            "entryAt": t.get("boughtAt") or t.get("enteredAt") or t.get("in"),
            "exitAt": t.get("exitAt") or t.get("exitedAt") or t.get("out"),
            "underlying": t.get("underlying") or (m.group(1) if m else None),
            "s0": t.get("underlyingPx", t.get("etfPx")),
            "s1": t.get("exitUnderlyingPx"),
            "etfRetPct": t.get("etfRetPct")}


def decompose(n, s0=None, s1=None):
    """Split one contract's result. All values in dollars for one contract."""
    fees = n["pnl"] - (n["exit"] - n["ask"]) * 100
    c = {"pnl": r2(n["pnl"]), "fees": r2(fees)}
    if n["bid"] is not None:
        c["spread"] = r2(-(n["ask"] - n["bid"]) * 100)
        move = (n["exit"] - n["bid"]) * 100
    else:            # no entry bid recorded: the spread cannot be separated from the price move
        c["spread"] = None
        move = (n["exit"] - n["ask"]) * 100
    if s0 is None and n["s0"] is not None and n["etfRetPct"] is not None:
        s0 = float(n["s0"]); s1 = s0 * (1 + float(n["etfRetPct"]) / 100)
    elif s0 is None and n["s0"] is not None and n["s1"] is not None:
        s0, s1 = float(n["s0"]), float(n["s1"])
    if s0 is not None and s1 is not None and n["delta"] is not None and n["bid"] is not None:
        sign = -1 if n["kind"] == "put" else 1
        sig = sign * n["delta"] * (float(s1) - float(s0)) * 100
        c["signal"], c["timeDecay"], c["priceMove"] = r2(sig), r2(move - sig), None
        c["stockMovePct"] = round(100 * (float(s1) / float(s0) - 1), 3) if float(s0) else None
    else:
        c["signal"] = c["timeDecay"] = None
        c["priceMove"] = r2(move)
    c["exitTiming"] = r2((n["exit"] - n["peak"]) * 100) if n["peak"] is not None else None
    # what decided the result: the biggest negative piece of a losing trade
    if n["pnl"] < 0:
        pieces = {k: c[k] for k in ("spread", "fees", "signal", "timeDecay", "priceMove")}
        neg = {k: v for k, v in pieces.items() if v is not None and v < 0}
        c["mainCause"] = min(neg, key=neg.get) if neg else None
    else:
        c["mainCause"] = None
    if n["forecast"] is not None:
        c["forecastUsd"] = r2(n["forecast"]); c["forecastErrorUsd"] = r2(n["pnl"] - n["forecast"])
    return c


def ts(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def fetch_underlying(sym, at, get):
    """Last 1-minute IEX close at or before `at` (None if not found)."""
    start = (at - timedelta(minutes=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
    end = (at + timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    d = get(f"https://data.alpaca.markets/v2/stocks/bars?symbols={sym}&timeframe=1Min&start={start}&end={end}&feed=iex&limit=100")
    bars = [b for b in ((d.get("bars") or {}).get(sym) or []) if ts(b["t"]) <= at]
    return float(bars[-1]["c"]) if bars else None


def build(docs, cache=None, get=None, now=None):
    """docs = {file name: parsed json}. cache = {"SYM@iso": price}. get = network getter or None."""
    cache = dict(cache or {})
    now = now or datetime.now(timezone.utc)
    entries, by_key = [], {}
    for fname, desk, mode in SOURCES:
        for vid, t in closed_trades(docs.get(fname), desk, mode):
            n = normalise(t)
            if not n:
                continue
            key = (desk, t.get("symbol"), n["entryAt"])
            e = by_key.get(key)
            if not e:
                e = {"desk": desk, "mode": mode, "symbol": t.get("symbol"), "underlying": n["underlying"], "type": n["kind"],
                     "entryAt": n["entryAt"], "day": t.get("day") or (str(n["entryAt"])[:10] if n["entryAt"] else None),
                     "entryAsk": n["ask"], "entryBid": n["bid"], "delta": n["delta"], "variants": [], "_n": n}
                by_key[key] = e; entries.append(e)
            s0 = s1 = None
            if n["underlying"] and n["s0"] is None:
                a, b = ts(n["entryAt"]), ts(n["exitAt"])
                if a and b and (b - a) < timedelta(days=1):
                    ka, kb = f"{n['underlying']}@{a.isoformat()}", f"{n['underlying']}@{b.isoformat()}"
                    for k_, at in ((ka, a), (kb, b)):
                        if k_ not in cache and get:
                            try:
                                cache[k_] = fetch_underlying(n["underlying"], at, get)
                            except Exception as ex:  # noqa: BLE001
                                print(f"stock price fetch failed for {k_}: {ex}", file=sys.stderr)
                    s0, s1 = cache.get(ka), cache.get(kb)
            c = decompose(n, s0, s1)
            e["variants"].append({"variant": vid, "exitAt": n["exitAt"], "exitBid": n["exit"], "peakBid": n["peak"],
                                  "why": t.get("why") or t.get("reason"), **c})
    # one independent result per entry: the median-P&L variant (so no exit rule's luck is picked)
    for e in entries:
        vs = sorted(e["variants"], key=lambda v: v["pnl"])
        mid = vs[(len(vs) - 1) // 2]
        e["result"] = {k: mid.get(k) for k in ("pnl",) + COMPONENTS + ("mainCause", "forecastUsd", "forecastErrorUsd", "stockMovePct", "variant")}
        e["exitRuleRangeUsd"] = [vs[0]["pnl"], vs[-1]["pnl"]]
        e.pop("_n", None)
    return entries, cache, now


def summarise(entries):
    out = {}
    for desk in sorted({e["desk"] for e in entries}):
        es = [e for e in entries if e["desk"] == desk]
        res = [e["result"] for e in es]
        known = {k: sum(1 for r in res if r.get(k) is not None) for k in COMPONENTS}
        tot = {k: r2(sum(r[k] for r in res if r.get(k) is not None)) if k == "pnl" or known[k] else None for k in ("pnl",) + COMPONENTS}
        loss = [r for r in res if r["pnl"] < 0]
        causes = {}
        for r in loss:
            if r.get("mainCause"):
                causes[r["mainCause"]] = causes.get(r["mainCause"], 0) + 1
        fc = [r for r in res if r.get("forecastUsd") is not None]
        best_exit = r2(sum(e["exitRuleRangeUsd"][1] for e in es))
        worst_exit = r2(sum(e["exitRuleRangeUsd"][0] for e in es))
        avg_spread_pct = [100 * (e["entryAsk"] - e["entryBid"]) / ((e["entryAsk"] + e["entryBid"]) / 2) for e in es if e["entryBid"]]
        lines = []
        if tot["spread"] is not None and tot["pnl"] < 0 and known["spread"]:
            lines.append(f"Crossing the bid/ask cost ${-tot['spread']:.2f} of the ${-tot['pnl']:.2f} lost "
                         f"({100 * tot['spread'] / tot['pnl']:.0f}%); average spread {sum(avg_spread_pct) / len(avg_spread_pct):.1f}% of the price." if avg_spread_pct else "")
        if known["signal"]:
            lines.append(f"The stock moves themselves were worth ${tot['signal']:+.2f}; time decay and volatility ${tot['timeDecay']:+.2f}.")
        elif known["priceMove"]:
            lines.append(f"Option price moves (stock move + time decay together; stock prices not available) ${tot['priceMove']:+.2f}.")
        if known["exitTiming"]:
            lines.append(f"Bids given back from the best price seen while held: ${tot['exitTiming']:+.2f}. "
                         f"Exit rule alone: best variant total ${best_exit:+.2f}, worst ${worst_exit:+.2f}.")
        if fc:
            fsum = sum(r["forecastUsd"] for r in fc); asum = sum(r["pnl"] for r in fc)
            lines.append(f"Forecast ${fsum:+.2f} vs actual ${asum:+.2f} over {len(fc)} trades "
                         f"({'forecast was too hopeful' if asum < fsum else 'forecast was cautious'}).")
        out[desk] = {"mode": es[0]["mode"], "independentTrades": len(es), "wins": sum(1 for r in res if r["pnl"] > 0),
                     "variantTrades": sum(len(e["variants"]) for e in es), "days": len({e["day"] for e in es}),
                     "totalsUsd": tot, "componentsKnownFor": known, "mainCauseOfLosses": causes,
                     "forecastUsd": r2(sum(r["forecastUsd"] for r in fc)) if fc else None,
                     "forecastedTradesActualUsd": r2(sum(r["pnl"] for r in fc)) if fc else None,
                     "exitRuleBestUsd": best_exit, "exitRuleWorstUsd": worst_exit,
                     "findings": [x for x in lines if x]}
    return out


def main():
    prev = load(OUT, {}) or {}
    docs = {f: load(os.path.join(DATA, f)) for f, _, _ in SOURCES}
    get = None
    if os.environ.get("ALPACA_API_KEY") and os.environ.get("ALPACA_API_SECRET"):
        hdr = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
        get = lambda u: json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=hdr), timeout=30).read())  # noqa: E731
    entries, cache, now = build(docs, prev.get("underlyingCache"), get)
    out = {"schemaVersion": 1, "generatedAt": now.isoformat().replace("+00:00", "Z"), "mode": "research",
           "note": "Research only: one contract per trade, executable prices (buy at ask, sell at bid). "
                   "Never changes a live rule. Race variants that bought the same contract at the same time count as one trade.",
           "desks": summarise(entries), "trades": entries,
           "underlyingCache": {k: v for k, v in cache.items() if v is not None}}
    os.makedirs(DATA, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    for d, s in out["desks"].items():
        print(f"{d}: {s['independentTrades']} trades, ${s['totalsUsd']['pnl']:+.2f}; " + " ".join(s["findings"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
