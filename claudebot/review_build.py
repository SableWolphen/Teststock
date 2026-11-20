#!/usr/bin/env python3
"""Builds docs/data/claudebot-review.json for the Trade Review page (docs/review.html).

1. Trade review cards: every closed REAL-money trade from the live ledgers, with daily closes of
   the stock/fund around it so the page can draw where the bot bought and sold.
2. Monthly scorecard: profit/loss per strategy per month, real money and paper, so it's easy to
   see which strategies earn their keep.

Display only: reads ledgers, fetches public daily prices, places no orders, changes no rules.
Never writes account numbers or balances (ledgers already hold only per-trade dollar results)."""
import importlib.util, json, os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data")
OUT = os.path.join(DATA, "claudebot-review.json")

RULES = {  # plain-English names and what each rule waits for
    "dip": ("Sharp dip (index funds)", "Buys a fund after a sharp drop while its long-term trend is up; sells on the bounce above its 5-day average."),
    "sectorDip": ("Sharp dip (sector funds)", "Same dip rule on sector funds like SMH, XLK and KRE."),
    "double7": ("Double 7s", "Buys at a new 7-day low in an uptrend; sells at a new 7-day high."),
    "down3": ("3 down days", "Buys after three lower closes in an uptrend; sells on the first up close."),
    "cheapStock": ("Cheap-stock calls", "Bought a call on a cheap stock near its price (desk now OFF)."),
    "index50": ("$50 index calls", "Bought a ~$50 call on SPY/QQQ/IWM (desk now OFF)."),
    "spread": ("Put credit spreads", "Sells a put and buys a cheaper one below it; wins if the fund stays above the short strike."),
}


def load(name, default=None):
    try:
        return json.load(open(os.path.join(DATA, name)))
    except Exception:  # noqa: BLE001
        return default


def day(s):
    return (s or "")[:10]


def real_trades():
    out = []
    for t in (load("claudebot-dip-ledger.json", {}) or {}).get("trades", []):
        r = t.get("rule") or "dip"
        out.append(dict(desk="Dip desk", rule=r, symbol=t.get("symbol"), label=t.get("label") or t.get("symbol"),
                        kind="shares", entered=t.get("enteredAt"), exited=t.get("exitedAt"),
                        entryPrice=t.get("entryPrice"), exitPrice=t.get("exitPrice"), costUsd=t.get("usd"),
                        pnlUsd=t.get("pnlUsd"), returnPct=t.get("returnPct"), reason=t.get("reason"), partial=bool(t.get("partial"))))
    for t in (load("claudebot-optbuy-ledger.json", {}) or {}).get("trades", []):
        out.append(dict(desk="Options-buying desk", rule=t.get("rule") or "cheapStock", symbol=t.get("symbol"), label=t.get("label"),
                        kind="option", entered=t.get("enteredAt"), exited=t.get("exitedAt"),
                        entryPrice=t.get("entryPrice"), exitPrice=t.get("exitPrice"), pnlUsd=t.get("pnlUsd"),
                        returnPct=t.get("returnPct"), reason=t.get("reason")))
    for t in (load("claudebot-options-ledger.json", {}) or {}).get("trades", []):
        if t.get("mode") != "live":
            continue
        out.append(dict(desk="Spread desk", rule="spread", symbol=t.get("underlying"), label=t.get("label"), kind="spread",
                        entered=t.get("enteredAt"), exited=t.get("exitedAt"), entryPrice=t.get("credit"), exitPrice=t.get("debit"),
                        pnlUsd=t.get("pnlUsd"), reason=t.get("reason")))
    return [t for t in out if t.get("exited") and t.get("pnlUsd") is not None]


def paper_trades():
    """(strategy name, desk, exit date, pnl) for every closed paper trade we can find."""
    rows = []
    e = load("claudebot-edge-paper.json", {}) or {}
    for sid, s in (e.get("strategies") or {}).items():
        nm = (RULES.get(sid) or (s.get("name") or sid,))[0]
        for t in s.get("trades") or []:
            if t.get("out") and t.get("pnlUsd") is not None:
                rows.append((nm, "Paper: edges", day(t["out"]), t["pnlUsd"]))
    sp = load("claudebot-spread-paper.json", {}) or {}
    for sid, s in (sp.get("strategies") or {}).items():
        nm = "Put credit spreads" + ("" if sid == "spreads" else f" ({sid})")
        for t in s.get("trades") or []:
            if t.get("out") and t.get("pnlUsd") is not None:
                rows.append((nm, "Paper: spreads", day(t["out"]), t["pnlUsd"]))
    dt = load("claudebot-daytrade-paper.json", {}) or {}
    names = {x.get("id"): x.get("name") for x in dt.get("leaderboard") or []}
    for sid, s in (dt.get("strategies") or {}).items():
        for t in s.get("trades") or []:
            if t.get("day") and t.get("pnlUsd") is not None:
                rows.append(("Day trade: " + (names.get(sid) or sid), "Paper: day trading", day(t["day"]), t["pnlUsd"]))
    oc = load("claudebot-optscalp-paper.json", {}) or {}
    for sid, s in (oc.get("strategies") or {}).items():
        for t in s.get("trades") or []:
            d = t.get("exitAt") or t.get("day")
            if d and t.get("pnlUsd") is not None:
                rows.append(("Options scalping (all versions)", "Paper: options scalping", day(d), t["pnlUsd"]))
    return rows


