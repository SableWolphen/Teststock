"""Options-buying desk scenarios. Run: python claudebot/test_optbuy_bot.py"""
import copy, importlib.util, os
sp = importlib.util.spec_from_file_location("ob", os.path.join(os.path.dirname(os.path.abspath(__file__)), "optbuy_bot.py"))
ob = importlib.util.module_from_spec(sp); sp.loader.exec_module(ob)
cfg = ob.load(ob.CONFIG); cfg["symbols"] = ["KRE", "XLF"]; cfg["enabled"] = True   # test the rules even while the desk is switched off
up = [60 + i * 0.06 for i in range(220)]
dip = up[:-3] + [up[-3] - 0.6, up[-3] - 1.3, up[-3] - 2.0]
LED = {"open": None, "trades": [], "runs": []}
NOW = "2026-11-04T20:14:00Z"   # 14:14 CT
F = {"now": NOW, "marketOpen": True, "accountValue": 117, "buyingPower": 112,
     "symbols": {"KRE": {"price": dip[-1] - 0.2, "closes": dip, "heldQty": 0}, "XLF": {"price": up[-1] + 0.1, "closes": up, "heldQty": 0}}}
def act(f=F, l=LED): return ob.plan(copy.deepcopy(f), cfg, copy.deepcopy(l))["actions"]
assert act()[0]["do"] == "need_expirations"
F2 = {**F, "expirations": {"KRE": ["2026-11-06", "2026-11-20", "2026-11-27", "2026-12-18"]}}
a = act(F2)[0]; assert a["do"] == "need_calls" and a["expiration"] == "2026-11-27", a      # nearest to 21 days
px = F["symbols"]["KRE"]["price"]
C = [{"symbol": "KRE", "id": "a", "strike": round(px + 0.5), "expiration": "2026-11-27", "bid": 0.52, "ask": 0.56, "delta": 0.32},   # too expensive ($54)
     {"symbol": "KRE", "id": "b", "strike": round(px + 2), "expiration": "2026-11-27", "bid": 0.25, "ask": 0.27, "delta": 0.21},    # fits
     {"symbol": "KRE", "id": "c", "strike": round(px + 3), "expiration": "2026-11-27", "bid": 0.10, "ask": 0.12, "delta": 0.11}]    # delta too low
a = act({**F2, "calls": C})[0]; assert a["do"] == "buy" and a["id"] == "b" and a["limitPrice"] == "0.26", a
assert act({**F2, "calls": C, "now": "2026-11-04T17:14:00Z"})[0]["do"] == "none"             # outside window
assert act({**F2, "calls": C[:1]})[0]["do"] == "none"                                        # nothing affordable
assert act({**F, "accountValue": 50})[0]["do"] == "none"
# holding
pos = {"symbol": "KRE", "id": "b", "strike": 74, "expiration": "2026-11-27", "label": "KRE 11-27 74C", "delta": 0.21, "entryPrice": 0.26, "enteredAt": "2026-11-03T20:14:00Z"}
L = {**LED, "open": pos}
H = {**F, "optHeld": 1, "optQuote": {"bid": 0.25, "ask": 0.27}, "tpOrder": None}
a = act(H, L)[0]; assert a["do"] == "place_tp" and a["limitPrice"] == "0.29" and a["timeInForce"] == "gtc", a    # 0.26 * 1.10 = 0.286 -> 0.29
assert act({**H, "tpOrder": {"id": "t", "price": 0.29}}, L)[0]["do"] == "none"
a = act({**H, "optQuote": {"bid": 0.15, "ask": 0.17}, "tpOrder": {"id": "t", "price": 0.29}}, L); assert [x["do"] for x in a] == ["cancel_order", "sell"] and a[1]["reason"] == "stop", a
a = act({**H, "optQuote": {"bid": 0.30, "ask": 0.32}, "tpOrder": {"id": "t", "price": 0.29}}, L); assert a[1]["reason"] == "take profit", a
assert act({**H, "optHeld": 0}, L)[0]["do"] == "record_broker_close"
a = act({**H, "now": "2026-11-13T16:14:00Z", "tpOrder": {"id": "t", "price": 0.29}}, L); assert a[-1]["do"] == "sell" and a[-1]["reason"] == "time", a
assert act({k: v for k, v in H.items() if k != "optQuote"}, L)[0]["do"] == "need_position"
assert ob.tick_up(0.286) == 0.29 and ob.tick_up(3.11) == 3.15
# wider universe from the nightly scan
SC = {"generatedAt": "2026-11-04T02:00:00Z", "asOf": "2026-11-03", "watch": ["SOFI", "XLE"],
      "symbols": {"SOFI": {"lastClose": 20.0, "trendFloor": 17.0, "rsiTrigger": 19.0}, "XLE": {"lastClose": 90.0, "trendFloor": 80.0, "rsiTrigger": 85.0}}}
U = {**F, "symbols": {"KRE": {"price": up[-1], "closes": up, "heldQty": 0}, "XLF": F["symbols"]["XLF"]}, "scan": SC}
a = act(U)[0]; assert a["do"] == "need_scan_prices" and a["symbols"] == ["SOFI", "XLE"], a
a = act({**U, "scanPrices": {"SOFI": 18.5, "XLE": 88}})[0]; assert a["do"] == "need_earnings" and a["symbol"] == "SOFI", a
a = act({**U, "scanPrices": {"SOFI": 18.5, "XLE": 88}, "earnings": {"SOFI": "2026-11-10"}})[0]; assert a["do"] == "none" and "earnings" in a["reason"], a
U2 = {**U, "scanPrices": {"SOFI": 18.5, "XLE": 88}, "earnings": {"SOFI": None}, "expirations": {"SOFI": ["2026-11-27"]}}
a = act(U2)[0]; assert a["do"] == "need_calls" and a["symbol"] == "SOFI", a
SC_ = [{"symbol": "SOFI", "id": "s1", "strike": 19, "expiration": "2026-11-27", "bid": 0.40, "ask": 0.44, "delta": 0.35}]
a = act({**U2, "calls": SC_})[0]; assert a["do"] == "buy" and a["id"] == "s1", a
a = act({**U2, "calls": [], "callsFetched": ["SOFI|2026-11-27"]})[0]; assert a["do"] == "none" and "SOFI" in a["reason"], a
a = act({**U, "scan": {**SC, "generatedAt": "2026-10-20T02:00:00Z"}})[0]; assert a["do"] == "none" and "stale" in a["reason"], a
assert act({**U, "scanPrices": {"SOFI": 19.5, "XLE": 88}})[0]["do"] == "none"     # above trigger: no signal
print("all options-buying scenarios pass")
