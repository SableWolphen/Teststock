#!/usr/bin/env python3
"""ClaudeBot crypto signal engine.

Pulls public hourly candles (Coinbase Exchange, Kraken fallback), scores a
simple trend-pullback long setup for each coin Robinhood supports, backtests the
exact same rule on the last ~60 days with costs, and writes
docs/data/claudebot-signal.json for the executor and the dashboard.

Stdlib only so it runs anywhere. No secrets, no account data.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "claudebot-signal.json")
CONFIG = os.path.join(ROOT, "claudebot", "config.json")

UA = {"User-Agent": "teststock-claudebot/1.0"}


def load_config() -> dict:
    with open(CONFIG) as f:
        return json.load(f)


# ---------------------------------------------------------------- data
def http_json(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def coinbase_candles(sym: str, bars: int) -> list[dict]:
    """Hourly candles oldest->newest. Coinbase returns max 300 per call."""
    out: dict[int, dict] = {}
    end = int(time.time()) // 3600 * 3600
    while len(out) < bars:
        start = end - 300 * 3600
        url = (f"https://api.exchange.coinbase.com/products/{sym}-USD/candles"
               f"?granularity=3600&start={datetime.fromtimestamp(start, timezone.utc).isoformat()}"
               f"&end={datetime.fromtimestamp(end, timezone.utc).isoformat()}")
        rows = http_json(url)
        if not rows:
            break
        for t, lo, hi, op, cl, vol in rows:
            out[int(t)] = dict(t=int(t), o=float(op), h=float(hi), l=float(lo), c=float(cl), v=float(vol))
        end = start
        time.sleep(0.25)
    return [out[k] for k in sorted(out)][-bars:]


def kraken_candles(sym: str, bars: int) -> list[dict]:
    pair = {"BTC": "XBTUSD", "DOGE": "XDGUSD"}.get(sym, f"{sym}USD")
    data = http_json(f"https://api.kraken.com/0/public/OHLC?pair={pair}&interval=60")
    if data.get("error"):
        raise RuntimeError(data["error"])
    key = next(k for k in data["result"] if k != "last")
    rows = [dict(t=int(r[0]), o=float(r[1]), h=float(r[2]), l=float(r[3]), c=float(r[4]), v=float(r[6]))
            for r in data["result"][key]]
    return rows[-bars:]


def candles(sym: str, bars: int) -> tuple[list[dict], str]:
    try:
        rows = coinbase_candles(sym, bars)
        if len(rows) >= 250:
            return rows, "coinbase"
    except Exception as e:  # noqa: BLE001
        print(f"coinbase {sym} failed: {e}", file=sys.stderr)
    rows = kraken_candles(sym, bars)
    return rows, "kraken"


# ---------------------------------------------------------------- indicators
def ema(vals: list[float], n: int) -> list[float]:
    k = 2 / (n + 1)
    out, e = [], vals[0]
    for v in vals:
        e = v * k + e * (1 - k)
        out.append(e)
    return out


def rsi(closes: list[float], n: int = 14) -> list[float]:
    out = [50.0] * len(closes)
    gain = loss = 0.0
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        g, l = max(d, 0), max(-d, 0)
        if i <= n:
            gain += g / n
            loss += l / n
        else:
            gain = (gain * (n - 1) + g) / n
            loss = (loss * (n - 1) + l) / n
        if i >= n:
            out[i] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    return out


def atr(rows: list[dict], n: int = 14) -> list[float]:
    out, a = [], None
    for i, r in enumerate(rows):
        tr = r["h"] - r["l"] if i == 0 else max(r["h"] - r["l"], abs(r["h"] - rows[i - 1]["c"]), abs(r["l"] - rows[i - 1]["c"]))
        a = tr if a is None else (a * (n - 1) + tr) / n
        out.append(a)
    return out


def indicators(rows: list[dict]) -> dict:
    c = [r["c"] for r in rows]
    return dict(c=c, e20=ema(c, 20), e50=ema(c, 50), e200=ema(c, 200), rsi=rsi(c), atr=atr(rows))


# ---------------------------------------------------------------- rule
def setup_at(ind: dict, i: int, cfg: dict) -> tuple[bool, list[str]]:
    """Trend-pullback long: uptrend stack, momentum resuming, not chasing."""
    s = cfg["strategy"]
    c, e20, e50, e200, r, a = (ind[k][i] for k in ("c", "e20", "e50", "e200", "rsi", "atr"))
    reasons = []
    if not (c > e50 > e200):
        reasons.append("not in uptrend (price > EMA50 > EMA200 fails)")
    if not e20 > e50:
        reasons.append("short-term trend not above medium-term (EMA20 <= EMA50)")
    if not (s["rsiMin"] <= r <= s["rsiMax"]):
        reasons.append(f"RSI {r:.0f} outside {s['rsiMin']}-{s['rsiMax']}")
    if (c - e20) / a > s["maxAtrAboveEma20"]:
        reasons.append("extended above EMA20 (would be chasing)")
    if i >= 3 and not c > ind["c"][i - 3]:
        reasons.append("no fresh 3h momentum")
    if a / c * 100 < s["minAtrPct"]:
        reasons.append("too quiet to clear trading costs")
    return (not reasons), reasons


def score_at(ind: dict, i: int) -> float:
    a = ind["atr"][i]
    trend = (ind["e20"][i] - ind["e50"][i]) / a
    stretch = (ind["c"][i] - ind["e20"][i]) / a
    return round(trend - 0.5 * max(stretch, 0) + (ind["rsi"][i] - 50) / 20, 3)


def backtest(rows: list[dict], ind: dict, cfg: dict, risk_off: list[bool] | None) -> list[dict]:
    """Walk forward bar by bar with the exact live exit rules and round-trip cost."""
    s = cfg["strategy"]
    cost = cfg["costs"]["roundTripPct"] / 100
    trades, pos = [], None
    for i in range(210, len(rows)):
        bar = rows[i]
        if pos:
            stop_hit = bar["l"] <= pos["stop"]
            tgt_hit = bar["h"] >= pos["target"]
            exit_px, why = None, None
            if stop_hit:  # assume worst case when both touch in one bar
                exit_px, why = pos["stop"], "stop"
            elif tgt_hit:
                exit_px, why = pos["target"], "target"
            else:
                if bar["h"] >= pos["entry"] + s["breakevenAfterAtr"] * pos["atr"]:
                    pos["stop"] = max(pos["stop"], pos["entry"])
                if i - pos["i"] >= s["maxHoldHours"]:
                    exit_px, why = bar["c"], "time"
                elif ind["c"][i] < ind["e50"][i]:
                    exit_px, why = bar["c"], "trend break"
            if exit_px:
                ret = exit_px / pos["entry"] - 1 - cost
                trades.append(dict(ret=ret, why=why, hours=i - pos["i"]))
                pos = None
            continue
        if risk_off and risk_off[i]:
            continue
        ok, _ = setup_at(ind, i, cfg)
        if ok and i + 1 < len(rows):
            entry = rows[i + 1]["o"]  # next bar open, no look-ahead
            a = ind["atr"][i]
            pos = dict(i=i + 1, entry=entry, atr=a,
                       stop=entry - s["stopAtr"] * a, target=entry + s["targetAtr"] * a)
    return trades


def summarize(trades: list[dict]) -> dict:
    if not trades:
        return dict(trades=0, winRatePct=None, avgTradePct=None, totalReturnPct=None, profitFactor=None, maxDrawdownPct=None)
    wins = [t["ret"] for t in trades if t["ret"] > 0]
    losses = [t["ret"] for t in trades if t["ret"] <= 0]
    eq, peak, mdd = 1.0, 1.0, 0.0
    for t in trades:
        eq *= 1 + t["ret"]
        peak = max(peak, eq)
        mdd = min(mdd, eq / peak - 1)
    pf = (sum(wins) / -sum(losses)) if losses and sum(losses) < 0 else None
    return dict(
        trades=len(trades),
        winRatePct=round(100 * len(wins) / len(trades), 1),
        avgTradePct=round(100 * sum(t["ret"] for t in trades) / len(trades), 3),
        totalReturnPct=round(100 * (eq - 1), 2),
        profitFactor=round(pf, 2) if pf else None,
        maxDrawdownPct=round(100 * mdd, 2),
    )


# ---------------------------------------------------------------- main
def main() -> int:
    cfg = load_config()
    s = cfg["strategy"]
    bars = cfg["data"]["hourlyBars"]
    now = datetime.now(timezone.utc)

    data = {}
    for sym in cfg["universe"]:
        try:
            rows, src = candles(sym, bars)
            # drop the still-forming candle so signals use closed bars only
            if rows and rows[-1]["t"] + 3600 > now.timestamp():
                rows = rows[:-1]
            if len(rows) < 250:
                raise RuntimeError(f"only {len(rows)} bars")
            data[sym] = (rows, src, indicators(rows))
        except Exception as e:  # noqa: BLE001
            print(f"skip {sym}: {e}", file=sys.stderr)

    if "BTC" not in data:
        print("BTC data unavailable; refusing to publish a signal", file=sys.stderr)
        return 1

    # Market regime from BTC: no new longs while BTC is in an hourly downtrend.
    btc_rows, _, btc = data["BTC"]
    btc_t = {r["t"]: i for i, r in enumerate(btc_rows)}

    def btc_risk_off(i: int) -> bool:
        return btc["c"][i] < btc["e200"][i] and btc["e50"][i] < btc["e200"][i]

    regime_off_now = btc_risk_off(len(btc_rows) - 1)

    coins, all_trades = [], []
    for sym, (rows, src, ind) in data.items():
        i = len(rows) - 1
        ok, reasons = setup_at(ind, i, cfg)
        if regime_off_now:
            ok = False
            reasons = ["market risk-off: BTC below its 200-hour average"] + reasons
        roff = [btc_risk_off(btc_t[r["t"]]) if r["t"] in btc_t else False for r in rows]
        bt = backtest(rows, ind, cfg, roff)
        all_trades += bt
        c, a = ind["c"][i], ind["atr"][i]
        bts = summarize(bt)
        edge_ok = bts["trades"] < cfg["risk"]["minBacktestTradesForEdgeCheck"] or (bts["profitFactor"] or 0) >= cfg["risk"]["minBacktestProfitFactor"]
        if ok and not edge_ok:
            ok = False
            reasons = [f"this rule lost money on {sym} recently (profit factor {bts['profitFactor']})"]
        coins.append(dict(
            symbol=sym,
            source=src,
            lastClose=round(c, 6),
            barTime=datetime.fromtimestamp(rows[i]["t"], timezone.utc).isoformat(),
            change24hPct=round(100 * (c / ind["c"][i - 24] - 1), 2),
            ema20=round(ind["e20"][i], 6), ema50=round(ind["e50"][i], 6), ema200=round(ind["e200"][i], 6),
            rsi=round(ind["rsi"][i], 1),
            atr=round(a, 6), atrPct=round(100 * a / c, 3),
            trend="up" if c > ind["e50"][i] > ind["e200"][i] else ("down" if c < ind["e50"][i] < ind["e200"][i] else "mixed"),
            exitSignal=c < ind["e50"][i],
            setup=ok,
            score=score_at(ind, i),
            blockers=reasons,
            plan=dict(
                stopAtrMultiple=s["stopAtr"], targetAtrMultiple=s["targetAtr"],
                refStop=round(c - s["stopAtr"] * a, 6), refTarget=round(c + s["targetAtr"] * a, 6),
            ),
            closes48h=[round(x, 6) for x in ind["c"][-48:]],
            edgeOk=edge_ok,
            backtest=bts,
        ))

    coins.sort(key=lambda x: (x["setup"], x["score"]), reverse=True)
    best = next((x["symbol"] for x in coins if x["setup"]), None)
    days = round(bars / 24)
    out = dict(
        schemaVersion=1,
        generatedAt=now.isoformat(),
        strategy=dict(name="Trend pullback (1h)", **s, roundTripCostPct=cfg["costs"]["roundTripPct"]),
        regime=dict(riskOff=regime_off_now, note="BTC below 200h EMA with 50h < 200h" if regime_off_now else "BTC trend OK"),
        bestCandidate=best,
        coins=coins,
        backtest=dict(windowDays=days, **summarize(all_trades),
                      note=f"Same rule, all coins, last ~{days} days of hourly bars, next-bar entry, worst-case intrabar fills, {cfg['costs']['roundTripPct']}% round-trip cost. Past results do not predict future results."),
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {OUT}: best={best} riskOff={regime_off_now} backtest={out['backtest']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
