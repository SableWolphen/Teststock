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
# A retired agent's archived output must never count as fresh work or a pass.
o = with_patch(lambda p, d: (
    {"fired": [{"agent": "sim"}, {"agent": "echo"}]}
    if p.endswith("claudebot-hr.json") else d))
checks = next(r for r in o["reports"] if r["manager"] == "analyst")["checks"]
assert next(x for x in checks if x["agent"] == "sim")["status"] == "inactive"
assert next(x for x in checks if x["agent"] == "echo")["status"] == "inactive"
assert all(x["status"] != "pass" for x in checks if x["agent"] in ("sim", "echo"))
assert "vega" in {x["agent"] for x in checks}
assert "clio" in {x["agent"] for x in checks}
assert "moxie" in {x["agent"] for x in checks}
assert "scout" in {x["agent"] for x in checks}
assert next(x for x in checks if x["agent"] == "scout")["check"] == "ETF Dip watch covers approved symbols"
# Scout should fail for missing ETF watch even if the crypto feed is fresh.
o = with_patch(lambda p, d: (
    {**d, "dipWatch": []}
    if p.endswith("claudebot-optbuy-scan.json") else d))
checks = next(r for r in o["reports"] if r["manager"] == "analyst")["checks"]
assert any(x["agent"] == "scout" and x["status"] == "fail" for x in checks), checks
# New live ETF strategies must have separately recorded approval, not just paper wins.
o = with_patch(lambda p, d: (
    {**d, "edges": {"double7": {"enabled": True, "promotion": {"paperTrades": 99}}}}
    if p.endswith("claudebot/dip_config.json") else d))
checks = next(r for r in o["reports"] if r["manager"] == "guard")["checks"]
assert any(x["check"] == "Live edge requires separate recorded board approval" and x["status"] == "fail" for x in checks)
# Market-wide cheap-stock option (board 2026-11-11 'watch all stocks'): passes only when bought by that rule,
# found by the nightly scan, and priced within the rule's ceiling. Anything else still fails.
# these scenarios test the cheap-stock rule while it is ON (the live desk was switched off 2026-11-19)
ON = lambda d: {**d, "enabled": True, "rules": {**(d.get("rules") or {}), "cheapStock": {**((d.get("rules") or {}).get("cheapStock") or {}), "enabled": True}}}
def bought(pos):
    o = with_patch(lambda p, d: ({**d, "positions": [pos], "open": None} if p.endswith("claudebot-optbuy-ledger.json") else
                                 {**d, "discovered": ["ZZZQ"], "symbols": {**(d.get("symbols") or {}), "ZZZQ": {}}} if p.endswith("claudebot-optbuy-scan.json") else
                                 ON(d) if p.endswith("claudebot/optbuy_config.json") else d))
    return next(x for r in o["reports"] for x in r["checks"] if x["check"] == "Bought options within limits")["status"]
ok = {"symbol": "ZZZQ", "label": "ZZZQ 12-18 10C", "rule": "cheapStock", "underlyingPx": 9.8, "entryPrice": 0.20, "enteredAt": "2026-11-11T19:00:00Z"}   # within the $25 cap (board 2026-11-20)
assert bought(ok) == "pass"
assert bought({**ok, "symbol": "NOTSCANNED"}) == "fail"          # not found by the scan
assert bought({**ok, "rule": "index"}) == "fail"                  # another rule cannot use the market-wide list
assert bought({**ok, "rule": None}) == "fail"
assert bought({**ok, "underlyingPx": 40}) == "fail"              # above the cheap-stock price ceiling
assert bought({**ok, "underlyingPx": None}) == "fail"
o = with_patch(lambda p, d: ({**d, "positions": [ok], "open": None} if p.endswith("claudebot-optbuy-ledger.json") else
                             {**d, "discovered": ["ZZZQ"]} if p.endswith("claudebot-optbuy-scan.json") else
                             {**d, "rules": {**d["rules"], "cheapStock": {**d["rules"]["cheapStock"], "enabled": False}}} if p.endswith("optbuy_config.json") else d))
assert next(x for r in o["reports"] for x in r["checks"] if x["check"] == "Bought options within limits")["status"] == "fail"   # rule switched off
print("all audit scenarios pass")
