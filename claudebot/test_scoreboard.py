#!/usr/bin/env python3
"""Scoreboard arithmetic: same dollars, same days, against SPY and savings."""
import importlib.util, os
sp = importlib.util.spec_from_file_location("sb", os.path.join(os.path.dirname(os.path.abspath(__file__)), "scoreboard.py"))
m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)
spy = [("2026-11-02", 600.0), ("2026-11-05", 594.0), ("2026-11-06", 600.0), ("2026-11-11", 612.0)]
t = [("Stocks", "XLK", 25.0, -1.45, "2026-11-02", "2026-11-05", False), ("Stocks", "DIA", 78.92, 1.26, "2026-11-06", "2026-11-11", False)]
r = m.build(t, spy, "2026-11-11T22:00:00Z")
assert r["trades"][0]["spyUsd"] == -0.25 and r["trades"][1]["spyUsd"] == 1.58           # 25 x -1%, 78.92 x +2%
assert r["trades"][0]["savingsUsd"] == round(25 * 0.04 * 3 / 365, 2)
assert r["totals"]["bot"] == -0.19 and r["totals"]["spy"] == 1.33 and "SPY" in r["verdict"]
assert m.close_on_or_before(spy, "2026-11-08") == 600.0 and m.close_on_or_before(spy, "2026-10-01") is None
assert m.build([], spy, "x")["verdict"] == "No real trades yet."
print("ok")
