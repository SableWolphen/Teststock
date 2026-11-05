"""Automatic promotion scenarios (no broker calls)."""
import copy
import importlib.util
import os
from datetime import date, timedelta

sp = importlib.util.spec_from_file_location(
    "ep", os.path.join(os.path.dirname(os.path.abspath(__file__)), "edge_promote.py"))
ep = importlib.util.module_from_spec(sp)
sp.loader.exec_module(ep)

CFG = {
    "edges": {
        "double7": {"enabled": False, "name": "Double 7s"},
        "down3": {"enabled": False, "name": "Three down days"}
    }, "changeLog": []
}
start = date(2026, 7, 1)
good = [{
    "symbol": "SPY", "in": (start + timedelta(days=i)).isoformat(),
    "out": (start + timedelta(days=i + 2)).isoformat(),
    "pnlUsd": 0.55 if i % 5 else -0.20,
    "retPct": 2.2 if i % 5 else -0.8,
    "entryUsd": 25
} for i in range(60)]
R = {"strategies": {"double7": {
    "verdict": "edge",
    "chosenOnTrain": {"test": {"trades": 630, "avgTradePct": 0.592, "profitFactor": 1.71}}
}}}
NOW = "2026-12-30T00:00:00Z"

# A desk using after-close marks is never promoted.
P = {"executionModel": "after_close_signal_same_close_mark",
     "strategies": {"double7": {"trades": good}}}
c = copy.deepcopy(CFG)
result = ep.run(c, P, R, {}, NOW)
assert ("paper_only", "double7") in [(x[0], x[1]) for x in result]
assert not c["edges"]["double7"]["enabled"]
report = next(x[2] for x in result if x[1] == "double7")
assert report["checks"]["independent_forward_trades"]
assert report["checks"]["forward_sessions"]
assert report["checks"]["executable_paper_prices"] is False

# Executable next-open paper fills that pass every check promote automatically, with recorded approval.
P2 = {**P, "executionModel": "next_session_executable"}
c = copy.deepcopy(CFG)
result = ep.run(c, P2, R, {}, NOW)
assert ("promote", "double7") in [(x[0], x[1]) for x in result], result
assert c["edges"]["double7"]["enabled"] and c["edges"]["double7"]["boardApproval"]["approvalId"]
assert not c["edges"]["down3"]["enabled"]          # no evidence: stays off
# close-marked trades never count as evidence
cm = [{**x, "fill": "close_mark"} for x in good]
assert not ep.evidence("double7", cm, P2, R)["allPassed"]

# Repeated records are NOT independent opportunities.
duplicates = [good[0]] * 80
e = ep.evidence("double7", duplicates, P2, R)
assert e["independentEntries"] == 1 and not e["allPassed"]
e = ep.evidence("double7", good[:15], P2, R)
assert not e["checks"]["independent_forward_trades"]   # 15 < 30

# Positive win rate is not enough if results are net negative or cost dominated.
losses = [{**x, "pnlUsd": -1, "retPct": -4} for x in good]
e = ep.evidence("double7", losses, P2, R)
assert not e["checks"]["doubled_cost_profit_positive"]
assert not e["checks"]["forward_lower95_positive"]

# Existing live strategies retain emergency rollback of losses.
c = copy.deepcopy(CFG)
c["edges"]["double7"]["enabled"] = True
live = {"trades": [{"rule": "double7", "pnlUsd": -1.0}] * 8 +
                  [{"rule": "double7", "pnlUsd": 0.5}] * 2}
result = ep.run(c, P, R, live, NOW)
assert ("rollback", "double7") in [(x[0], x[1]) for x in result]
assert not c["edges"]["double7"]["enabled"]
result = ep.run(c, P2, R, {}, NOW)
assert ("rolled_back", "double7") in [(x[0], x[1]) for x in result]
assert not c["edges"]["double7"]["enabled"]
print("automatic edge promotion tests passed")
