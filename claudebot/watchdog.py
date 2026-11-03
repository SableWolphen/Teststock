#!/usr/bin/env python3
"""Free GitHub watchdog (no Claude usage): during market hours, fail loudly if the trader has stopped
running or the audit says FAIL, so GitHub emails the repo owner. Read-only."""
import json, os, sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLIDAYS = {"2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"}
now = datetime.now(timezone.utc); ct = now.astimezone(ZoneInfo("America/Chicago"))
if ct.weekday() >= 5 or ct.date().isoformat() in HOLIDAYS or not (10 * 60 <= ct.hour * 60 + ct.minute <= 15 * 60 + 30):
    print("market closed: nothing to watch"); sys.exit(0)
def load(n):
    try: return json.load(open(os.path.join(ROOT, "docs", "data", n)))
    except Exception: return {}
runs = [r["t"] for n in ("claudebot-dip-ledger.json", "claudebot-ledger.json", "claudebot-options-ledger.json", "claudebot-optbuy-ledger.json") for r in load(n).get("runs", [])]
last = max((datetime.fromisoformat(t.replace("Z", "+00:00")) for t in runs), default=None)
age = (now - last).total_seconds() / 60 if last else 1e9
problems = []
g = load("claudebot-gate.json")
gage = (now - datetime.fromisoformat(g["generatedAt"].replace("Z", "+00:00"))).total_seconds() / 60 if g.get("generatedAt") else 1e9
if gage > 60:
    problems.append(f"Trade gate has not updated for {gage:.0f} minutes during market hours (GitHub schedule may be stuck); Claude runs fall back to full checks.")
if g.get("needed") and gage < 60 and age > 90:
    problems.append(f"Gate says a trade is ready ({'; '.join(g.get('reasons', []))[:200]}) but the trader has not acted for {age:.0f} minutes (scheduled Claude runs may be failing, e.g. usage limit).")
a = load("claudebot-audit.json")
if a.get("ceo", {}).get("status") == "fail":
    fails = [f"{c['check']}: {c['detail']}" for r in a.get("reports", []) for c in r.get("checks", []) if c.get("status") == "fail"]
    problems.append("Management audit FAIL: " + "; ".join(fails)[:400])
if problems:
    print("::error::" + " | ".join(problems)); sys.exit(1)
print(f"OK: last trader run {age:.0f}m ago, audit {a.get('ceo', {}).get('status')}")
