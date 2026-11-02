"""Probe: can our Alpaca keys read historical option bars? Prints a small sample."""
import json, os, urllib.request
H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
for sym, start, end in [("SPY240315C00510000", "2024-03-13T13:30:00Z", "2024-03-13T21:00:00Z"), ("SPY251031C00680000", "2025-10-30T13:30:00Z", "2025-10-30T21:00:00Z"), ("QQQ260115P00600000", "2026-01-14T13:30:00Z", "2026-01-14T21:00:00Z")]:
    url = f"https://data.alpaca.markets/v1beta1/options/bars?symbols={sym}&timeframe=5Min&start={start}&end={end}&limit=1000"
    try:
        d = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30).read())
        b = (d.get("bars") or {}).get(sym, [])
        print(sym, "bars:", len(b), "first:", b[:1], "last:", b[-1:])
    except Exception as e:
        print(sym, "ERROR", e, getattr(e, "read", lambda: b"")()[:300])
