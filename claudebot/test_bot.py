"""Scenario tests for the ClaudeBot planner. Run: python claudebot/test_bot.py"""
import importlib.util, os, copy
spec = importlib.util.spec_from_file_location("bot", os.path.join(os.path.dirname(__file__), "bot.py"))
bot = importlib.util.module_from_spec(spec); spec.loader.exec_module(bot)
cfg = bot.load(bot.CONFIG)
NOW = "2026-11-02T03:12:00Z"
SIG = {"generatedAt": "2026-11-02T03:05:00Z", "regime": {"riskOff": False}, "bestCandidate": "SOL",
       "coins": [{"symbol": "SOL", "lastClose": 180.0, "score": 2.1, "rsi": 61, "trend": "up", "atr": 1.5,
                  "exitSignal": False, "barTime": "2026-11-02T02:00:00Z", "blockers": []}]}
LED = {"equityIndex": 100, "open": None, "trades": [], "snapshots": [], "runs": []}
F = {"now": NOW, "accountValue": 17.26, "cryptoBuyingPower": 12.97, "positions": {"DOGE": 0.06},
     "openOrders": [], "quotes": {"SOL": {"bid": 180.1, "ask": 180.3}, "DOGE": {"bid": 0.17, "ask": 0.171}}}
def act(f=F, s=SIG, l=LED): return bot.plan(copy.deepcopy(f), cfg, copy.deepcopy(s), copy.deepcopy(l))["actions"]

a = act(); assert a[0]["do"] == "buy_market" and a[0]["dollarAmount"] == "12.32", a
assert act(s={**SIG, "bestCandidate": None})[0]["do"] == "none"
assert act(s={**SIG, "generatedAt": "2026-11-01T20:00:00Z"})[0]["do"] == "none"
assert act(s={**SIG, "regime": {"riskOff": True}})[0]["do"] == "none"
assert act(f={**F, "accountValue": 9})[0]["do"] == "none"
assert "chasing" in act(f={**F, "quotes": {"SOL": {"bid": 184, "ask": 184.2}}})[0]["reason"]
assert "spread" in act(f={**F, "quotes": {"SOL": {"bid": 178, "ask": 180.3}}})[0]["reason"]

pos = {"symbol": "SOL", "enteredAt": "2026-11-02T01:00:00Z", "entryPrice": 180.0, "atr": 1.5,
       "stop": 177.0, "initialStop": 177.0, "target": 184.5, "allocationPct": 71}
L2 = {**LED, "open": pos}
F2 = {**F, "positions": {"SOL": 0.068}}
a = act(F2, SIG, L2); assert a == [{"do": "place_stop", "symbol": "SOL", "quantity": 0.068, "stopPrice": 177.0}], a
F3 = {**F2, "openOrders": [{"id": "o1", "symbol": "SOL", "side": "sell", "type": "stop_loss", "stopPrice": 177.0, "quantity": 0.068}]}
assert act(F3, SIG, L2)[0]["do"] == "none"
a = act({**F3, "quotes": {"SOL": {"bid": 182.4, "ask": 182.6}}}, SIG, L2)
assert [x["do"] for x in a] == ["cancel", "place_stop"] and a[1]["stopPrice"] == 180.54, a
a = act({**F3, "quotes": {"SOL": {"bid": 184.6, "ask": 184.8}}}, SIG, L2)
assert [x["do"] for x in a] == ["cancel", "sell_market"] and a[1]["reason"] == "target", a
a = act({**F3, "now": "2026-11-04T02:00:00Z"}, SIG, L2); assert a[-1]["do"] == "sell_market" and "time" in a[-1]["reason"]
sig_exit = {**SIG, "coins": [{**SIG["coins"][0], "exitSignal": True}]}
assert act(F3, sig_exit, L2)[-1]["reason"].startswith("trend break")
assert act({**F, "positions": {}}, SIG, L2)[0]["do"] == "record_stop_exit"
L3 = {**LED, "equityIndex": 90, "snapshots": [{"t": "2026-11-02T00:00:00Z", "index": 100}]}
assert "loss limit" in act(l=L3)[0]["reason"]
L4 = {**LED, "trades": [{"returnPct": -1.2, "exitedAt": "2026-11-02T02:30:00Z"}]}
assert "cooling" in act(l=L4)[0]["reason"]
print("all planner scenarios pass")
