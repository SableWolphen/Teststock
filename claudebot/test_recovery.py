"""Recovery test suite (CEO backlog #1, from OpenAI #108).

A duplicate scheduled run, a restart mid-order, a partial fill and a rejected order must never
create a second order or a book/broker mismatch. Covers the Dip desk planner + ledger commands,
the options-buying planner, and the independent risk governor.

Run: python3 claudebot/test_recovery.py
"""
import copy
import importlib.util
import json
import os
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def _mod(name, file):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m); return m


db = _mod("rec_dip", "dip_bot.py")
gv = _mod("rec_gov", "governor.py")
ob = _mod("rec_opt", "optbuy_bot.py")

# ---------------------------------------------------------------- fixtures
cfg = db.load(db.CONFIG)
for e in (cfg.get("edges") or {}).values():
    e["enabled"] = False
cfg["symbols"] = ["SPY", "QQQ"]
cfg["risk"].update(deployAllCash=False, reserveForOptionsUsd=0, maxOpenPositions=3)
db.options_open = lambda: True
up = [600 + i * 0.6 for i in range(220)]
dip = up[:-3] + [up[-3] - 6, up[-3] - 13, up[-3] - 20]       # sharp dip, still above the 200d SMA
NOW = "2026-11-04T20:14:00Z"                                  # 14:14 CT, Wednesday, market open
LATER = "2026-11-05T20:14:00Z"                                # next session
EMPTY = {"open": None, "trades": [], "runs": []}


def facts(spy_held=0.0, qqq_held=0.0, now=NOW, spy_px=None, bp=112):
    return {"now": now, "marketOpen": True, "accountValue": 117, "buyingPower": bp,
            "symbols": {"SPY": {"price": spy_px if spy_px is not None else dip[-1] - 2, "closes": dip, "heldQty": spy_held},
                        "QQQ": {"price": up[-1] + 1, "closes": up, "heldQty": qqq_held}}}


def plan(f, led):
    return db.plan(copy.deepcopy(f), cfg, copy.deepcopy(led))["actions"][0]


def gov(order, led, ocfg=None, oled=None):
    files = {"claudebot/dip_config.json": cfg, "docs/data/claudebot-dip-ledger.json": led,
             "claudebot/optbuy_config.json": ocfg or {"enabled": False}, "docs/data/claudebot-optbuy-ledger.json": oled or {}}
    base = {"accountNickname": "MCP", "accountValue": 117, "buyingPower": 112, "quoteAgeSec": 5, "now": NOW}
    return gv.check({**base, **order}, lambda rel, d=None: copy.deepcopy(files.get(rel, d)))


class Ledger:
    """Runs dip_bot.py's real ledger commands against a throwaway ledger file."""
    def __init__(self, led):
        self.dir = tempfile.mkdtemp(prefix="rec_")
        db.LEDGER = os.path.join(self.dir, "ledger.json"); db.save(db.LEDGER, led)
        cp = os.path.join(self.dir, "cfg.json"); db.save(cp, cfg); db.CONFIG = cp

    def cmd(self, *argv):
        return db.main(list(argv))

    @property
    def data(self):
        return db.load(db.LEDGER)


def buys(seq):
    return [a for a in seq if a["do"] == "buy"]


