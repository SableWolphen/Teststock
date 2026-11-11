#!/usr/bin/env python3
"""Cheap-stock call paper desk: it only takes a call within 3% of the price for $50 or less, only on
stocks priced $25 or less, and only ever writes paper records. Made-up quotes, no network."""
import importlib.util, os
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sp = importlib.util.spec_from_file_location("cheapstock_paper", os.path.join(HERE, "cheapstock_paper.py"))
m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)
today = date(2026, 11, 11); e30 = today + timedelta(days=30)
occ = lambda sym, k: f"{sym}{e30.strftime('%y%m%d')}C{int(round(k * 1000)):08d}"
QUOTES = {occ("F", 12.0): (0.48, 0.45), occ("F", 12.5): (0.27, 0.25), occ("F", 11.5): (0.80, 0.77), occ("F", 14.0): (0.05, 0.04)}
EXIT = (0.70, 0.66)


def fake_get(url):
    if "snapshots?symbols=" in url:
        s = url.split("symbols=")[1].split("&")[0]
        return {"snapshots": {s: {"latestQuote": {"ap": EXIT[0], "bp": EXIT[1]}}}}
    return {"snapshots": {k: {"latestQuote": {"ap": a, "bp": b}} for k, (a, b) in QUOTES.items() if k.startswith(url.split("/snapshots/")[1].split("?")[0])}}


m.dp.get = fake_get
p = m.pick("F", 12.1, today)
assert p["strike"] == 12.0 and p["ask"] == 0.48 and abs(p["otmPct"]) <= 3 and p["spreadPct"] > 0, p     # $12.50 is 3.3% away: not taken
QUOTES2 = dict(QUOTES); QUOTES.pop(occ("F", 12.0))
assert m.pick("F", 12.1, today) is None            # only the too-far and too-expensive calls are left: no trade
QUOTES.update(QUOTES2)

days = [(date(2025, 12, 1) + timedelta(days=i)).isoformat() for i in range(260)]
dip = lambda top: [top * (0.8 + 0.2 * i / 256) for i in range(257)] + [top * 1.0, top * 0.985, top * 0.972]
bars = {"F": list(zip(days, dip(12.45))), "AMD": list(zip(days, dip(160.0)))}      # both dip; AMD is far above $25
for sym in bars:
    c = [x for _, x in bars[sym]]; assert c[-1] > sum(c[-200:]) / 200 and m.dp.rsi2(c[-31:]) < 5, "test setup: Dip signal"
QUOTES[occ("AMD", 155.0)] = (0.40, 0.38)
led = m.step(m.new_ledger(), bars, today, ["F", "AMD"])
st = led["strategies"]["cheapstock"]
assert list(st["open"]) == ["F"] and led["mode"] == "paper", st["open"]            # AMD skipped: not a cheap stock
pos = st["open"]["F"]; assert pos["ask"] * 100 + m.dp.FEE <= m.CAP
nxt = (date.fromisoformat(days[-1]) + timedelta(days=1)).isoformat()
led = m.step(led, {"F": bars["F"] + [(nxt, 12.6)]}, today, ["F", "AMD"])
t = led["strategies"]["cheapstock"]["trades"][0]
assert t["why"] == "bounce" and t["pnlUsd"] == round((0.66 - pos["ask"]) * 100 - 0.10, 2)
ids = [r["id"] for r in led["leaderboard"]]; assert ids == ["cheapstock", "cheapstock_10to25", "cheapstock_under10"]
assert led["leaderboard"][1]["trades"] == 1 and led["leaderboard"][2]["trades"] == 0
print("ok")
