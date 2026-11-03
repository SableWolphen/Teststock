"""Offline tests for the options paper race (no network)."""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import optscalp_paper as m  # noqa: E402


def bars(closes):
    return [{"c": c, "h": c * 1.001, "l": c * 0.999} for c in closes]


# rising steadily then breaking out: momentum + breakout agree -> call direction
up = bars([100 + 0.05 * i for i in range(17)] + [101.5])
f = m.features(up)
v = m.votes(f)
assert v["momentum"] == 1 and v["breakout"] == 1, v
assert v["reversal"] == -1 and m.ensemble_dir(f) == 0     # unusually big move: reversal objects, no agreement
assert m.ensemble_dir({"move": 0.6, "px": 100, "vol5Pct": 0.2, "z": 1.2, "breakout": 1}) == 1    # momentum + breakout
assert m.ensemble_dir({"move": -0.6, "px": 100, "vol5Pct": 0.2, "z": -1.2, "breakout": -1}) == -1
assert m.ensemble_dir({"move": 0.6, "px": 100, "vol5Pct": 0.05, "z": 1.2, "breakout": 1}) == 0   # too quiet to beat costs
# flat: nobody votes -> no trade
flat = m.features(bars([100 + (0.01 if i % 2 else 0) for i in range(18)]))
assert m.ensemble_dir(flat) == 0
# Black-Scholes sanity
d, th = m.bs(100, 100, 0.3, 14, "call"); assert 0.45 < d < 0.6 and th < 0
d, th = m.bs(100, 100, 0.3, 14, "put"); assert -0.55 < d < -0.4 and th < 0
# learning: moves that fully reverse -> negative carry
st = {}
t0 = datetime(2026, 11, 3, 16, 0, tzinfo=timezone.utc)
for i in range(40):
    m.learn(st, {f"S{i}": {"px": 100.0, "move": 1.0}}, t0)
st["forecast"]["pending"] = [{"t": "2026-11-03T16:00:00Z", "sym": f"S{i}", "px": 100.0, "move": 1.0} for i in range(40)]
carry = m.learn(st, {f"S{i}": {"px": 99.5, "move": -0.5} for i in range(40)}, datetime(2026, 11, 3, 16, 31, tzinfo=timezone.utc))
assert carry < 0, carry
# board: retirement and no-trade baseline
st = {"strategies": {v["id"]: {"trades": [], "open": None} for v in m.VARIANTS}}
st["strategies"]["tp3_sl15"]["trades"] = [{"pnlUsd": -2.0, "day": f"d{i}"} for i in range(25)] + [{"pnlUsd": 1.0, "day": f"e{i}"} for i in range(6)]
rows = {r["id"]: r for r in m.board(st)}
assert rows["tp3_sl15"]["retired"] and st["strategies"]["tp3_sl15"]["retired"]
assert "notrade" in rows and rows["notrade"]["pnlUsd"] == 0
assert not rows["tp5_sl30"]["retired"]
assert len([v for v in m.VARIANTS if v["mode"] == "ens"]) == 2
print("optscalp paper tests passed")
