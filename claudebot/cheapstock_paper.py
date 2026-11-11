#!/usr/bin/env python3
"""Cheap-STOCK call PAPER desk (board, 2026-11-11: "options on cheap stocks as well, not just the big
ones"). On real historical option prices (claudebot-cheapstock-calls-research.json) one version of the
idea made money in both the 2024 and the unseen 2025-26 period, also with a wide buy/sell gap: the
Dip signal on a stock priced $25 or less, buying the call that sits WITHIN 3% OF THE PRICE and costs
$50 or less, about 30 days out, sold by the stock rule. That evidence is thin (53 trades, nine names,
five trades made two-thirds of the profit), so it is tested here at live quotes before anything else.

Runs after each close in GitHub (free). NEVER places an order. One pretend contract per signal:
  entry  Dip signal at today's close (RSI(2) < 5 above the 200-day average) on any name in the bot's
         options scan list priced $25 or less -> the expiry nearest 30 days; the call closest to the
         price, within 3% of it, costing <= $50 at the ASK with fees. No such call: no trade.
  exit   the stock closes above its 5-day average, after 10 trading days, or 5% below entry -> sell at the BID
Known gap: earnings dates are not available here, so a position can sit through a report.
Writes docs/data/claudebot-cheapstock-paper.json. Real money would need the board's standing bar
(30+ paper trades over 20+ sessions, profit factor >= 1.3, a profit with doubled costs) and the governor.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-cheapstock-paper.json")
sp = importlib.util.spec_from_file_location("cheapcall_paper", os.path.join(HERE, "cheapcall_paper.py"))
cc = importlib.util.module_from_spec(sp); sp.loader.exec_module(cc)
dp = cc.dp
CAP, MAX_PX, NEAR = 50.0, 25.0, 0.03
NAME = "Cheap stock calls (stock $25 or less, call within 3% of the price for $50 or less, sold on the bounce)"


def pick(sym, px, today, cap=CAP):
    best, tok = None, None
    for _ in range(4):
        url = (f"https://data.alpaca.markets/v1beta1/options/snapshots/{sym}?feed=indicative&type=call&limit=1000"
               f"&expiration_date_gte={today + timedelta(days=24)}&expiration_date_lte={today + timedelta(days=37)}"
               f"&strike_price_gte={px * (1 - NEAR):.2f}&strike_price_lte={px * (1 + NEAR):.2f}" + (f"&page_token={tok}" if tok else ""))
        d = dp.get(url)
        for occ, sn in (d.get("snapshots") or {}).items():
            q = sn.get("latestQuote") or {}; a, b = float(q.get("ap") or 0), float(q.get("bp") or 0)
            mo = dp.OCC.match(occ)
            if not mo or a <= 0 or b <= 0 or a * 100 + dp.FEE > cap:
                continue
            k = int(mo.group(4)) / 1000; exp = datetime.strptime(mo.group(2), "%y%m%d").date()
            if abs(k / px - 1) > NEAR:
                continue
            key = (abs((exp - today).days - 30), abs(k - px), k)
            if best is None or key < best[0]:
                best = (key, {"symbol": occ, "strike": k, "expiration": exp.isoformat(), "ask": a, "bid": b,
                              "otmPct": round(100 * (k / px - 1), 1), "spreadPct": round(100 * (a - b) / ((a + b) / 2), 1)})
        tok = d.get("next_page_token")
        if not tok:
            break
    return best[1] if best else None


def board(row, st):
    t, o = st["trades"], list(st["open"].values())
    hi = lambda x: x.get("etfPx", 0) >= 10
    return [row("cheapstock", st["name"], t, len(o)),
            row("cheapstock_10to25", "of which stocks priced $10 to $25", [x for x in t if hi(x)], sum(1 for x in o if hi(x))),
            row("cheapstock_under10", "of which stocks under $10", [x for x in t if not hi(x)], sum(1 for x in o if not hi(x)))]


def new_ledger():
    return {"schemaVersion": 1, "mode": "paper", "lastDay": None,
            "note": "PAPER ONLY. Dip signal on stocks priced $25 or less; the call within 3% of the price costing $50 or less; sold by the stock rule. Earnings dates are not skipped.",
            "strategies": {"cheapstock": {"name": NAME, "open": {}, "trades": []}}, "runs": []}


def step(led, bars, today, universe):
    return cc.step(led, bars, today, key="cheapstock", syms=universe, picker=pick, max_px=MAX_PX, board=board)


def main():
    dp.H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    sp2 = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); ob = importlib.util.module_from_spec(sp2); sp2.loader.exec_module(ob)
    universe = json.load(open(os.path.join(HERE, "optbuy_config.json")))["scanUniverse"]
    try:
        led = json.load(open(OUT))
    except Exception:  # noqa: BLE001
        led = new_ledger()
    today = datetime.now(timezone.utc).date(); bars = {}
    for s in universe:
        try:
            bars[s] = ob.daily_bars(s, (today - timedelta(days=600)).isoformat())[0]
        except Exception as e:  # noqa: BLE001
            print("no bars", s, str(e)[:60], file=sys.stderr)
    led = step(led, bars, today, universe)
    json.dump(led, open(OUT, "w"), indent=1)
    print(led["runs"][-1]["detail"])


if __name__ == "__main__":
    main()
