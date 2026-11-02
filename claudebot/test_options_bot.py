"""Scenario tests for the options planner. Run: python claudebot/test_options_bot.py"""
import importlib.util, os, copy
spec = importlib.util.spec_from_file_location("ob", os.path.join(os.path.dirname(__file__), "options_bot.py"))
ob = importlib.util.module_from_spec(spec); spec.loader.exec_module(ob)
cfg = ob.load(ob.CONFIG); cfg["underlyings"] = ["SPY", "IWM"]; BLACKOUT = cfg["risk"].pop("noNewEntryDates")
LED = {"mode": "live", "startingAccountUsd": None, "open": None, "trades": [], "snapshots": [], "runs": []}
NOW = "2026-11-02T16:14:00Z"  # 10:14 CT Monday
EXPS = ["2026-11-04", "2026-11-06", "2026-11-09", "2026-11-13", "2026-11-18", "2026-11-20", "2026-11-27"]
up = [700 + i for i in range(21)]
U = {"SPY": {"price": 758.3, "closes": [740 + i for i in range(21)], "expirations": EXPS},
     "IWM": {"price": 280.7, "closes": [270 + i * 0.4 for i in range(21)], "expirations": EXPS}}
def q(sym, id_, k, bid, ask, d): return {"symbol": sym, "id": id_, "strike": k, "expiration": "2026-11-18", "bid": bid, "ask": ask, "delta": d}
IWM = [q("IWM", "c", 271, 1.84, 1.88, -0.22), q("IWM", "d", 270, 1.66, 1.70, -0.20), q("IWM", "e", 269, 1.50, 1.54, -0.18)]
SPY_BAD = [q("SPY", "s1", 730, 2.1, 2.3, -0.21), q("SPY", "s2", 729, 1.9, 2.1, -0.20)]  # quotes too wide
F = {"now": NOW, "marketOpen": True, "accountValue": 117.27, "buyingPower": 112.97, "underlyings": U, "candidates": []}
def act(f=F, l=LED): return ob.plan(copy.deepcopy(f), cfg, copy.deepcopy(l))["actions"]

a = act(); assert a[0]["do"] == "need_contracts" and a[0]["symbol"] == "SPY" and a[0]["expiration"] == "2026-11-18" and len(a[0]["strikes"]) == 7, a
a = act({**F, "candidates": SPY_BAD}); assert a[0]["do"] == "need_contracts" and a[0]["symbol"] == "IWM", a
a = act({**F, "candidates": SPY_BAD + IWM}); assert a[0]["do"] == "open_spread" and a[0]["underlying"] == "IWM" and a[0]["shortStrike"] == 271, a
assert a[0]["credit"] == 0.16 and a[0]["maxLossUsd"] == 84.0 and a[0]["limitPrice"] == 0.18 and a[0]["minAcceptableCredit"] == 0.17, a
hi = [q("IWM", "x", 269, 1.5, 1.54, -0.18), q("IWM", "y", 268, 1.35, 1.39, -0.16)]
a = act({**F, "candidates": SPY_BAD + hi}); assert "credit 0.13" in a[0]["reason"], a
only_high_delta_ok = [q("IWM", "x", 266, 1.0, 1.04, -0.12)]
a = act({**F, "candidates": SPY_BAD + only_high_delta_ok}); assert a[0]["do"] == "need_contracts" and a[0]["strikes"] == [269, 268, 267], a
assert act({**F, "marketOpen": False})[0]["reason"] == "market closed"
a = act({**F, "underlyings": {k: {**v, "price": 100} for k, v in U.items()}}); assert "below 20-day" in a[0]["reason"], a
assert "window" in act({**F, "now": "2026-11-02T20:14:00Z"})[0]["reason"]
assert "too big" in act({**F, "candidates": SPY_BAD + IWM, "accountValue": 100, "buyingPower": 100})[0]["reason"]
assert "floor" in act({**F, "accountValue": 55})[0]["reason"]