# ---------------------------------------------------------------- 1. duplicate scheduled run
a1 = plan(facts(), EMPTY)
assert a1["do"] == "buy" and a1["symbol"] == "SPY", a1
assert gov({"desk": "dip", "side": "buy", "symbol": "SPY", "usd": float(a1["dollarAmount"])}, EMPTY)["allow"]
L = Ledger(EMPTY)
assert L.cmd("open", "--symbol", "SPY", "--price", str(dip[-1] - 2), "--usd", a1["dollarAmount"], "--rule", "dip") == 0
qty = float(a1["dollarAmount"]) / (dip[-1] - 2)
led1 = L.data
# the same scheduled run fires again (same minute, same prices): it must not buy SPY again
a2 = plan(facts(spy_held=qty), led1)
assert not (a2["do"] == "buy" and a2["symbol"] == "SPY"), a2
g = gov({"desk": "dip", "side": "buy", "symbol": "SPY", "usd": float(a1["dollarAmount"])}, led1)
assert not g["allow"] and any("duplicate" in r for r in g["reasons"]), g
# replaying the 'open' bookkeeping step twice never books a second position
assert L.cmd("open", "--symbol", "SPY", "--price", "700", "--usd", "25") == 2
assert [p["symbol"] for p in L.data["positions"]] == ["SPY"]
# a duplicate 'close' after the position is booked out is refused, so P&L is never counted twice
assert L.cmd("close", "--symbol", "SPY", "--price", str(dip[-1]), "--reason", "bounce") == 0
assert L.cmd("close", "--symbol", "SPY", "--price", str(dip[-1]), "--reason", "bounce") == 2
assert len(L.data["trades"]) == 1 and L.data["positions"] == []

# ---------------------------------------------------------------- 2. restart mid-order
# (a) buy filled at the broker, run died before `dip_bot.py open`: the broker shows SPY, the ledger doesn't
a = plan(facts(spy_held=qty), EMPTY)
assert not (a["do"] == "buy" and a["symbol"] == "SPY"), a                        # no second order
assert "reconcile" in a.get("reason", ""), a                                      # and it says why
# other symbols are not frozen by the unrelated mismatch
qdip = facts(spy_held=qty); qdip["symbols"]["QQQ"] = {"price": dip[-1] - 2, "closes": dip, "heldQty": 0}
a = plan(qdip, EMPTY); assert a["do"] == "buy" and a["symbol"] == "QQQ", a
# the bot never sells shares its ledger does not record
assert not gov({"desk": "dip", "side": "sell", "symbol": "SPY", "quantity": f"{qty:.6f}"}, EMPTY)["allow"]
# a garbage broker quantity fails closed (no buy of that symbol)
bad = facts(); bad["symbols"]["SPY"]["heldQty"] = "n/a"
a = plan(bad, EMPTY); assert not (a["do"] == "buy" and a["symbol"] == "SPY"), a
bad["symbols"]["SPY"]["heldQty"] = float("nan")
a = plan(bad, EMPTY); assert not (a["do"] == "buy" and a["symbol"] == "SPY"), a
# (b) sell filled at the broker, run died before `dip_bot.py close`: record it, never sell again
pos = {"symbol": "SPY", "entryPrice": 700.0, "usd": 25.0, "rule": "dip", "enteredAt": "2026-11-03T20:14:00Z"}
held = {**EMPTY, "positions": [pos]}
a = plan(facts(spy_held=0, spy_px=740), held)
assert a["do"] == "record_broker_close" and a["symbol"] == "SPY", a
# (c) sell submitted but not yet filled (shares tied up => shares_available_for_sells 0): no second sell
assert plan(facts(spy_held=0, spy_px=740), held)["do"] != "sell"

# ---------------------------------------------------------------- 3. partial fill
# buy: asked for $25, broker filled $10 -> ledger books only the filled notional
L = Ledger(EMPTY)
assert L.cmd("open", "--symbol", "SPY", "--price", "700", "--usd", "10.00") == 0
pled = L.data; own = 10 / 700
assert pled["positions"][0]["usd"] == 10.0
# next run: no top-up buy of the same fund (no averaging in), sells never exceed what was filled
a = plan(facts(spy_held=own, spy_px=740, now=LATER), pled)
assert a["do"] == "sell" and float(a["quantity"]) <= own + 1e-6, a
assert not gov({"desk": "dip", "side": "sell", "symbol": "SPY", "quantity": f"{25 / 700:.6f}"}, pled)["allow"]
assert gov({"desk": "dip", "side": "sell", "symbol": "SPY", "quantity": a["quantity"]}, pled)["allow"]
a = plan(facts(spy_held=own, now=LATER), pled)
assert not (a["do"] == "buy" and a["symbol"] == "SPY"), a
# sell: only part of the shares sold -> next plan sells at most the remainder the broker still shows
a = plan(facts(spy_held=own / 2, spy_px=740, now=LATER), pled)
assert a["do"] == "sell" and float(a["quantity"]) <= own / 2 + 1e-6, a
# a broker quantity above the bot's own (board shares in the same fund) is never sold
a = plan(facts(spy_held=5.0, spy_px=740, now=LATER), pled)
assert float(a["quantity"]) <= own + 1e-6, a

