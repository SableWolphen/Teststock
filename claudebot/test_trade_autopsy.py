#!/usr/bin/env python3
"""Offline tests for the trade autopsy (no network): the pieces add up to the booked P&L, race
variants on the same entry count once, puts gain when the stock falls, and live records work."""
import importlib.util, os

HERE = os.path.dirname(os.path.abspath(__file__))
sp = importlib.util.spec_from_file_location("trade_autopsy", os.path.join(HERE, "trade_autopsy.py"))
m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)

T0, T1 = "2026-11-03T16:59:00Z", "2026-11-03T17:30:00Z"
call = {"symbol": "SNAP261120C00006000", "underlying": "SNAP", "type": "call", "ask": 0.37, "bid": 0.35, "delta": 0.4,
        "forecastUsd": 1.0, "day": "2026-11-03", "boughtAt": T0, "exitAt": T1, "peakBid": 0.40, "exitBid": 0.31,
        "why": "stop", "pnlUsd": -6.1}
call_b = {**call, "exitBid": 0.39, "peakBid": 0.40, "pnlUsd": 1.9, "why": "target"}        # same entry, other exit rule
put = {"symbol": "F261113P00012000", "type": "put", "ask": 0.22, "bid": 0.20, "delta": -0.5, "day": "2026-11-03",
       "boughtAt": T0, "exitAt": T1, "peakBid": 0.30, "exitBid": 0.30, "why": "target", "pnlUsd": 7.9}
race = {"strategies": {"a": {"trades": [call]}, "b": {"trades": [call_b, put]}}}
live = {"trades": [{"label": "XYZ 12-18 10C", "symbol": "XYZ", "enteredAt": "2026-11-11T19:00:00Z", "exitedAt": "2026-11-13T19:00:00Z",
                    "entryPrice": 0.75, "exitPrice": 0.60, "pnlUsd": -15.06, "reason": "5% stock stop", "rule": "cheapStock"}]}
docs = {"claudebot-optscalp-paper.json": race, "claudebot-optbuy-ledger.json": live}

PX = {("SNAP", T0): 6.00, ("SNAP", T1): 5.90, ("F", T0): 12.00, ("F", T1): 11.80}
calls = []


def get(url):
    calls.append(url)
    sym = url.split("symbols=")[1].split("&")[0]
    end = url.split("end=")[1].split("&")[0]
    at = m.ts(end) - m.timedelta(minutes=1)
    px = PX[(sym, at.strftime("%Y-%m-%dT%H:%M:%SZ"))]
    return {"bars": {sym: [{"t": at.strftime("%Y-%m-%dT%H:%M:%SZ"), "c": px}]}}


entries, cache, _ = m.build(docs, None, get)
race_e = [e for e in entries if e["desk"] == "Options race"]
assert len(race_e) == 2, "two independent entries (the two call variants are one entry)"
snap = next(e for e in race_e if e["underlying"] == "SNAP")
assert len(snap["variants"]) == 2 and snap["exitRuleRangeUsd"] == [-6.1, 1.9]
for e in entries:
    for v in e["variants"]:
        parts = [v[k] for k in ("spread", "fees", "signal", "timeDecay", "priceMove") if v.get(k) is not None]
        assert abs(sum(parts) - v["pnl"]) < 0.02, (e["symbol"], v)          # pieces add up to the booked P&L
v = next(x for x in snap["variants"] if x["variant"] == "a")
assert v["spread"] == -2.0 and abs(v["signal"] - (0.4 * -0.10 * 100)) < 0.01 and v["exitTiming"] == -9.0
assert v["mainCause"] in ("signal", "timeDecay", "spread") and v["forecastErrorUsd"] == -7.1
fp = next(e for e in race_e if e["underlying"] == "F")["variants"][0]
assert fp["signal"] > 0, "a put gains when the stock falls"
lv = next(e for e in entries if e["desk"] == "Options-buying desk")["variants"][0]
assert lv["spread"] is None and lv["priceMove"] == -15.0 and abs(lv["fees"] + 0.06) < 0.01   # no bid recorded: combined

# cached stock prices: a second build needs no network
n = len(calls)
m.build(docs, cache, None)
assert len(calls) == n
e2, _, _ = m.build(docs, cache, None)
assert next(e for e in e2 if e["underlying"] == "SNAP")["variants"][0]["signal"] is not None

s = m.summarise(entries)
r = s["Options race"]
assert r["independentTrades"] == 2 and r["variantTrades"] == 3 and r["exitRuleBestUsd"] == 9.8
assert r["componentsKnownFor"]["signal"] == 2 and r["totalsUsd"]["priceMove"] is None
assert s["Options-buying desk"]["mode"] == "live"
# no quantities, balances or order ids leak into the output
txt = repr(entries)
assert "quantity" not in txt and "orderId" not in txt and "buyingPower" not in txt
# empty / missing desks are fine
assert m.build({}, None, None)[0] == [] and m.summarise([]) == {}
print("trade autopsy tests passed")
