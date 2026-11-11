"""Tests for the Profitability Gatekeeper."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gatekeeper as g  # noqa: E402

good = {"ask": 0.40, "bid": 0.38, "forecastUsd": 1.5}
v = g.evaluate(good, 117, evidence="unknown")
assert v["pass"] and v["answers"]["q2_evidence"] == "unknown"           # paper: evidence may be unknown
assert not g.evaluate(good, 117, evidence="unknown", live=True)["pass"]  # live: evidence required
assert g.evaluate(good, 117, evidence="yes", live=True)["pass"]
assert not g.evaluate({**good, "forecastUsd": -1.4}, 117)["pass"]       # Q1 no: loses after costs
assert "q3_beatsEtfAndCash" in g.evaluate({**good, "forecastUsd": 0.01}, 117)["failed"]   # tiny edge loses to the ETF
# board 2026-11-11 "the cap is what is in the account only": an option may use the account, never more than it
assert "q4_survivesWorstCase" not in g.evaluate({**good, "ask": 0.45}, 80)["failed"]      # $45 of an $80 account: allowed now
assert "q4_survivesWorstCase" in g.evaluate({**good, "ask": 0.90}, 80)["failed"]          # $90 > the whole $80 account
assert not g.evaluate({**good, "forecastUsd": None}, 117)["pass"]        # unknown forecast rejects
# board order 2026-11-11: a recorded order to trade a live-desk rule can stand in for the paper gates,
# is always labelled as an override, and never excuses the other three questions
v = g.evaluate(good, 117, evidence="board", live=True, hold_minutes=1170)
assert v["pass"] and v["boardOverride"] is True and v["answers"]["q2_evidence"] == "board"
assert g.evaluate(good, 117, evidence="yes", live=True)["boardOverride"] is False
assert not g.evaluate({**good, "forecastUsd": -0.5}, 117, evidence="board", live=True, hold_minutes=1170)["pass"]   # Q1 still required
assert not g.evaluate({**good, "ask": 0.90}, 85, evidence="board", live=True, hold_minutes=1170)["pass"]             # Q4 still required
real_load = g.load
CFG = {"enabled": True, "rollback": {"afterTrades": 10, "minProfitFactor": 1.0, "since": "2026-11-11T00:00:00Z"},
       "rules": {"cheapStock": {"enabled": True, "boardApproval": {"approvalId": "board-x"}}, "noOrder": {"enabled": True}}}
LED = {"trades": []}
g.load = lambda rel, d=None: CFG if rel.endswith("optbuy_config.json") else LED if rel.endswith("optbuy-ledger.json") else real_load(rel, d)
assert g.evidence_for("optbuy:cheapStock") == "board"
assert g.evidence_for("optbuy:noOrder") == "unknown" and g.evidence_for("optbuy:missing") == "unknown"     # no recorded order: no live buy
LED["trades"] = [{"rule": "cheapStock", "enteredAt": "2026-11-12T20:00:00Z", "pnlUsd": -20.0}] * 7 + [{"rule": "cheapStock", "enteredAt": "2026-11-12T20:00:00Z", "pnlUsd": 30.0}] * 3
assert g.evidence_for("optbuy:cheapStock") == "no"            # 10 live trades, losing: the rule is off
LED["trades"] = LED["trades"][:9]; assert g.evidence_for("optbuy:cheapStock") == "board"   # fewer than 10: still on
CFG["enabled"] = False; assert g.evidence_for("optbuy:cheapStock") == "unknown"
g.load = real_load
print("gatekeeper tests passed")
