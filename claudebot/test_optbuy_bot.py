"""Options-buying desk scenarios (board order 2026-11-11: cheap-stock call near the price + index-fund $50 call,
exit by the stock rule). Run: python claudebot/test_optbuy_bot.py"""
import copy, importlib.util, json, os, tempfile
sp = importlib.util.spec_from_file_location("ob", os.path.join(os.path.dirname(os.path.abspath(__file__)), "optbuy_bot.py"))
ob = importlib.util.module_from_spec(sp); sp.loader.exec_module(ob)
cfg = ob.load(ob.CONFIG); cfg["enabled"] = True
for _rc in cfg["rules"].values(): _rc["enabled"] = True    # scenarios exercise both rules even while one is paused in the live file
# the live file must carry exactly what the board approved
assert set(cfg["rules"]) == {"cheapStock", "index"} and all(rc["boardApproval"]["approvalId"] for rc in cfg["rules"].values())
assert cfg["rules"]["index"]["symbols"] == ["SPY", "QQQ", "IWM"] and cfg["rules"]["cheapStock"]["maxStockPrice"] == 25 and cfg["rules"]["cheapStock"]["strikeWithinPct"] == 3
assert cfg["risk"]["cashIsTheCap"] and cfg["risk"]["maxOpenPositions"] == 3 and cfg["risk"]["minCashAfterUsd"] >= 1   # board 2026-11-11: up to 3 options, free cash is the only size limit
cfg25 = copy.deepcopy(cfg); cfg25["risk"].update({"maxPremiumUsd": 25, "maxPctOfAccount": 22, "maxTotalPctOfAccount": 65, "cashIsTheCap": False})   # the earlier caps, to keep the contract-choice scenarios exact
cfg_cash = cfg; cfg = cfg25
assert cfg["exit"]["stockStopPct"] == 5 and cfg["exit"]["maxHoldDays"] == 10 and "takeProfitPct" not in cfg["exit"]

up = [60 + i * 0.06 for i in range(220)]
dip = up[:-3] + [up[-3] - 0.6, up[-3] - 1.3, up[-3] - 2.0]
LED = {"open": None, "trades": [], "runs": []}
NOW = "2026-11-04T20:44:00Z"   # 14:44 CT
NOSCAN = {"generatedAt": "2026-11-04T02:00:00Z", "asOf": "2026-11-03", "watch": [], "symbols": {}}
PX = round(dip[-1] - 0.2, 2)
F = {"now": NOW, "marketOpen": True, "accountValue": 117, "buyingPower": 112, "scan": NOSCAN,
     "symbols": {"SPY": {"price": PX, "closes": dip, "heldQty": 0}, "QQQ": {"price": up[-1] + 0.1, "closes": up, "heldQty": 0},
                 "IWM": {"price": up[-1] + 0.1, "closes": up, "heldQty": 0}}}
def act(f=F, l=LED, c=cfg): return ob.plan(copy.deepcopy(f), copy.deepcopy(c), copy.deepcopy(l))["actions"]

# ---------------------------------------------------------------- index rule (SPY, QQQ, IWM)
assert act({k: v for k, v in F.items() if k != "scan"})[0]["do"] == "need_scan"                 # the scan file must be loaded first
a = act({**F, "symbols": {}})[0]; assert a["do"] == "need_symbol" and a["symbol"] == "SPY", a
assert act()[0] == {"do": "need_expirations", "symbol": "SPY"}
F2 = {**F, "expirations": {"SPY": ["2026-11-27", "2026-12-12", "2026-12-18", "2027-01-15"]}}
a = act(F2)[0]; assert a["do"] == "need_calls" and a["expiration"] == "2026-12-18", a            # nearest to 45 days inside 38-52
assert a["strikeMin"] == PX and a["strikeMax"] == round(PX * 1.15, 2), a
K = lambda i, strike, bid, ask: {"symbol": "SPY", "id": i, "strike": strike, "expiration": "2026-12-18", "bid": bid, "ask": ask, "delta": 0.1}
C = [K("a", 72, 0.27, 0.28),    # closest, but $28: over the $25 cap
     K("d", 74, 0.22, 0.25),    # affordable, but the quote is 3 cents wide: wider than tested by enough to erase the edge
     K("b", 75, 0.20, 0.21),    # fits: a penny wide, $21
     K("c", 76, 0.15, 0.16)]    # fits too, but further from the price