def heatmap(real, paper):
    cells = defaultdict(lambda: dict(pnlUsd=0.0, trades=0, wins=0))
    meta = {}
    for t in real:
        nm = RULES.get(t["rule"], (t["rule"],))[0]
        key = ("Real: " + nm, day(t["exited"])[:7])
        meta["Real: " + nm] = dict(money="real", desk=t["desk"])
        c = cells[key]; c["pnlUsd"] += t["pnlUsd"]; c["trades"] += 1; c["wins"] += t["pnlUsd"] > 0
    for nm, desk, d, p in paper:
        key = ("Paper: " + nm, d[:7])
        meta["Paper: " + nm] = dict(money="paper", desk=desk)
        c = cells[key]; c["pnlUsd"] += p; c["trades"] += 1; c["wins"] += p > 0
    months = sorted({m for _, m in cells})
    rows = []
    for nm in sorted(meta, key=lambda n: (meta[n]["money"] != "real", n)):
        row = {m: {**cells[(nm, m)], "pnlUsd": round(cells[(nm, m)]["pnlUsd"], 2)} for m in months if (nm, m) in cells}
        tot = round(sum(v["pnlUsd"] for v in row.values()), 2)
        rows.append(dict(name=nm, **meta[nm], months=row, totalUsd=tot, trades=sum(v["trades"] for v in row.values()),
                         wins=sum(v["wins"] for v in row.values())))
    return dict(months=months, rows=rows)


def add_bars(trades):
    try:
        spec = importlib.util.spec_from_file_location("ob", os.path.join(ROOT, "claudebot", "options_backtest.py"))
        ob = importlib.util.module_from_spec(spec); spec.loader.exec_module(ob)
    except Exception as e:  # noqa: BLE001
        print("price loader unavailable:", e); return "none"
    cache, src = {}, "none"
    for t in trades:
        s = t["symbol"]
        if not s:
            continue
        if s not in cache:
            first = min(day(x["entered"]) for x in trades if x["symbol"] == s)
            start = (datetime.fromisoformat(first) - timedelta(days=60)).date().isoformat()
            try:
                cache[s], src = ob.daily_bars(s, start)
            except Exception as e:  # noqa: BLE001
                print("bars failed", s, e); cache[s] = []
        bars = cache[s]
        a, b = day(t["entered"]), day(t["exited"])
        before = [x for x in bars if x[0] < a][-20:]
        mid = [x for x in bars if a <= x[0] <= b]
        after = [x for x in bars if x[0] > b][:7]
        t["bars"] = [[d, round(c, 4)] for d, c in before + mid + after]
    return src


def main():
    real = sorted(real_trades(), key=lambda t: t["exited"], reverse=True)
    src = add_bars(real) if os.environ.get("REVIEW_SKIP_BARS") != "1" else "skipped"
    for t in real:
        t["ruleName"], t["ruleWhy"] = RULES.get(t["rule"], (t["rule"], ""))
        t["holdDays"] = round((datetime.fromisoformat(t["exited"].replace("Z", "+00:00")) - datetime.fromisoformat(t["entered"].replace("Z", "+00:00"))).total_seconds() / 86400, 1)
    hm = heatmap(real, paper_trades())
    res = dict(generatedAt=datetime.now(timezone.utc).isoformat(), priceSource=src,
               realTotals=dict(trades=len(real), wins=sum(t["pnlUsd"] > 0 for t in real), pnlUsd=round(sum(t["pnlUsd"] for t in real), 2)),
               note="Real trades are what the bot recorded in its live ledgers since Nov 2. Older October trades and manual trades the board placed by hand are not in these ledgers.",
               trades=real, heatmap=hm)
    json.dump(res, open(OUT, "w"), indent=1)
    print(f"{len(real)} real trades, {len(hm['rows'])} strategies x {len(hm['months'])} months, prices: {src}")


if __name__ == "__main__":
    main()
