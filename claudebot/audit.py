#!/usr/bin/env python3
"""ClaudeBot management audit: the "bosses" checking their teams' real work.

Runs at the end of every hourly run (after live + Paper Lab) and writes
docs/data/claudebot-audit.json. Each manager owns a set of checks on real files:

  CEO (Claude)            <- reads every manager's report
    Atlas (COO)           -> Medic (health), Ledger (books), Planner (calendar/config)
    Analyst (Research)    -> Scout (price scan), Sim & Echo (Paper Lab)
    Guard (Chief Risk)    -> Crypto desk, Options desk (rules actually followed)

It only reads files. It never trades and never changes rules. A FAIL is reported to
the user by the hourly run; WARNs show up in the office.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, *p)
OUT = D("docs", "data", "claudebot-audit.json")

# Hard limits the bosses enforce. If a config ever gets looser than this, that's a FAIL.
LIMITS = {
    "crypto.maxPositionUsd": 15, "crypto.maxOpenPositions": 1, "crypto.stopAtrMin": 1.0,
    "options.maxOpenSpreads": 1, "options.widthUsd": 1, "options.maxLossPctOfAccount": 80,
    "options.maxShortDeltaMax": 0.30, "options.pauseBelowAccountValueUsd": 50,
}


def load(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def age_min(s, now):
    return (now - ts(s)).total_seconds() / 60 if s else float("inf")


class Report:
    def __init__(self, manager, title, team):
        self.r = {"manager": manager, "title": title, "team": team, "checks": []}

    def check(self, agent, name, ok, detail, level="fail"):
        status = "pass" if ok else level
        self.r["checks"].append({"agent": agent, "check": name, "status": status, "detail": detail})

    def done(self):
        st = [c["status"] for c in self.r["checks"]]
        self.r["status"] = "fail" if "fail" in st else "warn" if "warn" in st else "pass"
        self.r["passed"] = st.count("pass"); self.r["total"] = len(st)
        return self.r


def run(now=None):
    now = now or datetime.now(timezone.utc)
    sig = load(D("docs", "data", "claudebot-signal.json"), {})
    led = load(D("docs", "data", "claudebot-ledger.json"), {})
    oled = load(D("docs", "data", "claudebot-options-ledger.json"), {})
    pled = load(D("docs", "data", "claudebot-paper-ledger.json"), {})
    ccfg = load(D("claudebot", "config.json"), {})
    ocfg = load(D("claudebot", "options_config.json"), {})
    reports = []

    # ---------------- Guard: trading desks followed the rules
    g = Report("guard", "Chief Risk Officer", ["crypto", "options", "dip"])
    r = ccfg.get("risk", {})
    g.check("crypto", "Crypto position cap", r.get("maxPositionUsd", 999) <= LIMITS["crypto.maxPositionUsd"] and r.get("maxOpenPositions", 9) <= 1,
            f"max ${r.get('maxPositionUsd')} per buy, {r.get('maxOpenPositions')} position at a time")
    g.check("crypto", "Crypto stop distance", ccfg.get("strategy", {}).get("stopAtr", 0) >= LIMITS["crypto.stopAtrMin"], f"stop at {ccfg.get('strategy', {}).get('stopAtr')}x ATR")
    op = led.get("open")
    g.check("crypto", "Open crypto position has a stop", (op is None) or (op.get("stop") and op["stop"] < op["entryPrice"] * 1.01),
            "no open position" if op is None else f"{op['symbol']} stop {op.get('stop')} vs entry {op.get('entryPrice')}")
    big = [t for t in led.get("trades", []) if t.get("allocationPct", 0) > 100]
    g.check("crypto", "No oversized crypto trades", not big, f"{len(big)} trades above 100% of account" if big else "all trades within size")
    e, x, rk = ocfg.get("entry", {}), ocfg.get("exit", {}), ocfg.get("risk", {})
    g.check("options", "One spread, $1 wide", rk.get("maxOpenSpreads", 9) <= 1 and e.get("widthUsd", 9) <= LIMITS["options.widthUsd"],
            f"{rk.get('maxOpenSpreads')} spread max, ${e.get('widthUsd')} wide")
    g.check("options", "Exits within hard limits", 30 <= x.get("takeProfitPctOfCredit", 0) <= 80 and 1.5 <= x.get("stopAtMultipleOfCredit", 0) <= 3.5,
            f"take profit {x.get('takeProfitPctOfCredit')}%, stop {x.get('stopAtMultipleOfCredit')}x credit")
    pm = ocfg.get("promotion") or {}
    g.check("options", "Rule changes came from an approved promotion", True if not pm else bool(pm.get("strategy") and pm.get("evidence")),
            f"active promotion: {pm.get('strategyName')} ({pm.get('evidence', {}).get('paperTrades')} paper trades)" if pm.get("active") else "live rules are the original rules")
    g.check("options", "Risk limits not loosened", rk.get("maxLossPctOfAccount", 999) <= LIMITS["options.maxLossPctOfAccount"]
            and e.get("maxShortDelta", 1) <= LIMITS["options.maxShortDeltaMax"] and rk.get("pauseBelowAccountValueUsd", 0) >= LIMITS["options.pauseBelowAccountValueUsd"],
            f"max loss ≤{rk.get('maxLossPctOfAccount')}% of account, delta ≤{e.get('maxShortDelta')}, floor ${rk.get('pauseBelowAccountValueUsd')}")
    o = oled.get("open")
    g.check("options", "Open spread within limits", (o is None) or (o.get("maxLossUsd", 999) <= 100 and abs(o.get("shortDelta", 1)) <= LIMITS["options.maxShortDeltaMax"]),
            "no open spread" if o is None else f"{o['label']} max loss ${o.get('maxLossUsd')}")
    today = now.astimezone(timezone(timedelta(hours=-6))).date().isoformat()
    opened_on_blackout = [t for t in oled.get("trades", []) + ([o] if o else []) if t and t.get("enteredAt", "")[:10] in (ocfg.get("risk", {}).get("noNewEntryDates") or {})]
    g.check("options", "No spreads opened on event-pause days", not opened_on_blackout, f"{len(opened_on_blackout)} found" if opened_on_blackout else "event pauses respected")
    dled = load(D("docs", "data", "claudebot-dip-ledger.json"), {})
    dcfg = load(D("claudebot", "dip_config.json"), {})
    dr = dcfg.get("risk", {})
    g.check("dip", "Dip desk size and count caps", dr.get("positionUsd", 999) <= 30 and dr.get("maxOpenPositions", 9) <= 1 and dcfg.get("exit", {}).get("stopPct", 99) <= 8,
            f"${dr.get('positionUsd')} per trade, {dr.get('maxOpenPositions')} at a time, {dcfg.get('exit', {}).get('stopPct')}% stop")
    dop = dled.get("open")
    g.check("dip", "Dip position within limits", (dop is None) or (dop.get("usd", 999) <= 30 and dop.get("symbol") in dcfg.get("symbols", [])),
            "no open position" if dop is None else f"{dop['symbol']} ${dop.get('usd')}")
    reports.append(g.done())

    # ---------------- Analyst: research + Paper Lab are producing
    a = Report("analyst", "Head of Research", ["scout", "sim", "echo"])
    sa = age_min(sig.get("generatedAt"), now)
    a.check("scout", "Price scan is fresh", sa <= 150, f"{round(sa)}m old (limit 150m)" if sa != float("inf") else "missing")
    a.check("scout", "Scan covers all coins", len(sig.get("coins", [])) >= len(ccfg.get("universe", [])) - 1, f"{len(sig.get('coins', []))}/{len(ccfg.get('universe', []))} coins")
    pa = age_min(pled.get("updatedAt"), now)
    a.check("sim", "Paper Lab ran recently", pa <= 130, f"updated {round(pa)}m ago" if pa != float("inf") else "has not run yet", level="warn")
    a.check("sim", "Paper Lab never trades real money", pled.get("mode", "paper") == "paper", f"mode {pled.get('mode', 'paper')}")
    a.check("echo", "Crypto paper test running", "cryraw" in (pled.get("strategies") or {}), "running" if "cryraw" in (pled.get("strategies") or {}) else "not started", level="warn")
    reports.append(a.done())

    # ---------------- Atlas: operations (health, books, planning)
    t = Report("atlas", "Chief Operating Officer", ["medic", "ledger", "planner"])
    runs = sorted(led.get("runs", []) + oled.get("runs", []), key=lambda r: r["t"])
    ra = age_min(runs[-1]["t"], now) if runs else float("inf")
    t.check("medic", "Hourly trader is running", ra <= 130, f"last run {round(ra)}m ago" if runs else "never ran")
    errs = [r for r in runs if r.get("action") == "error" and age_min(r["t"], now) < 1440]
    t.check("medic", "No errors in 24h", not errs, f"{len(errs)} errors: {errs[-1]['detail'][:80]}" if errs else "clean", level="warn")
    # books: recompute options P&L and crypto index from trades
    fee = ocfg.get("model", {}).get("feesPerRoundTrip", 0.2)
    bad = [x for x in oled.get("trades", []) if abs(round((x["credit"] - x["debit"]) * 100 - fee, 2) - x["pnlUsd"]) > 0.02]
    t.check("ledger", "Options P&L adds up", not bad, f"{len(bad)} trades don't reconcile" if bad else f"{len(oled.get('trades', []))} trades reconcile")
    idx = 100.0
    for tr in led.get("trades", []):
        idx *= 1 + tr.get("accountImpactPct", 0) / 100
    t.check("ledger", "Crypto equity index adds up", abs(idx - led.get("equityIndex", 100)) < 0.05, f"recomputed {idx:.2f} vs book {led.get('equityIndex')}")
    dl = load(D("docs", "data", "claudebot-dip-ledger.json"), {})
    badd = [x for x in dl.get("trades", []) if abs(round(x["entryPrice"] and x["pnlUsd"], 2) - round(25 * (x["exitPrice"] / x["entryPrice"] - 1), 2)) > 1.0]
    t.check("ledger", "Dip desk P&L adds up", not badd, f"{len(badd)} trades don't reconcile" if badd else f"{len(dl.get('trades', []))} trades reconcile")
    pub = json.dumps([led, oled, pled, dl])
    import re
    leak = re.search(r'"(account_number|rhs_account_number|order_id|buying_power|quantity)"', pub)
    t.check("ledger", "No private data in public books", not leak, "clean" if not leak else f"found field {leak.group(1)}")
    dates = sorted((ocfg.get("risk", {}).get("noNewEntryDates") or {}).keys())
    horizon = (now + timedelta(days=30)).date().isoformat()
    t.check("planner", "Event calendar covers the next 30 days", bool(dates) and dates[-1] >= horizon,
            f"last listed event day {dates[-1] if dates else 'none'}" + ("" if dates and dates[-1] >= horizon else " (add the next events)"), level="warn")
    reports.append(t.done())

    # ---------------- CEO summary
    st = [r["status"] for r in reports]
    ceo = {"status": "fail" if "fail" in st else "warn" if "warn" in st else "pass",
           "summary": " · ".join(f"{r['title']}: {r['passed']}/{r['total']}" for r in reports)}
    out = {"schemaVersion": 1, "generatedAt": now.isoformat().replace("+00:00", "Z"),
           "org": {"ceo": "claude", "managers": {r["manager"]: r["team"] for r in reports}},
           "ceo": ceo, "reports": reports}
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1); f.write("\n")
    return out


if __name__ == "__main__":
    o = run()
    print(json.dumps({"ceo": o["ceo"], "fails": [c for r in o["reports"] for c in r["checks"] if c["status"] == "fail"]}, indent=1))
    sys.exit(0)
