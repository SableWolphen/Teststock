"""Scenario tests for the options planner. Run: python claudebot/test_options_bot.py"""
import importlib.util, os, copy
spec = importlib.util.spec_from_file_location("ob", os.path.join(os.path.dirname(__file__), "options_bot.py"))
ob = importlib.util.module_from_spec(spec); spec.loader.exec_module(ob)
cfg = ob.load(ob.CONFIG)
LED = {"startingAccountUsd": 113, "open": None, "trades": [], "snapshots": [], "runs": [], "mode": "paper"}
NOW = "2026-11-02T16:14:00Z"  # 10:14 CT Monday
EXPS = ["2026-11-04", "2026-11-06", "2026-11-09", "2026-11-13", "2026-11-20"]
def q(id_, k, bid, ask, d): return {"id": id_, "strike": k, "expiration": "2026-11-13", "bid": bid, "ask": ask, "delta": d}
CANDS = [q("a", 275, 2.9, 2.95, -0.33), q("b", 272, 2.05, 2.09, -0.25), q("c", 271, 1.84, 1.88, -0.22),
         q("d", 270, 1.66, 1.70, -0.20), q("e", 269, 1.50, 1.54, -0.18)]
F = {"now": NOW, "marketOpen": True, "underlying": {"price": 280.7, "sma20": 276.4}, "expirations": EXPS, "candidates": CANDS}
def act(f=F, l=LED): return ob.plan(copy.deepcopy(f), cfg, copy.deepcopy(l))["actions"]

a = act({**F, "candidates": []}); assert a[0]["do"] == "need_contracts" and a[0]["expiration"] == "2026-11-13" and a[0]["strikes"][0] == 276 and len(a[0]["strikes"]) <= 10, a
a = act(); assert a[0]["do"] == "open_spread" and a[0]["shortStrike"] == 271 and a[0]["longStrike"] == 270, a
assert a[0]["credit"] == 0.16 and a[0]["maxLossUsd"] == 84.0, a
assert act({**F, "marketOpen": False})[0]["reason"] == "market closed"
assert "not above" in act({**F, "underlying": {"price": 275, "sma20": 276.4}})[0]["reason"]
assert "window" in act({**F, "now": "2026-11-02T20:14:00Z"})[0]["reason"]
wide = [dict(c) for c in CANDS]; wide[2]["ask"] = 1.99
assert "too wide" in act({**F, "candidates": wide})[0]["reason"]
assert "too big" in act(l={**LED, "startingAccountUsd": 100})[0]["reason"]

pos = dict(underlying="IWM", expiration="2026-11-13", shortStrike=271, longStrike=270, shortId="c", longId="d",
           credit=0.16, maxLossUsd=84, shortDelta=-0.22, underlyingPrice=280.7, label="IWM 11-13 271/270P", enteredAt="2026-11-02T16:14:00Z")
L2 = {**LED, "open": pos}
assert act(F, L2)[0]["do"] == "need_leg_quotes"
legs = lambda sb, sa, lb, la: {"c": {"bid": sb, "ask": sa}, "d": {"bid": lb, "ask": la}}
assert act({**F, "legs": legs(1.6, 1.64, 1.47, 1.51)}, L2)[0]["do"] == "none"
a = act({**F, "legs": legs(0.60, 0.63, 0.55, 0.58)}, L2); assert a[0]["do"] == "close_spread" and a[0]["reason"] == "take profit", a
a = act({**F, "legs": legs(4.1, 4.2, 3.7, 3.8), "underlying": {"price": 272, "sma20": 276}}, L2); assert a[0]["reason"] == "stop", a
a = act({**F, "legs": legs(1.9, 1.95, 1.7, 1.75), "underlying": {"price": 270.5, "sma20": 276}}, L2); assert a[0]["reason"] == "short strike breached", a
a = act({**F, "now": "2026-11-12T19:14:00Z", "legs": legs(0.4, 0.43, 0.3, 0.33)}, L2); assert a[0]["reason"] == "close before expiry", a
L3 = {**LED, "trades": [{"pnlUsd": -30, "exitedAt": "2026-11-01T20:00:00Z"}]}
assert "cooling" in act(l=L3)[0]["reason"]
print("all options scenarios pass")
