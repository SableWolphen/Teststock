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
assert "q4_survivesWorstCase" in g.evaluate({**good, "ask": 0.45}, 80)["failed"]          # premium > 43% of $80? no: 45>34.4
assert "q4_survivesWorstCase" in g.evaluate({**good, "ask": 0.30}, 85)["failed"]          # 85-30 < $60 floor
assert not g.evaluate({**good, "forecastUsd": None}, 117)["pass"]        # unknown forecast rejects
print("gatekeeper tests passed")
