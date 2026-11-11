#!/usr/bin/env python3
"""The options report card only restates other jobs' result files. Check it reads the real files,
never claims an unaffordable kind is buyable, and survives missing files."""
import importlib.util, json, os, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sp = importlib.util.spec_from_file_location("options_report", os.path.join(HERE, "options_report.py"))
m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)

r = m.build()
rows = {x["id"]: x for x in r["rows"]}
assert {"dipcalls", "cheapcalls", "scalps"} <= set(rows), rows.keys()
for x in r["rows"]:
    assert x["verdict"] in ("held up", "lost", "no edge", "too early", "not proven", "mixed") and x["canBuy"] and x["history"] and x["paper"]
# the research file says no dip-call contract fits a ~$117 account: the card must not say otherwise
src = json.load(open(os.path.join(m.DATA, "claudebot-dipcall-research.json")))
fits = max((row.get("test") or {}).get("affordableAt117Pct") or 0 for row in src["rows"] if row["side"] == "calls")
assert rows["dipcalls"]["affordable"] == (fits > 0)
if not rows["dipcalls"]["affordable"]:
    assert rows["dipcalls"]["canBuy"].startswith("No")
assert r["anyAffordableKindHeldUp"] == any(x["affordable"] and x["verdict"] == "held up" for x in r["rows"])
assert m.money(-29.4) == "-$29.40" and m.money(3) == "+$3.00"
# missing files: empty card, no crash
with tempfile.TemporaryDirectory() as d:
    e = m.build(d, d)
    assert e["rows"] == [] and e["lessons"] == [] and e["anyAffordableKindHeldUp"] is False
print("ok")
