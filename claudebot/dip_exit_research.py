#!/usr/bin/env python3
"""Exit-rule comparison for the Dip desk (board asked 2026-11-10 to see the options side by side).
RESEARCH ONLY: reads prices, writes one results file, never touches live rules, configs or orders.

Entry is the live Dip rule, frozen: RSI(2) < 5 at the close while the close is above the 200-day
average. Only the exit changes between variants. Everything is checked on daily closes (the live desk
also checks hourly, so live results will differ somewhat). Cost 0.03% per side. Same 7 funds as the
live desk. Two periods are reported separately: 2018-2022 (includes the 2020 crash and the 2022 bear
market) and 2023-now. Past results do not predict future results.
Writes docs/data/claudebot-dip-exit-research.json.
"""
import importlib.util, json, os
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("db", os.path.join(HERE, "dip_backtest.py"))
db = importlib.util.module_from_spec(spec); spec.loader.exec_module(db)
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-dip-exit-research.json")
SYMS = ["SMH", "IWM", "SPY", "DIA", "XLK", "KRE", "QQQ"]
COST = 0.0003
SPLIT = "2023-01-01"

# bounce: sell when the close is back above the 5-day average (or RSI(2) > 70)
# target: sell when the close is up at least this much from entry (None = no profit target)
VARIANTS = [
    {"id": "current", "name": "Current rule: bounce, 10 days, 5% stop", "bounce": True, "target": None, "hold": 10, "stop": 0.05},
    {"id": "target2", "name": "Fixed +2% target, 10 days, 5% stop", "bounce": False, "target": 0.02, "hold": 10, "stop": 0.05},
    {"id": "target3", "name": "Fixed +3% target, 10 days, 5% stop", "bounce": False, "target": 0.03, "hold": 10, "stop": 0.05},
    {"id": "hold15", "name": "Longer hold: bounce, 15 days, 5% stop", "bounce": True, "target": None, "hold": 15, "stop": 0.05},
    {"id": "stop3", "name": "Tighter stop: bounce, 10 days, 3% stop", "bounce": True, "target": None, "hold": 10, "stop": 0.03},
]


def run(bars, v):
    dates = [d for d, _ in bars]; c = [x for _, x in bars]; r = db.rsi2(c)
    trades, pos = [], None
    for i in range(210, len(c)):
        if pos:
            held = i - pos["i"]; chg = c[i] / pos["px"] - 1; why = None
            if chg <= -v["stop"]: why = "stop"
            elif v["target"] is not None and chg >= v["target"]: why = "target"
            elif v["bounce"] and (c[i] > db.sma(c, 5, i) or r[i] > 70): why = "bounce"
            elif held >= v["hold"]: why = "time"
            if why:
                ret = c[i] / pos["px"] * (1 - COST) / (1 + COST) - 1
                trades.append({"in": dates[pos["i"]], "out": dates[i], "ret": ret, "why": why, "days": held}); pos = None
            continue
        tr = db.sma(c, 200, i)
        if tr and c[i] > tr and r[i] < 5:
            pos = {"i": i, "px": c[i]}
    return trades


def summ(t):
    if not t:
        return {"trades": 0}
    w = [x["ret"] for x in t if x["ret"] > 0]; l = [x["ret"] for x in t if x["ret"] <= 0]
    why = {}
    for x in t:
        why[x["why"]] = why.get(x["why"], 0) + 1
    return {"trades": len(t), "winRatePct": round(100 * len(w) / len(t), 1),
            "avgTradePct": round(100 * sum(w + l) / len(t), 3),
            "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None,
            "worstTradePct": round(100 * min(x["ret"] for x in t), 2),
            "avgDays": round(sum(x["days"] for x in t) / len(t), 1), "exits": why}


def compare(data):
    rows = []
    for v in VARIANTS:
        allt = [x for s in data for x in run(data[s], v)]
        rows.append({"id": v["id"], "name": v["name"],
                     "2018-2022": summ([x for x in allt if x["in"] < SPLIT]),
                     "2023-now": summ([x for x in allt if x["in"] >= SPLIT])})
    return rows


def bars_longest(sym, start):
    """The bot's usual feed only reaches back to mid-2020 for most funds. Also try the full-market
    historical feed (free for data older than 15 minutes) and keep whichever starts earlier, so the
    older period really covers 2018-2022."""
    best, name = db.ob.daily_bars(sym, start)
    key, sec = os.environ.get("ALPACA_API_KEY"), os.environ.get("ALPACA_API_SECRET")
    if key and sec:
        try:
            end = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
            rows, tok = [], None
            while True:
                url = (f"https://data.alpaca.markets/v2/stocks/{sym}/bars?timeframe=1Day&start={start}&end={end}"
                       f"&adjustment=split&feed=sip&limit=10000" + (f"&page_token={tok}" if tok else ""))
                d = json.loads(db.ob.get(url, {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": sec}))
                rows += [(b["t"][:10], float(b["c"])) for b in d.get("bars") or []]
                tok = d.get("next_page_token")
                if not tok:
                    break
            if len(rows) > 300 and rows[0][0] < best[0][0]:
                best, name = rows, "alpaca-sip"
        except Exception as e:  # noqa: BLE001
            print(sym, "long-history feed unavailable:", str(e)[:80])
    return best, name


def main():
    data, src = {}, {}
    for s in SYMS:
        data[s], src[s] = bars_longest(s, "2017-01-01")
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "symbols": SYMS, "costPerSidePct": COST * 100,
           "dataSource": src, "firstBar": {s: data[s][0][0] for s in SYMS},
           "entry": "RSI(2) < 5 at the close, close above the 200-day average (live Dip rule, frozen)",
           "note": "Research only. Daily closes; the live desk also checks hourly. Past results do not predict future results. "
                   "Nothing here changes live rules: the board picks.",
           "variants": compare(data)}
    json.dump(out, open(OUT, "w"), indent=1)
    for r in out["variants"]:
        print(r["name"]); print("   2018-2022", r["2018-2022"]); print("   2023-now ", r["2023-now"])


if __name__ == "__main__":
    main()
