#!/usr/bin/env python3
"""The exit outlook must say what the live Dip planner actually does. Each case computes the outlook's
sell level / stop / time limit, then asks dip_bot.plan at that exact price and one cent the other side."""
import importlib.util, json, os
from datetime import date, datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))


def mod(name):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m); return m


db, ol = mod("dip_bot"), mod("outlook")
cfg = json.load(open(os.path.join(HERE, "dip_config.json")))
CT = ZoneInfo("America/Chicago")
# 260 closes rising slowly (so everything is above its 200-day average), then a custom tail
BASE = [400 + i * 0.1 for i in range(250)]


def sells(pos, closes, price, now="2026-11-11T16:00:00Z"):
    facts = {"now": now, "marketOpen": True, "accountValue": 117.0, "buyingPower": 0.5,
             "symbols": {pos["symbol"]: {"price": price, "closes": closes, "heldQty": 1.0}}}
    a = db.plan(facts, cfg, {"positions": [pos], "trades": [], "runs": []})["actions"][0]
    return (a.get("reason") if a["do"] == "sell" else None)


S = date(2026, 11, 11)   # a Wednesday; 16:00Z = 10:00 CT, inside the sell window

# Double 7s: sells AT the highest of the previous 6 closes, not one cent below
tail = [430, 431, 445, 428, 427, 436, 435]
closes = BASE + tail
pos = {"symbol": "DIA", "entryPrice": 428.0, "usd": 100.0, "rule": "double7", "enteredAt": "2026-11-06T15:41:44Z"}
o = ol.exit_outlook(pos, closes, 435.0, cfg, S)
assert o["sellAt"] == {"price": 445.0, "orHigher": True, "why": "a 7-day high"}, o
assert sells(pos, closes, 445.0) == "7-day high" and sells(pos, closes, 444.99) is None
assert o["stopPrice"] in (406.59, 406.6)          # whichever whole cent the planner really stops at
assert sells(pos, closes, o["stopPrice"]) == "stop" and sells(pos, closes, round(o["stopPrice"] + 0.01, 2)) is None
# the 445 close is 5th from the end, so it leaves the 6-close window after 2 more sessions
assert o["later"] == {"session": "2026-11-13", "price": 436.0}, o["later"]
c2 = closes + [435.0, 435.0]                       # two flat sessions later
assert ol.exit_outlook(pos, c2, 435.0, cfg, date(2026, 11, 13))["sellAt"]["price"] == 436.0
assert sells(pos, c2, 436.0, "2026-11-13T16:00:00Z") == "7-day high"
# time limit: 10 trading days after Fri Nov 6 is Fri Nov 20
assert o["timeLimit"] == "2026-11-20", o["timeLimit"]
flat = BASE + [445] * 8                             # sell level stays out of reach, so only time can fire
assert sells(pos, flat, 430.0, "2026-11-20T16:00:00Z") == "time" and sells(pos, flat, 430.0, "2026-11-19T16:00:00Z") is None
assert "$445.00 or higher" in o["text"] and "Nov 20" in o["text"] and "Nov 13" in o["text"]

# 3 down days: sells on any price above the previous close
pos3 = dict(pos, rule="down3")
o3 = ol.exit_outlook(pos3, closes, 434.0, cfg, S)
assert o3["sellAt"]["price"] == 435.0 and o3["sellAt"]["orHigher"] is False
assert sells(pos3, closes, 435.01) == "up close" and sells(pos3, closes, 435.0) is None

# Dip rule: sells above the average of the previous 4 closes (same as price > its own 5-day average)
dtail = [440, 436, 432, 428]
dc = BASE + dtail
posd = dict(pos, rule="dip", entryPrice=430.0)
od = ol.exit_outlook(posd, dc, 430.0, cfg, S)
lvl = od["sellAt"]["price"]
assert lvl == 434.0 and od["sellAt"]["orHigher"] is False
assert db.rsi2(dc + [round(lvl - 0.01, 2)]) <= cfg["exit"]["rsi2Above"], "test setup: RSI exit must not fire here"
assert sells(posd, dc, round(lvl + 0.01, 2)) == "bounce" and sells(posd, dc, lvl) is None

# reached / bought-today wording
assert "sells at the next check" in ol.exit_outlook(pos, closes, 446.0, cfg, S)["text"]
assert ol.exit_outlook(dict(pos, enteredAt="2026-11-11T15:00:00Z"), closes, 435.0, cfg, S)["boughtThisSession"] is True
assert sells(dict(pos, enteredAt="2026-11-11T15:00:00Z"), closes, 446.0) is None   # planner: no exits on the buy day

# which session the outlook is for
H = {"2026-11-26"}
assert ol.session_date(datetime(2026, 11, 11, 7, 0, tzinfo=CT), H) == date(2026, 11, 11)
assert ol.session_date(datetime(2026, 11, 11, 15, 5, tzinfo=CT), H) == date(2026, 11, 12)
assert ol.session_date(datetime(2026, 11, 13, 16, 0, tzinfo=CT), H) == date(2026, 11, 16)   # Friday evening -> Monday
assert ol.session_date(datetime(2026, 11, 25, 16, 0, tzinfo=CT), H) == date(2026, 11, 27)   # skips Thanksgiving
print("ok")
