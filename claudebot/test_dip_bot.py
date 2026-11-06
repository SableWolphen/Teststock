"""Dip desk scenarios. Run: python claudebot/test_dip_bot.py"""
import importlib.util, os, copy
spec = importlib.util.spec_from_file_location("db", os.path.join(os.path.dirname(os.path.abspath(__file__)), "dip_bot.py"))
db = importlib.util.module_from_spec(spec); spec.loader.exec_module(db)
cfg = db.load(db.CONFIG); cfg["symbols"] = ["SPY", "QQQ"]; cfg["risk"]["reserveForOptionsUsd"] = 86; cfg["risk"]["maxOpenPositions"] = 3; cfg["risk"]["deployAllCash"] = False   # scenarios below test the fixed-size, reserve and 3-position rules
up = [600 + i * 0.6 for i in range(220)]                 # steady uptrend, last close ~731
dip = up[:-3] + [up[-3] - 6, up[-3] - 13, up[-3] - 20]  # three down days, still above the 200d SMA
LED = {"open": None, "trades": [], "runs": []}
NOW_W = "2026-11-04T20:14:00Z"   # 14:14 CT
F = {"now": NOW_W, "marketOpen": True, "accountValue": 117, "buyingPower": 112, "symbols": {"SPY": {"price": dip[-1] - 2, "closes": dip, "heldQty": 0}, "QQQ": {"price": up[-1] + 1, "closes": up, "heldQty": 0}}}
def act(f=F, l=LED): return db.plan(copy.deepcopy(f), cfg, copy.deepcopy(l))["actions"][0]
a = act(); assert a["do"] == "buy" and a["symbol"] == "SPY" and a["dollarAmount"] == "25.00", a
assert act({**F, "now": "2026-11-04T16:14:00Z"})["do"] == "buy"                           # all-day buys (board 2026-11-06)
assert act({**F, "now": "2026-11-04T14:35:00Z"})["do"] == "none"                          # 8:35 CT: before the buy window
assert act({**F, "buyingPower": 20})["do"] == "none"
assert act({**F, "marketOpen": False})["reason"] == "market closed"
down = [900 - i for i in range(220)]
assert act({**F, "symbols": {"SPY": {"price": down[-1] - 5, "closes": down, "heldQty": 0}, "QQQ": F["symbols"]["QQQ"]}})["do"] == "none"   # below 200d: no buy
pos = {"symbol": "SPY", "entryPrice": 700.0, "usd": 25.0, "enteredAt": "2026-11-03T20:14:00Z"}
L2 = {**LED, "open": pos}
S = lambda px, q=0.0357: {**F, "symbols": {"SPY": {"price": px, "closes": dip, "heldQty": q}}}
a = act(S(740), L2); assert a["do"] == "sell" and a["reason"] == "bounce" and a["quantity"] == "0.035700", a
a = act({**S(660), "now": "2026-11-04T16:14:00Z"}, L2); assert a["do"] == "sell" and a["reason"] == "stop", a
assert act({**S(690), "now": "2026-11-04T16:14:00Z"}, L2)["do"] != "sell"                 # 10:14 CT, below the 5-day average: hold
a = act({**S(740), "now": "2026-11-04T16:14:00Z"}, L2); assert a["do"] == "sell" and a["reason"] == "bounce", a   # hourly bounce sells (board 2026-11-06)
assert act(S(660), {**LED, "open": {**pos, "enteredAt": "2026-11-04T20:10:00Z"}})["do"] != "sell"   # no same-day exits
assert act(S(700, 0), L2)["do"] == "record_broker_close"
a = act({**S(705), "now": "2026-11-18T20:14:00Z"}, {**LED, "open": {**pos, "entryPrice": 720.0}}); assert a["do"] == "sell" and a["reason"] in ("time", "bounce"), a
assert float(act(S(740, 1.5), L2)["quantity"]) <= 25 / 700 + 1e-6                        # never sells more than it bought
# multiple positions (board 2026-11-02): one per ETF, up to the cap, options cash reserve kept
db.options_open = lambda: False
Q = {**F, "symbols": {"SPY": {**F["symbols"]["SPY"], "heldQty": 0.0357}, "QQQ": {"price": dip[-1] - 2, "closes": dip, "heldQty": 0}}}
a = act(Q, {**LED, "positions": [{**pos, "enteredAt": "2026-11-04T20:10:00Z"}]}); assert a["do"] == "buy" and a["symbol"] == "QQQ", a   # skips held SPY
assert "holding SPY" in act({**Q, "buyingPower": 100}, {**LED, "positions": [{**pos, "enteredAt": "2026-11-04T20:10:00Z"}]})["reason"]   # 100-25 < 86 reserve
db.options_open = lambda: True
assert act({**Q, "buyingPower": 40}, {**LED, "positions": [{**pos, "enteredAt": "2026-11-04T20:10:00Z"}]})["do"] == "buy"   # spread already open: no reserve
full = [{**pos, "symbol": s_, "enteredAt": "2026-11-04T20:10:00Z"} for s_ in ("SPY", "QQQ", "DIA")]
Qf = {**Q, "symbols": {s_: {"price": dip[-1] - 2, "closes": dip, "heldQty": 0.0357} for s_ in ("SPY", "QQQ", "DIA")}}
assert "limit" in act(Qf, {**LED, "positions": full})["reason"]
a = act({**S(740), "symbols": {"SPY": {"price": 740, "closes": dip, "heldQty": 0.0357}}}, {**LED, "positions": [pos]}); assert a["do"] == "sell" and a["symbol"] == "SPY", a
# size grows with the account: 20% of value, never below $25, cash reserve still applies
db.options_open = lambda: True
a = act({**F, "accountValue": 500, "buyingPower": 480}); assert a["do"] == "buy" and a["dollarAmount"] == "100.00", a
a = act({**F, "accountValue": 117, "buyingPower": 112}); assert a["dollarAmount"] == "25.00", a
db.options_open = lambda: False
assert act({**F, "accountValue": 500, "buyingPower": 150})["do"] == "none"     # 150-100 < 86 reserve
# board order: deploy all free cash across today's signals
cfg["risk"]["deployAllCash"] = True; cfg["risk"]["reserveForOptionsUsd"] = 0; db.options_open = lambda: True
a = act(); assert a["do"] == "buy" and a["symbol"] == "SPY" and a["dollarAmount"] == "25.00", a                  # one signal: all cash minus $1
both = {**F, "symbols": {"SPY": F["symbols"]["SPY"], "QQQ": {"price": dip[-1] - 2, "closes": dip, "heldQty": 0}}}
a = act(both); assert a["dollarAmount"] == "25.00" and a["symbol"] == "SPY", a                                       # two signals: split
assert act({**F, "buyingPower": 1.5})["do"] == "none"                                                               # nothing left to spend
lost = {**LED, "trades": [{"pnlUsd": -1.0}] * 3}
a = act(F, lost); assert a["dollarAmount"] == "25.00" and "loss brake" in a["why"], a                                # 3 losses in a row: small size
# all-cash policy cannot override the hard 20-25% position ceiling
assert float(act(F)["dollarAmount"]) <= 25.0
assert act({**F, "buyingPower": 24})["do"] == "none"
assert act({**F, "buyingPower": 0})["do"] == "none"
assert act({**F, "accountValue": 500, "buyingPower": 480})["dollarAmount"] == "100.00"
assert act({**F, "accountValue": 0, "buyingPower": 100})["do"] == "none"
assert act({**F, "accountValue": 117, "buyingPower": float("nan")})["do"] == "none"
# news veto: a skipped symbol is never bought this run
db.options_open = lambda: True
a = act({**F, "skip": ["SPY"]}); assert a["do"] != "buy" or a["symbol"] != "SPY", a
print("all dip desk scenarios pass")
