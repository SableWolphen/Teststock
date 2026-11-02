"""The bosses must catch loosened rules and broken books. Run: python claudebot/test_audit.py"""
import importlib.util, os, json, copy
spec = importlib.util.spec_from_file_location("au", os.path.join(os.path.dirname(os.path.abspath(__file__)), "audit.py"))
au = importlib.util.module_from_spec(spec); spec.loader.exec_module(au)
orig_load, orig_out = au.load, au.OUT
au.OUT = "/dev/null"
def with_patch(fn):
    def load(path, default=None):
        d = orig_load(path, default); return fn(path, copy.deepcopy(d))
    au.load = load
    try: return au.run()
    finally: au.load = orig_load
def status(o, mgr): return next(r for r in o["reports"] if r["manager"] == mgr)["status"]
o = with_patch(lambda p, d: ({**d, "risk": {**d["risk"], "maxPositionUsd": 500}} if p.endswith("claudebot/config.json") else d))
assert status(o, "guard") == "fail" and o["ceo"]["status"] == "fail", o["reports"][0]
o = with_patch(lambda p, d: ({**d, "entry": {**d["entry"], "widthUsd": 5}} if p.endswith("options_config.json") else d))
assert status(o, "guard") == "fail"
o = with_patch(lambda p, d: ({**d, "trades": [{"credit": .2, "debit": .1, "pnlUsd": 50, "label": "x", "enteredAt": "2026-11-04T16:00:00Z"}]} if p.endswith("claudebot-options-ledger.json") else d))
assert status(o, "atlas") == "fail"
o = with_patch(lambda p, d: ({**d, "account_number": "123"} if p.endswith("claudebot-ledger.json") else d))
assert status(o, "atlas") == "fail"
print("all audit scenarios pass")
