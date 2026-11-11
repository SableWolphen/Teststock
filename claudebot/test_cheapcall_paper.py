#!/usr/bin/env python3
"""Cheap dip-call paper desk: contract choice and the buy -> sell bookkeeping, with made-up quotes
(no network). It must never pick a contract over the $50 cap and must only ever write paper records."""
import importlib.util, os
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sp = importlib.util.spec_from_file_location("cheapcall_paper", os.path.join(HERE, "cheapcall_paper.py"))
m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)
today = date(2026, 11, 11)


def occ(sym, exp, k):
    return f"{sym}{exp.strftime('%y%m%d')}C{int(round(k * 1000)):08d}"


e45, e30 = today + timedelta(days=44), today + timedelta(days=30)
QUOTES = {occ("XLF", e45, 52.5): (0.95, 0.93), occ("XLF", e45, 54.0): (0.48, 0.46), occ("XLF", e45, 55.0): (0.30, 0.28),
          occ("XLF", e30, 53.0): (0.45, 0.43)}
calls = []


def fake_get(url):
    calls.append(url)
    if "snapshots?symbols=" in url:                       # exit quote for one contract
        s = url.split("symbols=")[1].split("&")[0]
        return {"snapshots": {s: {"latestQuote": {"ap": EXIT[0], "bp": EXIT[1]}}}}
    lo = url.split("expiration_date_gte=")[1][:10]; hi = url.split("expiration_date_lte=")[1][:10]
    return {"snapshots": {k: {"latestQuote": {"ap": a, "bp": b}} for k, (a, b) in QUOTES.items()
                          if lo <= "20" + k[3:5] + "-" + k[5:7] + "-" + k[7:9] <= hi}}


m.dp.get = fake_get
# the 45-day expiry has an affordable call: take its closest-to-the-price strike that fits ($0.48, not $0.95)
p = m.pick("XLF", 52.2, today)
assert p["strike"] == 54.0 and p["ask"] == 0.48 and p["dteTarget"] == 45 and p["otmPct"] == 3.4, p
assert p["ask"] * 100 + m.dp.FEE <= m.CAP
# nothing affordable near 45 days -> falls back to the 30-day expiry
QUOTES_SAVE = dict(QUOTES); QUOTES.pop(occ("XLF", e45, 54.0)); QUOTES.pop(occ("XLF", e45, 55.0))
p30 = m.pick("XLF", 52.2, today); assert p30["strike"] == 53.0 and p30["dteTarget"] == 30, p30
QUOTES.clear(); assert m.pick("XLF", 52.2, today) is None
QUOTES.update(QUOTES_SAVE)

# bookkeeping: a Dip signal buys on paper, the bounce sells at the bid
days = [(date(2025, 12, 1) + timedelta(days=i)).isoformat() for i in range(260)]
closes = [40 + i * 0.05 for i in range(257)] + [52.4, 51.6, 51.0]          # uptrend, then a sharp 3-day drop
bars = {"XLF": list(zip(days, closes))}
assert closes[-1] > sum(closes[-200:]) / 200 and m.dp.rsi2(closes[-31:]) < 5, "test setup: must be a Dip signal"
led = m.step(m.new_ledger(), bars, today)
pos = led["strategies"]["cheapcall"]["open"]["XLF"]
assert pos["ask"] * 100 + m.dp.FEE <= m.CAP and led["mode"] == "paper" and "bought" in led["runs"][-1]["detail"]
EXIT = (0.66, 0.64)
nxt = (date.fromisoformat(days[-1]) + timedelta(days=1)).isoformat()
bars2 = {"XLF": bars["XLF"] + [(nxt, 53.5)]}                               # back above its 5-day average
led = m.step(led, bars2, today)
t = led["strategies"]["cheapcall"]["trades"][0]
assert t["why"] == "bounce" and t["exitBid"] == 0.64 and t["pnlUsd"] == round((0.64 - pos["ask"]) * 100 - 0.10, 2), t
assert led["strategies"]["cheapcall"]["open"] == {} and led["leaderboard"][0]["trades"] == 1
# same day again: nothing is double counted
assert len(m.step(led, bars2, today)["strategies"]["cheapcall"]["trades"]) == 1
print("ok")