a = act({**F2, "calls": C})[0]
assert a["do"] == "buy" and a["id"] == "b" and a["limitPrice"] == "0.21" and a["quantity"] == "1", a
assert a["rule"] == "index" and a["strategyId"] == "optbuy:index" and a["underlyingPx"] == PX and a["forecastUsd"] > 0 and a["holdMinutes"] == 1170, a
assert float(a["limitPrice"]) * 100 <= 25 and float(a["maxPrice"]) * 100 <= 25
assert act({**F2, "calls": C[:2]})[0]["do"] == "none"                                           # only the too-expensive and too-wide ones
assert act({**F2, "calls": C, "now": "2026-11-04T17:14:00Z"})[0]["do"] == "buy"                 # 11:14 CT: buys during the day too (board 2026-11-11)
assert act({**F2, "calls": C, "now": "2026-11-04T14:30:00Z"})[0]["do"] == "none"                # 8:30 CT: before the first run window
assert "pause floor" in act({**F, "accountValue": 50})[0]["reason"]
assert "free cash" in act({**F, "buyingPower": 4})[0]["reason"]
assert "disabled" in act(c={**cfg, "enabled": False})[0]["reason"]
assert act({**F2, "calls": C, "skip": ["SPY"]})[0]["do"] == "none"                              # news veto
# no recorded board order -> the rule cannot trade
c2 = copy.deepcopy(cfg); c2["rules"]["index"].pop("boardApproval"); c2["rules"]["cheapStock"]["enabled"] = False
assert "no option rule is live" in act({**F2, "calls": C}, c=c2)[0]["reason"]
# self switch-off: 10 closed live trades under the rule with profit factor < 1.0
losing = [{"rule": "index", "enteredAt": "2026-11-12T20:44:00Z", "pnlUsd": p} for p in [-20] * 7 + [30] * 3]
assert ob.rule_state(cfg, {"trades": losing}, "index")[0] is False and ob.rule_state(cfg, {"trades": losing[:9]}, "index")[0] is True
assert ob.rule_state(cfg, {"trades": losing}, "cheapStock")[0] is True                          # the other rule is unaffected
assert ob.rule_state(cfg, {"trades": [{**t, "enteredAt": "2026-11-01T20:00:00Z"} for t in losing]}, "index")[0] is True   # before the order: not counted
a = act({**F2, "calls": C}, {**LED, "trades": losing})[0]; assert a["do"] == "none" and "switched itself off" in a["reason"], a
# forecast: the tested return on what is paid, less any gap wider than the test assumed
ix, cs = cfg["rules"]["index"], cfg["rules"]["cheapStock"]
assert ob.forecast(ix, 0.40, 0.41) > 0 and ob.forecast(ix, 0.38, 0.41) < 0
# a quote two cents wide leaves the index rule almost no edge: the planner skips it, as the Gatekeeper would
assert act({**F2, "calls": [K("b2", 75, 0.19, 0.21)]})[0]["do"] == "none"
# after losses the 22% cap shrinks; below the $60 pause floor nothing new is bought
a = act({**F2, "calls": C, "accountValue": 95})[0]; assert a["do"] == "buy" and a["id"] == "c", a     # $95: only the $16 one fits 22%
assert act({**F2, "calls": C, "accountValue": 55})[0]["do"] == "none"                               # below the $60 pause floor: no new buys
assert ob.forecast(cs, 0.44, 0.47) > 0 and ob.forecast(cs, 0.36, 0.47) < 0

# ---------------------------------------------------------------- holding: the exit follows the stock
pos = {"symbol": "SPY", "id": "b", "strike": 75, "expiration": "2026-12-18", "label": "SPY 12-18 75C", "delta": 0.1, "rule": "index",
       "underlyingPx": PX, "entryPrice": 0.41, "enteredAt": "2026-11-03T20:44:00Z"}
L = {**LED, "open": pos}
C1 = copy.deepcopy(cfg); C1["risk"]["maxOpenPositions"] = 1      # holding scenarios: no room for another buy, so the plan is only about the held one
def hold(price, **kw):
    f = {**F, "optHeldById": {"b": 1}, "optQuotes": {"b": {"bid": 0.40, "ask": 0.42}}, "tpOrders": {}, "symbols": {"SPY": {"price": price, "closes": dip, "heldQty": 0}}}
    f.update(kw); return f