pos = dict(underlying="IWM", expiration="2026-11-18", width=1, shortStrike=271, longStrike=270, shortId="c", longId="d",
           credit=0.16, maxLossUsd=84, shortDelta=-0.22, underlyingPrice=280.7, label="IWM 11-18 271/270P", enteredAt="2026-10-30T16:14:00Z")
L2 = {**LED, "open": pos}
assert act(F, L2)[0]["do"] == "need_leg_quotes"
legs = lambda sb, sa, lb, la: {"c": {"bid": sb, "ask": sa}, "d": {"bid": lb, "ask": la}}
LEGS_OK = legs(1.6, 1.64, 1.47, 1.51)
TP = {"id": "tp1", "price": 0.06}
a = act({**F, "legs": LEGS_OK, "spreadOnBroker": True}, L2); assert a[0]["do"] == "place_tp" and a[0]["limitPrice"] == 0.06, a
assert act({**F, "legs": LEGS_OK, "spreadOnBroker": True, "tpOrder": TP}, L2)[0]["do"] == "none"
a = act({**F, "legs": legs(0.58, 0.60, 0.55, 0.57), "spreadOnBroker": True}, L2); assert a[0]["do"] == "close_spread" and a[0]["reason"] == "take profit", a
L_today = {**LED, "open": {**pos, "enteredAt": NOW}}
a = act({**F, "legs": legs(0.58, 0.60, 0.55, 0.57), "spreadOnBroker": True}, L_today); assert a[0]["do"] == "none" and "same-day" in a[0]["reason"], a
assert act({**F, "legs": LEGS_OK, "spreadOnBroker": True}, L_today)[0]["do"] == "none"  # no TP order on entry day
a = act({**F, "legs": legs(4.1, 4.2, 3.7, 3.8), "spreadOnBroker": True, "tpOrder": TP}, L2); assert [x["do"] for x in a] == ["cancel_order", "close_spread"] and a[1]["reason"] == "stop", a
a = act({**F, "legs": legs(4.1, 4.2, 3.7, 3.8), "spreadOnBroker": True}, L_today); assert a[0]["reason"] == "stop", a  # risk exits allowed same day
U2 = {**U, "IWM": {**U["IWM"], "price": 270.5}}
a = act({**F, "underlyings": U2, "legs": legs(1.9, 1.95, 1.7, 1.75), "spreadOnBroker": True, "tpOrder": TP}, L2); assert a[-1]["reason"] == "short strike breached", a
a = act({**F, "now": "2026-11-17T19:14:00Z", "legs": legs(0.4, 0.43, 0.3, 0.33), "spreadOnBroker": True, "tpOrder": TP}, L2); assert a[-1]["reason"] == "close before expiry", a
assert act({**F, "legs": LEGS_OK, "spreadOnBroker": False}, L2)[0]["do"] == "record_broker_close"
LP2 = {**L2, "mode": "paper", "startingAccountUsd": 113}
a = act({**F, "legs": legs(0.58, 0.60, 0.55, 0.57)}, LP2); assert a[0]["do"] == "close_spread", a  # paper: TP by quotes
L3 = {**LED, "trades": [{"pnlUsd": -30, "exitedAt": "2026-11-01T20:00:00Z"}]}
assert "cooling" in act(l=L3)[0]["reason"]
LP = {**LED, "mode": "paper", "startingAccountUsd": 113}
assert act({**F, "candidates": SPY_BAD + IWM, "accountValue": 1}, LP)[0]["do"] == "open_spread"
cfg["risk"]["noNewEntryDates"] = BLACKOUT
assert "midterm" in act()[0]["reason"]
assert act({**F, "legs": legs(4.1, 4.2, 3.7, 3.8), "spreadOnBroker": True}, L2)[0]["do"] == "close_spread"  # exits still work on blackout days
print("all options scenarios pass")
