"""Day-trade paper desk scenarios. Run: python claudebot/test_daytrade_paper.py"""
import copy, importlib.util, os
from datetime import datetime, timedelta, timezone
sp = importlib.util.spec_from_file_location("dp", os.path.join(os.path.dirname(os.path.abspath(__file__)), "daytrade_paper.py"))
dp = importlib.util.module_from_spec(sp); sp.loader.exec_module(dp)

t0 = datetime(2026, 11, 4, 14, 30, tzinfo=timezone.utc)          # 9:30 ET
def rh(n, drift=0.02, start=100.0):
    out = []
    for i in range(n):
        p = start + (drift * i if i > 6 else 0) + (0.1 if i % 2 else 0)
        out.append({"begins_at": (t0 + timedelta(minutes=5 * i)).isoformat().replace("+00:00", "Z"), "open_price": str(p), "high_price": str(p + 0.15),
                    "low_price": str(p - 0.15), "close_price": str(p + 0.05), "volume": 1000})
    return out
full = {"date": "2026-11-04", "prevClose": {"SPY": 100.0, "QQQ": 103.0},
        "data": {"results": [{"symbol": "SPY", "bars": rh(75)}, {"symbol": "QQQ", "bars": rh(75, 0.01, 101.0)}]}}
led = {"mode": "paper", "days": [], "strategies": {}, "runs": []}
out = dp.run(copy.deepcopy(full), led)
assert out["status"] == "ok", out
assert led["mode"] == "paper" and "2026-11-04" in led["days"]
orb = led["strategies"]["orb"]["trades"]; assert orb and all(t["day"] == "2026-11-04" for t in orb)
gap = led["strategies"]["gap"]["trades"]; assert any(t["symbol"] == "QQQ" for t in gap), gap   # QQQ opened ~1.9% below 103
assert all(abs(t["pnlUsd"] - 25 * t["retPct"] / 100) < 0.01 for s in led["strategies"].values() for t in s["trades"])
assert dp.run(copy.deepcopy(full), led)["status"] == "skip"                                       # once per day
early = {**full, "date": "2026-11-05", "data": {"results": [{"symbol": "SPY", "bars": [{**b, "begins_at": b["begins_at"].replace("11-04", "11-05")} for b in rh(40)]}]}}
assert dp.run(early, led)["status"] == "wait"                                                      # day not finished yet
assert led["leaderboard"] and {r["id"] for r in led["leaderboard"]} == {"orb", "gap", "vwap", "mom"}
print("all day-trade paper scenarios pass")