_act = act
def act(f=F, l=LED, c=None): return _act(f, l, c if c is not None else (C1 if positions_of(l) else cfg))
def positions_of(l): return l.get("positions") or ([l["open"]] if l.get("open") else [])
avg4 = sum(dip[-4:]) / 4                                                                          # above this = above its own 5-day average
assert act({k: v for k, v in hold(PX).items() if k != "optQuotes"}, L)[0]["do"] == "need_position"
assert act(hold(PX, optHeldById={"b": 0}), L)[0]["do"] == "record_broker_close"
a = act(hold(PX, symbols={}), L)[0]; assert a == {"do": "need_symbol", "symbol": "SPY"}, a        # needs the stock's price and closes
a = act(hold(avg4 + 0.3), L)[0]; assert a["do"] == "sell" and a["reason"] == "bounce" and a["limitPrice"] == "0.40" and a["quantity"] == "1", a
assert act(hold(avg4 + 0.3, now="2026-11-04T17:14:00Z"), L)[0]["reason"] == "bounce"               # a bounce at 11:14 sells then (board 2026-11-11)
assert act(hold(avg4 - 0.3), L)[0]["do"] == "none"                                                # not back above its average: hold
a = act(hold(PX * 0.95 - 0.01, now="2026-11-04T17:14:00Z"), L)[0]; assert a["do"] == "sell" and a["reason"] == "stock stop", a   # 5% stock stop, any run
assert act(hold(PX * 0.95 + 0.05, now="2026-11-04T17:14:00Z"), L)[0]["do"] == "none"
old = {**L, "open": {**pos, "enteredAt": "2026-10-20T19:44:00Z"}}
a = act(hold(avg4 - 0.3), old)[0]; assert a["do"] == "sell" and a["reason"] == "time", a           # 10 trading days
a = act(hold(avg4 - 0.3, now="2026-11-04T17:14:00Z"), {**L, "open": {**pos, "expiration": "2026-11-06"}})[0]; assert a["reason"] == "expiry near", a
today = {**L, "open": {**pos, "enteredAt": "2026-11-04T20:14:00Z"}}
a = act(hold(avg4 + 0.3), today)[0]; assert a["do"] == "none" and "bought today" in a["reason"], a  # never sold on the day it was bought
a = act(hold(avg4 - 0.3, tpOrders={"b": {"id": "t", "price": 0.45}}), L); assert [x["do"] for x in a] == ["cancel_order"], a   # no resting order under this rule
a = act(hold(avg4 + 0.3, tpOrders={"b": {"id": "t", "price": 0.45}}), L); assert [x["do"] for x in a] == ["cancel_order", "sell"], a
a = act(hold(avg4 + 0.3, optQuotes={"b": {"bid": 0, "ask": 0.05}}), L)[0]; assert a["do"] == "none" and "bid is 0" in a["reason"], a
assert ob.tick_up(0.286) == 0.29 and ob.tick_up(3.11) == 3.15

# ---------------------------------------------------------------- cheap-stock rule (scan list, $25 or less, call within 3%)
cc = copy.deepcopy(cfg); cc["rules"]["index"]["enabled"] = False
SC = {"generatedAt": "2026-11-04T02:00:00Z", "asOf": "2026-11-03", "watch": ["F", "SOFI", "XLE", "AMD"],
      "symbols": {"F": {"lastClose": 12.4, "trendFloor": 11.0, "rsiTrigger": 12.2}, "SOFI": {"lastClose": 26.2, "trendFloor": 22.0, "rsiTrigger": 25.5},
                  "XLE": {"lastClose": 90.0, "trendFloor": 80.0, "rsiTrigger": 85.0}, "AMD": {"lastClose": 160.0, "trendFloor": 140.0, "rsiTrigger": 155.0}}}
