#!/usr/bin/env python3
"""Modeled backtest of the ClaudeBot put-credit-spread rule on IWM.

There is no free historical option-quote data, so option prices are modeled with
Black-Scholes using the Cboe Russell 2000 volatility index (RVX) as implied vol
(fallback: 20-day realized vol x 1.2) plus a simple put skew. Fills are taken
slightly worse than model mid. Checks happen on daily closes only. Treat the
result as a sanity check of the rule's shape, not a promise.
Writes docs/data/claudebot-options-backtest.json.
"""
import csv, io, json, math, os, sys, urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "claudebot-options-backtest.json")
CFG = json.load(open(os.path.join(ROOT, "claudebot", "options_config.json")))
UA = {"User-Agent": "Mozilla/5.0 teststock-claudebot"}


def get(url, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()


def daily_bars(sym, start):
    key, sec = os.environ.get("ALPACA_API_KEY"), os.environ.get("ALPACA_API_SECRET")
    if key and sec:
        try:
            out, tok = [], None
            while True:
                url = (f"https://data.alpaca.markets/v2/stocks/{sym}/bars?timeframe=1Day&start={start}"
                       f"&adjustment=split&feed=iex&limit=10000" + (f"&page_token={tok}" if tok else ""))
                d = json.loads(get(url, {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": sec}))
                out += [(b["t"][:10], float(b["c"])) for b in d.get("bars") or []]
                tok = d.get("next_page_token")
                if not tok:
                    break
            if len(out) > 300:
                return out, "alpaca"
        except Exception as e:  # noqa: BLE001
            print("alpaca failed", e, file=sys.stderr)
    txt = get(f"https://stooq.com/q/d/l/?s={sym.lower()}.us&i=d")
    rows = [(r["Date"], float(r["Close"])) for r in csv.DictReader(io.StringIO(txt)) if r["Date"] >= start]
    return rows, "stooq"


def vol_index(name):
    try:
        txt = get(f"https://cdn.cboe.com/api/global/us_indices/daily_prices/{name}_History.csv")
        out = {}
        for r in csv.DictReader(io.StringIO(txt)):
            d = datetime.strptime(r["DATE"], "%m/%d/%Y").date().isoformat()
            out[d] = float(r["CLOSE"]) / 100
        return out
    except Exception as e:  # noqa: BLE001
        print("cboe failed", e, file=sys.stderr)
        return {}


def ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def put(S, K, T, sig, r=0.04):
    if T <= 0:
        return max(K - S, 0.0)
    d1 = (math.log(S / K) + (r + sig * sig / 2) * T) / (sig * math.sqrt(T))
    d2 = d1 - sig * math.sqrt(T)
    return K * math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1)


def put_delta(S, K, T, sig, r=0.04):
    d1 = (math.log(S / K) + (r + sig * sig / 2) * T) / (sig * math.sqrt(T))
    return ncdf(d1) - 1


def skew(sig, S, K):
    return sig * (1 + CFG["model"]["skewPerLogMoneyness"] * max(0.0, math.log(S / K)))


def run(bars, ivs, trend_filter):
    e = CFG["entry"]; x = CFG["exit"]; m = CFG["model"]
    closes = [c for _, c in bars]
    dates = [date.fromisoformat(d) for d, _ in bars]
    acct, peak, mdd = CFG["backtest"]["startingAccountUsd"], 0, 0
    acct0 = acct
    peak = acct
    trades, pos = [], None
    for i in range(25, len(bars)):
        S, d = closes[i], dates[i]
        rv = (sum((math.log(closes[k] / closes[k - 1])) ** 2 for k in range(i - 19, i + 1)) / 20 * 252) ** 0.5
        iv = ivs.get(d.isoformat()) or rv * 1.2
        if pos:
            T = max((pos["exp"] - d).days, 0) / 365
            val = put(S, pos["K"], T, skew(iv, S, pos["K"])) - put(S, pos["K"] - pos["w"], T, skew(iv, S, pos["K"] - pos["w"]))
            val = max(val, 0) + m["slippagePerSpread"]
            dte = (pos["exp"] - d).days
            why = None
            if val <= pos["credit"] * (1 - x["takeProfitPctOfCredit"] / 100):
                why = "take profit"
            elif val >= pos["credit"] * x["stopAtMultipleOfCredit"]:
                why = "stop"
            elif S < pos["K"]:
                why = "short strike breached"
            elif dte <= x["closeAtDte"]:
                why = "expiry"
            if why:
                val = min(val, pos["w"])
                pnl = (pos["credit"] - val) * 100 - m["feesPerRoundTrip"]
                acct += pnl
                trades.append(dict(entered=pos["d"].isoformat(), exited=d.isoformat(), pnl=round(pnl, 2), why=why, credit=round(pos["credit"], 2)))
                peak = max(peak, acct); mdd = min(mdd, acct / peak - 1)
                pos = None
            continue
        if trend_filter:
            sma = sum(closes[i - 19:i + 1]) / 20
            if S <= sma:
                continue
        exp = d + timedelta(days=e["targetDte"])
        while exp.weekday() != 4:  # Friday expiries
            exp += timedelta(days=1)
        T = (exp - d).days / 365
        K = math.floor(S)
        while K > S * 0.8 and abs(put_delta(S, K, T, skew(iv, S, K))) > e["maxShortDelta"]:
            K -= 1
        w = e["widthUsd"]
        credit = put(S, K, T, skew(iv, S, K)) - put(S, K - w, T, skew(iv, S, K - w)) - m["slippagePerSpread"]
        if credit < e["minCreditUsd"] or (w - credit) * 100 > acct:
            continue
        pos = dict(d=d, exp=exp, K=K, w=w, credit=credit)
    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] <= 0]
    return dict(
        trendFilter=trend_filter, trades=len(trades),
        winRatePct=round(100 * len(wins) / len(trades), 1) if trades else None,
        avgWinUsd=round(sum(t["pnl"] for t in wins) / len(wins), 2) if wins else None,
        avgLossUsd=round(sum(t["pnl"] for t in losses) / len(losses), 2) if losses else None,
        worstLossUsd=round(min(t["pnl"] for t in trades), 2) if trades else None,
        netPnlUsd=round(acct - acct0, 2), returnPct=round(100 * (acct / acct0 - 1), 1),
        maxDrawdownPct=round(100 * mdd, 1),
        exits={k: sum(1 for t in trades if t["why"] == k) for k in ("take profit", "stop", "short strike breached", "expiry")},
        last10=trades[-10:],
    )


def main():
    sym = CFG["underlying"]
    bars, src = daily_bars(sym, CFG["backtest"]["start"])
    ivs = vol_index("RVX") if sym == "IWM" else vol_index("VIX")
    res = dict(generatedAt=datetime.now(timezone.utc).isoformat(), underlying=sym, priceSource=src,
               ivSource="Cboe RVX" if ivs else "realized vol x1.2",
               days=len(bars), fromDate=bars[0][0], toDate=bars[-1][0],
               startingAccountUsd=CFG["backtest"]["startingAccountUsd"],
               results=[run(bars, ivs, True), run(bars, ivs, False)],
               caveat="Modeled option prices (Black-Scholes + vol index + skew), daily-close checks, fills worse than mid. Real fills, skew and gaps differ. Not a promise.")
    json.dump(res, open(OUT, "w"), indent=1)
    for r in res["results"]:
        print({k: v for k, v in r.items() if k != "last10"})


if __name__ == "__main__":
    main()
