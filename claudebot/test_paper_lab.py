"""Scenario tests for the Paper Lab. Run: python claudebot/test_paper_lab.py"""
import importlib.util, json, os, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("pl", os.path.join(HERE, "paper_lab.py"))
pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
tmp = tempfile.mkdtemp(); pl.LEDGER = os.path.join(tmp, "paper.json")
sig = {"generatedAt": "2026-11-04T15:04:00Z", "regime": {"riskOff": True}, "coins": [
  {"symbol": "ETH", "score": 2.0, "atr": 20.0, "setup": False, "exitSignal": False, "blockers": ["market risk-off: BTC below its 200-hour average"], "barTime": "2026-11-04T15:00:00Z"},
  {"symbol": "BTC", "score": 1.0, "atr": 500, "setup": False, "exitSignal": False, "blockers": ["market risk-off: BTC below", "not in uptrend"], "barTime": "2026-11-04T15:00:00Z"}]}
pl.SIGNAL = os.path.join(tmp, "sig.json"); json.dump(sig, open(pl.SIGNAL, "w"))
live_before = open(os.path.join(HERE, "..", "docs", "data", "claudebot-options-ledger.json")).read()

EXPS = ["2026-11-13", "2026-11-20", "2026-11-27"]
U = {s: {"price": p, "closes": [p * (0.97 + i * 0.0015) for i in range(21)], "expirations": EXPS} for s, p in [("SPY", 758.3), ("DIA", 517), ("KRE", 72), ("IWM", 280.7), ("XLF", 56.5)]}
def q(sym, id_, k, bid, ask, d, exp="2026-11-20"): return {"symbol": sym, "id": id_, "strike": k, "expiration": exp, "bid": bid, "ask": ask, "delta": d}
CANDS = [q("SPY", "s5", 735, 2.6, 2.64, -0.32), q("SPY", "s4", 734, 2.4, 2.44, -0.29), q("SPY", "s3", 731, 1.9, 1.93, -0.24),
         q("SPY", "s2", 730, 1.74, 1.77, -0.22), q("SPY", "s1", 729, 1.58, 1.61, -0.20), q("SPY", "s0", 728, 1.44, 1.47, -0.18),
         q("SPY", "t1", 722, .74, .77, -.15), q("SPY", "t0", 721, .62, .65, -.13)]
ofacts = {"now": "2026-11-04T16:14:00Z", "marketOpen": True, "underlyings": U, "candidates": CANDS}
cfacts = {"quotes": {"ETH": {"bid": 2290, "ask": 2333}}}
fo, fc = os.path.join(tmp, "o.json"), os.path.join(tmp, "c.json")
json.dump(ofacts, open(fo, "w")); json.dump(cfacts, open(fc, "w"))
assert pl.main(["run", fo, fc]) == 0
L = json.load(open(pl.LEDGER)); S = L["strategies"]
assert S["mirror"]["open"] and S["mirror"]["open"]["shortStrike"] == 730, S["mirror"]["open"]
assert S["nopause"]["open"] and S["safe"]["open"]["shortStrike"] == 722, S["safe"]
assert S["aggr"]["open"]["shortStrike"] == 731 and S["tight"]["open"]
assert S["cryraw"]["open"]["symbol"] == "ETH" and S["cryraw"]["open"]["entry"] == 2333
# next day: prices collapse -> stops; ETH rallies -> target
ofacts2 = {**ofacts, "now": "2026-11-05T16:14:00Z", "underlyings": {**U, "SPY": {**U["SPY"], "price": 726}},
           "legs": {c["id"]: {"bid": round((c["strike"] - 715) * 0.8, 2), "ask": round((c["strike"] - 715) * 0.8 + 0.03, 2)} for c in CANDS}}
json.dump(ofacts2, open(fo, "w")); json.dump({"quotes": {"ETH": {"bid": 2400, "ask": 2440}}}, open(fc, "w"))
pl.main(["run", fo, fc]); L = json.load(open(pl.LEDGER)); S = L["strategies"]
for k in ["mirror", "nopause", "safe", "aggr", "tight"]:
    assert S[k]["open"] is None and S[k]["trades"][-1]["pnlUsd"] < 0, (k, S[k]["trades"])
assert S["cryraw"]["trades"][-1]["reason"] == "target" and S["cryraw"]["trades"][-1]["pnlUsd"] > 0
assert all("promotionCandidate" in r for r in L["leaderboard"])
# missing data -> needs, not crashes
json.dump({"now": "2026-11-12T16:14:00Z", "marketOpen": True, "underlyings": U, "candidates": []}, open(fo, "w"))
os.remove(pl.LEDGER); import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf): pl.main(["run", fo, fc])
out = json.loads(buf.getvalue()); assert any(n["type"] == "contracts" for n in out["needs"]), out
assert open(os.path.join(HERE, "..", "docs", "data", "claudebot-options-ledger.json")).read() == live_before, "paper lab must never touch the live ledger"
print("all paper lab scenarios pass")
