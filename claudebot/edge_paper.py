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
from datetime import datetime, timezone

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


def main():
    sp = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); ob = importlib.util.module_from_spec(sp); sp.loader.exec_module(ob)
    try:
        led = json.load(open(OUT))
    except Exception:  # noqa: BLE001
        led = {"schemaVersion": 1, "mode": "paper", "note": "PAPER ONLY second-edge desk: $25 pretend trades on real daily closes. Runs free in GitHub Actions. Live needs 20+ winning paper trades and board approval.",
               "lastDay": None, "strategies": {k: {"name": v, "open": {}, "trades": []} for k, v in NAMES.items()}, "runs": []}
    # An after-close signal cannot actually fill at the already observed
    # closing price. Preserve these as educational marks, not execution proof.
    led["executionModel"] = "after_close_signal_same_close_mark"
    led["executableFillEvidence"] = False
    led["researchOnly"] = True
    for k, v in NAMES.items():
        led["strategies"].setdefault(k, {"name": v, "open": {}, "trades": []})
    made = []
    for s in SYMS:
        try:
            bars = ob.daily_bars(s, "2025-01-01")[0]
        except Exception as e:  # noqa: BLE001
            print(s, "failed", e); continue
        d = [x for x, _ in bars]; c = [x for _, x in bars]
        if len(c) < 210:
            continue
        i = len(c) - 1; day = d[i]
        if led.get("lastDay") and day <= led["lastDay"]:
            continue
        for kind, st in led["strategies"].items():
            pos = st["open"].get(s)
            if pos:
                held = sum(1 for x in d if pos["in"] < x <= day)
                why = exit_sig(kind, c, i, held, pos["px"])
                if why:
                    ret = c[i] / pos["px"] * (1 - COST) / (1 + COST) - 1
                    st["trades"].append({"symbol": s, "in": pos["in"], "out": day, "entry": pos["px"], "exit": c[i], "retPct": round(100 * ret, 3),
                                         "pnlUsd": round(USD * ret, 3), "days": held, "why": why})
                    del st["open"][s]; made.append(f"{NAMES[kind].split(' (')[0]} sold {s} {100 * ret:+.2f}%")
            elif entry_sig(kind, c, i):
                st["open"][s] = {"in": day, "px": c[i]}; made.append(f"{NAMES[kind].split(' (')[0]} bought {s}")
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
