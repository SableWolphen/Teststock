"""CEO auto-approval rules. Run: python claudebot/test_promote.py"""
import importlib.util, json, os, tempfile, shutil
from datetime import datetime, timezone
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("pr", os.path.join(HERE, "promote.py"))
pr = importlib.util.module_from_spec(spec); spec.loader.exec_module(pr)
tmp = tempfile.mkdtemp(); shutil.copy(pr.CFG, os.path.join(tmp, "options_config.json"))
pr.CFG = os.path.join(tmp, "options_config.json"); pr.PAPER = os.path.join(tmp, "paper.json"); pr.LIVE = os.path.join(tmp, "live.json")
def tr(p, d="2026-11-20T16:00:00Z"): return {"pnlUsd": p, "exitedAt": d}
def setup(paper, live=None):
    json.dump({"strategies": paper}, open(pr.PAPER, "w")); json.dump(live or {"open": None, "trades": []}, open(pr.LIVE, "w"))
NOW = datetime(2026, 12, 1, 16, tzinfo=timezone.utc)
base = json.load(open(pr.CFG))
# not enough trades -> nothing
setup({"mirror": {"name": "Mirror", "trades": [tr(1)] * 5}, "safe": {"name": "Conservative", "trades": [tr(8)] * 10}})
assert pr.run(NOW)["action"] == "none"
# safe proven, beats mirror -> promote
setup({"mirror": {"name": "Mirror", "trades": [tr(10)] * 15 + [tr(-30)] * 5}, "safe": {"name": "Conservative", "trades": [tr(8)] * 19 + [tr(-20)] * 2}})
r = pr.run(NOW); assert r["action"] == "promote", r
c = json.load(open(pr.CFG)); assert c["entry"]["maxShortDelta"] == 0.15 and c["promotion"]["active"] and c["promotion"]["previous"]["entry.maxShortDelta"] == base["entry"]["maxShortDelta"]
# cooldown -> nothing
assert pr.run(NOW)["action"] == "none"
# rollback after 10 losing live trades since promotion
setup({}, {"open": None, "trades": [tr(-20, "2026-12-10T16:00:00Z")] * 7 + [tr(5, "2026-12-10T16:00:00Z")] * 3})
r = pr.run(datetime(2026, 12, 12, tzinfo=timezone.utc)); assert r["action"] == "rollback", r
c = json.load(open(pr.CFG)); assert c["entry"]["maxShortDelta"] == base["entry"]["maxShortDelta"] and not c["promotion"]["active"]
# board-only strategy never auto-promotes
shutil.copy(os.path.join(HERE, "options_config.json"), pr.CFG)
setup({"mirror": {"name": "Mirror", "trades": [tr(1)] * 20}, "nopause": {"name": "No event pause", "trades": [tr(9)] * 20}})
r = pr.run(NOW); assert r["action"] == "board" and json.load(open(pr.CFG))["entry"] == base["entry"], r
# open live spread -> wait
setup({"mirror": {"name": "Mirror", "trades": [tr(1)] * 20}, "tight": {"name": "Tight stop", "trades": [tr(9)] * 20}}, {"open": {"label": "x"}, "trades": []})
assert pr.run(NOW)["action"] == "none"
print("all promotion scenarios pass")