U = {**F, "symbols": {}, "scan": SC}
a = act(U, c=cc)[0]; assert a["do"] == "need_scan_prices" and a["symbols"] == ["F", "SOFI"], a       # only names that could be $25 or less today
P = {"F": 12.1, "SOFI": 25.2}                                                                        # both signal; SOFI is above $25
a = act({**U, "scanPrices": P}, c=cc)[0]; assert a["do"] == "need_quality" and a["symbol"] == "F", a      # board 2026-11-11: good stocks only
GOOD = {"F": {"pe": 8.0, "buy": 6, "hold": 3, "sell": 0}}
U = {**U, "quality": GOOD}
assert "not profitable" in act({**U, "scanPrices": P, "quality": {"F": {"pe": -6.7, "buy": 9, "hold": 1, "sell": 0}}}, c=cc)[0]["reason"]
assert "not rated a buy" in act({**U, "scanPrices": P, "quality": {"F": {"pe": 8, "buy": 9, "hold": 12, "sell": 0}}}, c=cc)[0]["reason"]
assert "not rated a buy" in act({**U, "scanPrices": P, "quality": {"F": {"pe": 31, "buy": 0, "hold": 0, "sell": 0}}}, c=cc)[0]["reason"]   # no coverage (like PAYS)
a = act({**U, "scanPrices": P}, c=cc)[0]; assert a == {"do": "need_earnings", "symbol": "F", "note": a["note"]}, a
a = act({**U, "scanPrices": P, "earnings": {"F": "2026-11-17"}}, c=cc)[0]; assert a["do"] == "none" and "earnings" in a["reason"], a   # report inside 14 days
U2 = {**U, "scanPrices": P, "earnings": {"F": None}, "expirations": {"F": ["2026-11-20", "2026-12-04", "2026-12-11"]}}
a = act({**U2, "expirations": {}}, c=cc)[0]; assert a == {"do": "need_expirations", "symbol": "F"}, a
a = act(U2, c=cc)[0]; assert a["do"] == "need_calls" and a["expiration"] == "2026-12-04" and a["strikeMin"] == 11.74 and a["strikeMax"] == 12.46, a
FK = lambda i, strike, bid, ask: {"symbol": "F", "id": i, "strike": strike, "expiration": "2026-12-04", "bid": bid, "ask": ask, "delta": 0.5}
FC = [FK("f115", 11.5, 0.40, 0.43), FK("f12", 12.0, 0.20, 0.22), FK("f125", 12.5, 0.10, 0.12)]        # 11.5 and 12.5 are more than 3% away
a = act({**U2, "calls": FC}, c=cc)[0]
assert a["do"] == "buy" and a["id"] == "f12" and a["rule"] == "cheapStock" and a["strategyId"] == "optbuy:cheapStock" and a["limitPrice"] == "0.21", a
assert a["underlyingPx"] == 12.1 and a["forecastUsd"] > 0 and abs(a["strike"] / 12.1 - 1) <= 0.03
a = act({**U2, "calls": [FK("f125", 12.5, 0.10, 0.12)]}, c=cc)[0]; assert a["do"] == "none" and "F" in a["reason"], a      # only a far strike: no trade
a = act({**U2, "calls": [FK("f12", 12.0, 0.10, 0.20)]}, c=cc)[0]; assert a["do"] == "none" and "too wide" in a["reason"], a  # 10-cent-wide quote
a = act({**U2, "calls": [], "callsFetched": ["F|2026-12-04"]}, c=cc)[0]; assert a["do"] == "none" and "F" in a["reason"], a
a = act({**U, "scan": {**SC, "generatedAt": "2026-10-20T02:00:00Z"}}, c=cc)[0]; assert a["do"] == "none" and "stale" in a["reason"], a
assert act({**U, "scanPrices": {"F": 12.3, "SOFI": 25.2}}, c=cc)[0]["do"] == "none"                  # F above its trigger, SOFI not cheap: no signal
assert act({**U2, "calls": FC, "skip": ["F"]}, c=cc)[0]["do"] == "none"                              # news veto
# with both rules live the cheap stock (stronger evidence) is tried first
a = act({**U2, "calls": FC, "symbols": copy.deepcopy(F["symbols"])})[0]; assert a["do"] == "buy" and a["symbol"] == "F", a

# ---------------------------------------------------------------- the books record which rule a trade belongs to
buy = act({**U2, "calls": FC}, c=cc)[0]
with tempfile.TemporaryDirectory() as d:
    ob.LEDGER = os.path.join(d, "led.json")
    assert ob.main(["open", "--json", json.dumps(buy), "--price", "0.46"]) == 0
    o = json.load(open(ob.LEDGER))["open"]; assert o["rule"] == "cheapStock" and o["underlyingPx"] == 12.1 and o["entryPrice"] == 0.46, o
    assert ob.main(["open", "--json", json.dumps(buy), "--price", "0.46"]) == 2                      # never the same option twice
    for i_ in (2, 3):
        assert ob.main(["open", "--json", json.dumps({**buy, "id": f"x{i_}", "symbol": f"S{i_}", "label": f"S{i_}"}), "--price", "0.20"]) == 0
    assert ob.main(["open", "--json", json.dumps({**buy, "id": "x4", "symbol": "S4", "label": "S4"}), "--price", "0.20"]) == 2   # a 4th: over the limit of 3
    assert ob.main(["close", "--price", "0.30", "--reason", "bounce"]) == 2                          # three held: must say which
    assert ob.main(["close", "--price", "0.30", "--reason", "bounce", "--id", "x2"]) == 0
    assert ob.main(["close", "--price", "0.30", "--reason", "bounce", "--id", "x3"]) == 0
    assert len(json.load(open(ob.LEDGER))["positions"]) == 1
    assert ob.main(["close", "--price", "0.60", "--reason", "bounce"]) == 0
    led = json.load(open(ob.LEDGER)); t = led["trades"][-1]
    assert led["open"] is None and t["rule"] == "cheapStock" and t["reason"] == "bounce" and t["pnlUsd"] == round((0.60 - 0.46) * 100 - 0.06, 2), t
