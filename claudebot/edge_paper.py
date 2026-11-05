#!/usr/bin/env python3
"""Second-edge PAPER desk (free, runs in GitHub Actions after each close; no Claude usage, no orders).

Paper-trades the two research candidates on real daily closes, $25 pretend per trade, one position
per fund per strategy:
  double7  close at a 7-day low while above the 200-day average; sell at a 7-day high or after 10 days
  down3    3 down closes in a row while above the 200-day average; sell on the first up close or after 10 days
Writes docs/data/claudebot-edge-paper.json (same shape the office's Paper scorecard reads).
These are AFTER-CLOSE paper marks, not executable fills; never auto-promote live.
Forward testing needs executable next-session prices and independent review.
"""
from __future__ import annotations

import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-edge-paper.json")
SYMS = ["SPY", "QQQ", "DIA", "IWM", "SMH", "XLK", "KRE", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU"]
COST, USD = 0.0003, 25.0
NAMES = {"double7": "Double 7s (new 7-day low in an uptrend)", "down3": "3 down days in an uptrend",
         "dipwide": "Dip rule on 14 funds (the live desk's proven rule, wider)"}


def rsi2(c):
    g = l = 0.0
    for i in range(1, len(c)):
        d = c[i] - c[i - 1]; up, dn = max(d, 0), max(-d, 0)
        if i <= 2: g += up / 2; l += dn / 2
        else: g = (g + up) / 2; l = (l + dn) / 2
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def entry_sig(kind, c, i):
    sma = sum(c[i - 199:i + 1]) / 200
    if c[i] <= sma:
        return False
    if kind == "double7":
        return c[i] <= min(c[i - 6:i + 1])
    if kind == "dipwide":
        return rsi2(c[:i + 1]) < 5
    return all(c[i - k] < c[i - k - 1] for k in range(3))


def exit_sig(kind, c, i, held, entry=None):
    if kind == "dipwide":
        if entry and c[i] <= entry * 0.95:
            return "5% stop"
        if c[i] > sum(c[i - 4:i + 1]) / 5 or rsi2(c[:i + 1]) > 70:
            return "bounce"
        return "time" if held >= 10 else None
    if held >= 10:
        return "time"
    if kind == "double7" and c[i] >= max(c[i - 6:i + 1]):
        return "7-day high"
    if kind == "down3" and c[i] > c[i - 1]:
        return "up close"
    return None


def day_opens(sym):
    import urllib.request
    start = (datetime.now(timezone.utc).date() - timedelta(days=20)).isoformat()
    h = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    d = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"https://data.alpaca.markets/v2/stocks/{sym}/bars?timeframe=1Day&start={start}&adjustment=split&feed=iex&limit=100", headers=h), timeout=30).read())
    return {b["t"][:10]: float(b["o"]) for b in d.get("bars") or []}


def main():
    sp = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); ob = importlib.util.module_from_spec(sp); sp.loader.exec_module(ob)
    try:
        led = json.load(open(OUT))
    except Exception:  # noqa: BLE001
        led = {"schemaVersion": 1, "mode": "paper", "note": "PAPER ONLY second-edge desk: $25 pretend trades on real daily closes. Runs free in GitHub Actions. Live needs 20+ winning paper trades and board approval.",
               "lastDay": None, "strategies": {k: {"name": v, "open": {}, "trades": []} for k, v in NAMES.items()}, "runs": []}
    # Executable fills (2026-11-05): a signal seen at the close is filled at the NEXT session's open
    # (a price the bot could really get), for both entries and exits. Older trades marked at the same
    # close are kept but labelled fill="close_mark" and do not count as promotion evidence.
    led["executionModel"] = "next_session_executable"
    led["executableFillEvidence"] = True
    led["researchOnly"] = False
    for k, v in NAMES.items():
        led["strategies"].setdefault(k, {"name": v, "open": {}, "trades": []})
    made = []
    for s in SYMS:
        try:
            bars = ob.daily_bars(s, "2025-01-01")[0]
        except Exception as e:  # noqa: BLE001
            print(s, "failed", e); continue
        d = [x for x, _ in bars]; c = [x for _, x in bars]
        try:
            opens = day_opens(s)
        except Exception as e:  # noqa: BLE001
            print(s, "opens failed", e); continue
        if len(c) < 210:
            continue
        i = len(c) - 1; day = d[i]
        if led.get("lastDay") and day <= led["lastDay"]:
            continue
        for kind, st in led["strategies"].items():
            pend = st.setdefault("pending", {})
            # 1) fill yesterday's decisions at today's open
            pe = pend.pop(s, None)
            if pe and day > pe["signalDay"] and day in opens:
                if pe["side"] == "buy" and s not in st["open"]:
                    st["open"][s] = {"in": day, "px": opens[day], "fill": "next_open", "signalDay": pe["signalDay"]}
                    made.append(f"{NAMES[kind].split(' (')[0]} bought {s} at the open")
                elif pe["side"] == "sell" and s in st["open"]:
                    pos = st["open"].pop(s); px = opens[day]
                    ret = px / pos["px"] * (1 - COST) / (1 + COST) - 1
                    st["trades"].append({"symbol": s, "in": pos["in"], "out": day, "entry": pos["px"], "exit": px, "retPct": round(100 * ret, 3),
                                         "pnlUsd": round(USD * ret, 3), "days": sum(1 for x in d if pos["in"] < x <= day), "why": pe["why"],
                                         "fill": "next_open" if pos.get("fill") == "next_open" else "close_mark"})
                    made.append(f"{NAMES[kind].split(' (')[0]} sold {s} at the open {100 * ret:+.2f}%")
            elif pe:
                pend[s] = pe
            # 2) decide at today's close; act at the next open
            pos = st["open"].get(s)
            if pos and s not in pend:
                held = sum(1 for x in d if pos["in"] < x <= day)
                why = exit_sig(kind, c, i, held, pos["px"])
                if why:
                    pend[s] = {"side": "sell", "signalDay": day, "why": why}
            elif not pos and s not in pend and entry_sig(kind, c, i):
                pend[s] = {"side": "buy", "signalDay": day}
                made.append(f"{NAMES[kind].split(' (')[0]} signal on {s}: buy at the next open")
        led["_day"] = max(led.get("_day") or "", day)
    if led.get("_day"):
        led["lastDay"] = led.pop("_day")
    lb = []
    for k, st in led["strategies"].items():
        t = st["trades"]; w = [x for x in t if x["pnlUsd"] > 0]; l = [x["pnlUsd"] for x in t if x["pnlUsd"] <= 0]
        lb.append({"id": k, "name": st["name"], "trades": len(t), "wins": len(w), "winRatePct": round(100 * len(w) / len(t), 1) if t else None,
                   "pnlUsd": round(sum(x["pnlUsd"] for x in t), 2), "open": len(st["open"]),
                   "profitFactor": round(sum(x["pnlUsd"] for x in w) / -sum(l), 2) if l and sum(l) < 0 else None})
    led["leaderboard"] = lb
    led["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    led.setdefault("runs", []).append({"t": led["updatedAt"], "action": "paper-day", "detail": f"{led.get('lastDay')}: " + (", ".join(made[:8]) if made else "no signals")})
    led["runs"] = led["runs"][-60:]
    json.dump(led, open(OUT, "w"), indent=1)
    print(led["runs"][-1]["detail"])


if __name__ == "__main__":
    main()
