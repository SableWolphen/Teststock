#!/usr/bin/env python3
"""Day-trade PAPER desk, GitHub edition (free, after each close; no Claude usage, no orders).
Fetches today's 5-minute bars and yesterday's close from Alpaca and replays the day through
daytrade_paper.py (same strategies, same $25 pretend trades). Idempotent per day."""
import importlib.util, json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
HERE = os.path.dirname(os.path.abspath(__file__))
sp = importlib.util.spec_from_file_location("dp", os.path.join(HERE, "daytrade_paper.py")); dp = importlib.util.module_from_spec(sp); sp.loader.exec_module(dp)
SYMS = ["SPY", "QQQ", "DIA", "IWM", "SMH", "XLK", "KRE"]
H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
get = lambda u: json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=60).read())
day = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
start = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
inp = {"date": day, "prevClose": {}, "symbols": {}}
for s in SYMS:
    try:
        d = get(f"https://data.alpaca.markets/v2/stocks/{s}/bars?timeframe=1Day&start={start}&adjustment=split&feed=iex&limit=20")["bars"]
        prev = [b for b in d if b["t"][:10] < day]
        b5 = get(f"https://data.alpaca.markets/v2/stocks/{s}/bars?timeframe=5Min&start={day}T13:00:00Z&end={day}T21:00:00Z&adjustment=split&feed=iex&limit=1000")["bars"] or []
        if prev and b5:
            inp["symbols"][s] = {"prevClose": prev[-1]["c"], "bars": [{"t": b["t"], "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "v": b["v"]} for b in b5]}
    except Exception as e:  # noqa: BLE001
        print(s, "failed", e, file=sys.stderr)
if not inp["symbols"]:
    print("no bars today (holiday or weekend)"); sys.exit(0)
led = dp.load(dp.LEDGER) or {"schemaVersion": 1, "mode": "paper", "positionUsd": dp.POSITION_USD, "days": [], "strategies": {}, "runs": []}
out = dp.run(inp, led)
if out["status"] == "ok":
    json.dump(led, open(dp.LEDGER, "w"), indent=1)
print(out)
