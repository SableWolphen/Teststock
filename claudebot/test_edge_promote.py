"""Edge auto-promotion scenarios. Run: python claudebot/test_edge_promote.py"""
import copy, importlib.util, os
sp = importlib.util.spec_from_file_location("ep", os.path.join(os.path.dirname(os.path.abspath(__file__)), "edge_promote.py")); ep = importlib.util.module_from_spec(sp); sp.loader.exec_module(ep)
CFG = {"edges": {"double7": {"enabled": False, "name": "Double 7s"}, "down3": {"enabled": False, "name": "3 down"}}, "changeLog": []}
good = [{"out": f"2026-12-{1 + i % 25:02d}", "pnlUsd": 0.3 if i % 4 else -0.2, "retPct": 1.2 if i % 4 else -0.8} for i in range(24)]
R = {"strategies": {"double7": {"verdict": "edge"}, "down3": {"verdict": "edge"}}}
NOW = "2026-12-30T00:00:00Z"
c = copy.deepcopy(CFG); r = ep.run(c, {"strategies": {"double7": {"trades": good}}}, R, {}, NOW)
assert c["edges"]["double7"]["enabled"] and ("promote", "double7") in r, r
assert not c["edges"]["down3"]["enabled"]                                   # no paper record yet
c = copy.deepcopy(CFG); ep.run(c, {"strategies": {"double7": {"trades": good[:10]}}}, R, {}, NOW); assert not c["edges"]["double7"]["enabled"]   # too few
c = copy.deepcopy(CFG); ep.run(c, {"strategies": {"double7": {"trades": good}}}, {"strategies": {"double7": {"verdict": "no-edge"}}}, {}, NOW); assert not c["edges"]["double7"]["enabled"]   # research faded
bad = [{"out": x["out"], "pnlUsd": -abs(x["pnlUsd"]), "retPct": -1} for x in good]
c = copy.deepcopy(CFG); ep.run(c, {"strategies": {"double7": {"trades": bad}}}, R, {}, NOW); assert not c["edges"]["double7"]["enabled"]
c = copy.deepcopy(CFG); c["edges"]["double7"]["enabled"] = True
live = {"trades": [{"rule": "double7", "pnlUsd": -1.0}] * 8 + [{"rule": "double7", "pnlUsd": 0.5}] * 2}
r = ep.run(c, {}, R, live, NOW); assert not c["edges"]["double7"]["enabled"] and ("rollback", "double7") in r, r
ep.run(c, {"strategies": {"double7": {"trades": good}}}, R, {}, NOW); assert not c["edges"]["double7"]["enabled"]   # stays off after rollback
print("all edge promotion scenarios pass")