# ---------------------------------------------------------------- 4. rejected order
# buy rejected: nothing is booked, so the next run proposes the SAME single order, not a bigger one
L = Ledger(EMPTY)
assert L.cmd("log", "--action", "error", "--detail", "SPY buy rejected by broker; no order") == 0
rled = L.data
assert db.positions(rled) == [] and rled["runs"][-1]["action"] == "error"
r1, r2 = plan(facts(), rled), plan(facts(), rled)
assert r1 == r2 == a1, (r1, r2)
assert len(buys([r1])) == 1
# the governor still refuses a retry "with different numbers" above the cap
assert not gov({"desk": "dip", "side": "buy", "symbol": "SPY", "usd": 90.0}, rled)["allow"]
# sell rejected: position stays booked; the next plan repeats the same quantity, never doubles it
s1 = plan(facts(spy_held=25 / 700, spy_px=740, now=LATER), held)
s2 = plan(facts(spy_held=25 / 700, spy_px=740, now=LATER), held)
assert s1["do"] == "sell" and s1 == s2 and float(s1["quantity"]) <= 25 / 700 + 1e-6, (s1, s2)

# ---------------------------------------------------------------- 5. options-buying desk
ocfg = ob.load(ob.CONFIG)
opt = {"id": "opt-1", "symbol": "SPY", "underlying": "SPY", "entryPrice": 0.30, "enteredAt": "2026-11-03T20:14:00Z"}
oled = {"open": opt, "trades": [], "runs": []}
# one option at a time: a second buy is always denied while one is booked
g = gov({"desk": "optbuy", "side": "buy", "symbol": "QQQ", "usd": 30, "gatekeeper": {"pass": True, "live": True}},
        EMPTY, ocfg={"enabled": True, "risk": {"maxPremiumUsd": 50, "maxPctOfAccount": 43}}, oled=oled)
assert not g["allow"] and any("the limit" in r for r in g["reasons"]), g
# never sells an option the ledger does not hold
assert not gov({"desk": "optbuy", "side": "sell", "symbol": "QQQ"}, EMPTY, oled={"open": None})["allow"]
# restart after the take-profit filled at the broker: record it, don't sell again
of = {"now": NOW, "marketOpen": True, "accountValue": 117, "buyingPower": 112, "symbols": {}, "optHeldById": {}, "optQuotes": {}, "tpOrders": {}}
oa = ob.plan(copy.deepcopy(of), copy.deepcopy(ocfg), copy.deepcopy(oled))["actions"][0]
assert oa["do"] == "record_broker_close", oa

# ---------------------------------------------------------------- 6. a full replay never makes 2 orders
# simulate 3 overlapping scheduled runs of the same minute after one filled buy
L = Ledger(EMPTY)
orders = []
for run in range(3):
    led = L.data
    held_q = sum(o_["usd"] / o_["price"] for o_ in orders if o_["symbol"] == "SPY")
    a = plan(facts(spy_held=held_q), led)
    if a["do"] == "buy" and gov({"desk": "dip", "side": "buy", "symbol": a["symbol"], "usd": float(a["dollarAmount"])}, led)["allow"]:
        # every run dies mid-order: filled at the broker, never booked in the ledger
        orders.append({"symbol": a["symbol"], "usd": float(a["dollarAmount"]), "price": dip[-1] - 2})
assert [o_["symbol"] for o_ in orders] == ["SPY"], orders

print(json.dumps({"recovery": "all scenarios pass", "scenarios": 6}))