# ---------------------------------------------------------------- several options at once (board 2026-11-11: up to 3 at $25)
held1 = {**LED, "positions": [pos]}
f3 = {**hold(avg4 - 0.3), "quality": GOOD, "symbols": {"SPY": {"price": avg4 - 0.3, "closes": dip, "heldQty": 0}, **{k: v for k, v in F["symbols"].items() if k != "SPY"}},
      "scan": SC, "scanPrices": P, "earnings": {"F": None}, "expirations": {"F": ["2026-12-04"]}, "calls": FC}
a = _act(f3, held1, cfg)[0]; assert a["do"] == "buy" and a["symbol"] == "F", a                       # one held (SPY), still room: buys another
two = {**LED, "positions": [pos, {**pos, "id": "f12x", "symbol": "F", "label": "F", "entryPrice": 0.21, "underlyingPx": 12.1}]}
f3b = {**f3, "optHeldById": {"b": 1, "f12x": 1}, "optQuotes": {"b": {"bid": 0.4, "ask": 0.42}, "f12x": {"bid": 0.2, "ask": 0.22}},
       "symbols": {**f3["symbols"], "F": {"price": 12.1, "closes": [12.5] * 220, "heldQty": 0}}}
a = _act(f3b, two, cfg)[0]; assert a["do"] != "buy" or a["symbol"] not in ("SPY", "F"), a           # never a second option on a stock already held
three = {**LED, "positions": two["positions"] + [{**pos, "id": "z", "symbol": "IWM", "label": "IWM", "underlyingPx": F["symbols"]["IWM"]["price"], "enteredAt": "2026-11-04T19:00:00Z"}]}
f3c = {**f3b, "optHeldById": {**f3b["optHeldById"], "z": 1}, "optQuotes": {**f3b["optQuotes"], "z": {"bid": 0.2, "ask": 0.22}}}
a = _act(f3c, three, cfg)[0]; assert a["do"] == "none" and "limit of 3" in a["reason"], a            # at the limit: no more buys
# the 65% account-wide cap: $117 x 65% = $76; with $66 already in options only a ~$10 option could fit
big = {**LED, "positions": [{**pos, "entryPrice": 0.33}, {**pos, "id": "q", "symbol": "QQQ", "label": "QQQ", "entryPrice": 0.33, "underlyingPx": F["symbols"]["QQQ"]["price"], "enteredAt": "2026-11-04T19:00:00Z"}]}
fb = {**f3, "optHeldById": {"b": 1, "q": 1}, "optQuotes": {"b": {"bid": 0.3, "ask": 0.32}, "q": {"bid": 0.3, "ask": 0.32}}}
a = _act(fb, big, cfg)[0]; assert a["do"] == "none" and "nothing fits" in a["reason"], a
# ---------------------------------------------------------------- cash is the cap (board 2026-11-11)
CK = [K("big", 72, 0.70, 0.71), K("b", 75, 0.20, 0.21)]
a = _act({**F2, "calls": CK, "buyingPower": 83}, LED, cfg_cash)[0]; assert a["do"] == "buy" and a["id"] == "big", a     # $71 with $83 free: the closest call is allowed
assert float(a["maxPrice"]) * 100 <= 82
a = _act({**F2, "calls": CK, "buyingPower": 40}, LED, cfg_cash)[0]; assert a["do"] == "buy" and a["id"] == "b", a       # only $39 usable: falls back to the $21 one
assert _act({**F2, "calls": CK, "buyingPower": 15}, LED, cfg_cash)[0]["do"] == "none"                                   # not enough cash for either
print("all options-buying scenarios pass")
