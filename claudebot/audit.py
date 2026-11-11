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


LEGACY_OVERSIZE = {("DIA", "2026-11-06T15:41:44.352000Z")}


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

    def skip(self, agent, name, detail):
        # A retired agent is inactive, not passing its old work by default.
        self.r["checks"].append({"agent": agent, "check": name, "status": "inactive", "detail": detail})

    def done(self):
        st = [c["status"] for c in self.r["checks"]]
        self.r["status"] = "fail" if "fail" in st else "warn" if "warn" in st else "pass"
        self.r["passed"] = st.count("pass")
        self.r["total"] = sum(x in ("pass", "warn", "fail") for x in st)
        self.r["inactive"] = st.count("inactive")
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
            "no open spread" if o is None else f"{'PAPER' if oled.get('mode', 'paper') != 'live' else 'LIVE'} {o['label']} max loss ${o.get('maxLossUsd')} (modeled)")
    try:
        import importlib.util as _iu
        _sp = _iu.spec_from_file_location("gov", os.path.join(os.path.dirname(os.path.abspath(__file__)), "governor.py")); _gv = _iu.module_from_spec(_sp); _sp.loader.exec_module(_gv)
        H = _gv.HARD
        gov_ok = (H["account"] == "MCP" and H["dip.maxPctOfAccount"] <= 25 and H["dip.maxOpen"] <= 5 and H["optbuy.maxPremiumUsd"] <= 50
                  and H["optbuy.maxPctOfAccount"] <= 43 and H["optbuy.maxOpen"] <= 3 and H.get("optbuy.maxTotalPctOfAccount", 100) <= 65 and "KO" in H["neverSell"] and H["maxQuoteAgeSec"] <= 180)
        gdet = f"hard ceilings intact: {H['dip.maxPctOfAccount']}% per ETF, ${H['optbuy.maxPremiumUsd']} per option, MCP only, KO never sold"
    except Exception as e:  # noqa: BLE001
        gov_ok, gdet = False, f"governor missing or broken: {e}"
    g.check("options", "Risk governor in place and not loosened", gov_ok, gdet)
    g.check("options", "Spreads stay paper-only (broker blocks agent multi-leg orders)", oled.get("mode", "paper") != "live",
            "paper only: no real multi-leg orders are ever sent" if oled.get("mode", "paper") != "live" else "options ledger says LIVE but Robinhood blocks agent spreads")
    today = now.astimezone(timezone(timedelta(hours=-6))).date().isoformat()
    opened_on_blackout = [t for t in oled.get("trades", []) + ([o] if o else []) if t and t.get("enteredAt", "")[:10] in (ocfg.get("risk", {}).get("noNewEntryDates") or {})]
    g.check("options", "No spreads opened on event-pause days", not opened_on_blackout, f"{len(opened_on_blackout)} found" if opened_on_blackout else "event pauses respected")
    dled = load(D("docs", "data", "claudebot-dip-ledger.json"), {})
    dcfg = load(D("claudebot", "dip_config.json"), {})
    dr = dcfg.get("risk", {})
    g.check("dip", "Dip desk size and count caps", dr.get("positionUsd", 999) <= 30 and dr.get("positionPctOfAccount", 0) <= 25 and dr.get("maxOpenPositions", 9) <= 5 and dr.get("minBuyingPowerAfterUsd", 0) >= 1 and dcfg.get("exit", {}).get("stopPct", 99) <= 8,
            f"proposals capped by independent governor at max 25% per ETF, approved sizing {dr.get('positionPctOfAccount')}%, min ${dr.get('positionUsd')}, {dr.get('maxOpenPositions')} positions, {dcfg.get('exit', {}).get('stopPct')}% stop")
    bad_edges = [k for k, er in (dcfg.get("edges") or {}).items()
                 if er.get("enabled") and not (er.get("boardApproval") or {}).get("approvalId")]
    g.check("dip", "Live edge requires separate recorded board approval", not bad_edges,
            "enabled edges without recorded approval: " + ", ".join(bad_edges) if bad_edges else
            "no unapproved new edges; paper results alone never authorize live changes")
    dps = dled.get("positions") if dled.get("positions") is not None else ([dled["open"]] if dled.get("open") else [])
    syms_ = [p_.get("symbol") for p_ in dps]
    # Bought under the old "use all free cash" sizing, before the governor's 25% ceiling existed. Listed by
    # exact symbol + entry time so it cannot cover any other or any later position. Remove once it is sold.
    legacy = [p_ for p_ in dps if (p_.get("symbol"), p_.get("enteredAt")) in LEGACY_OVERSIZE]
    newer = [p_ for p_ in dps if p_ not in legacy]
    g.check("dip", "Dip positions within limits", len(dps) <= min(5, dr.get("maxOpenPositions", 1)) and len(set(syms_)) == len(syms_)
            and all(p_.get("symbol") in dcfg.get("symbols", []) for p_ in dps)
            and all((p_.get("usd", 999) <= 30 or (p_.get("pctOfAccount") or 99) <= 25.5) for p_ in newer),
            "no open positions" if not dps else ", ".join(f"{p_['symbol']} ${p_.get('usd')}" for p_ in dps))
    for p_ in legacy:
        over = not (p_.get("usd", 999) <= 30 or (p_.get("pctOfAccount") or 99) <= 25.5)
        g.check("dip", "Older position above today's 25% cap", not over,
                f"{p_['symbol']} is {p_.get('pctOfAccount')}% of the account, bought before the 25% cap; new buys cannot exceed the cap; it leaves by the normal sell rules",
                level="warn")
    bcfg = load(D("claudebot", "optbuy_config.json"), {}); bled = load(D("docs", "data", "claudebot-optbuy-ledger.json"), {})
    br, bx = bcfg.get("risk", {}), bcfg.get("exit", {})
    g.check("options", "Options-buying caps", br.get("maxPremiumUsd", 999) <= 50 and br.get("maxPctOfAccount", 99) <= 45 and br.get("maxOpenPositions", 9) <= 3
            and (br.get("maxOpenPositions", 1) <= 1 or br.get("maxTotalPctOfAccount", 100) <= 65)
            and (0 < bx.get("stockStopPct", 0) <= 8 or 0 < bx.get("stopPct", 0) <= 50) and 0 < bx.get("maxHoldDays", 0) <= 10,
            f"max ${br.get('maxPremiumUsd')} / {br.get('maxPctOfAccount')}% per option, {br.get('maxOpenPositions', 1)} at a time (at most {br.get('maxTotalPctOfAccount', br.get('maxPctOfAccount'))}% together), sold if the stock falls {bx.get('stockStopPct', bx.get('stopPct'))}% or after {bx.get('maxHoldDays')} days")
    brules = bcfg.get("rules") or {}
    unapproved = [k for k, rc in brules.items() if rc.get("enabled", True) and not (rc.get("boardApproval") or {}).get("approvalId")]
    g.check("options", "Live option rules carry a recorded board order", (not bcfg.get("enabled")) or (bool(brules) and not unapproved),
            "desk is off" if not bcfg.get("enabled") else ("rules without a recorded order: " + ", ".join(unapproved) if unapproved or not brules else
            "live by board order: " + ", ".join(rc.get("name", k) for k, rc in brules.items() if rc.get("enabled", True)) + "; traded before their paper gates"))
    bps = bled.get("positions") if bled.get("positions") is not None else ([bled["open"]] if bled.get("open") else [])
    bo = bps[0] if bps else None
    b_ok_syms = set(bcfg.get("symbols", [])) | set(bcfg.get("scanUniverse", [])) | {s_ for rc in brules.values() for s_ in rc.get("symbols", [])}
    # premium ceiling = the governor's hard $50 cap (was checked at $40 here, a leftover from the earlier $30/$40 cap)
    g.check("options", "Bought options within limits", len(bps) <= min(int(br.get("maxOpenPositions", 1)), 3)
            and all(p.get("entryPrice", 99) * 100 <= 50.01 and p.get("symbol") in b_ok_syms for p in bps) and len({p.get("symbol") for p in bps}) == len(bps),
            "no option held" if not bps else ", ".join(f"{p.get('label')} at {p.get('entryPrice')}" for p in bps))
    reports.append(g.done())

    # ---------------- Analyst: check each active research agent's OWN output
    from zoneinfo import ZoneInfo
    ct = now.astimezone(ZoneInfo("America/Chicago"))
    mkt = ct.weekday() < 5 and 8 * 60 + 30 <= ct.hour * 60 + ct.minute < 15 * 60
    fired = {f["agent"] for f in (load(D("docs", "data", "claudebot-hr.json"), {}) or {}).get("fired", [])}
    a = Report("analyst", "Head of Research", ["scout", "vega", "clio", "moxie", "sim", "echo"])

    scan = load(D("docs", "data", "claudebot-optbuy-scan.json"), {})
    scan_age = age_min(scan.get("generatedAt"), now)
    watch_symbols = {r.get("symbol") for r in scan.get("dipWatch", [])}
    configured_symbols = set(dcfg.get("symbols") or [])
    a.check("scout", "ETF Dip watch covers approved symbols",
            bool(configured_symbols) and configured_symbols.issubset(watch_symbols),
            f"{len(watch_symbols & configured_symbols)}/{len(configured_symbols)} approved ETF symbols present")
    a.check("scout", "ETF Dip watch refreshed recently",
            0 <= scan_age <= 36 * 60,
            f"ETF watch {round(scan_age)}m old (36h limit)" if scan_age != float("inf") else "ETF watch missing",
            level="warn")

    race = load(D("docs", "data", "claudebot-optscalp-paper.json"), {})
    race_age = age_min(race.get("updatedAt"), now)
    if "vega" in fired:
        a.skip("vega", "Options paper race", "retired by HR: no work credited")
    else:
        a.check("vega", "Options race remains paper only",
                race.get("mode") == "paper",
                f"race mode {race.get('mode')} (the live options desk is a separate desk and needs its own recorded board order)")
        a.check("vega", "Options paper race produced recent evidence",
                bool(race.get("strategies")) and 0 <= race_age <= 3 * 24 * 60,
                f"{len(race.get('strategies') or {})} variants, updated {round(race_age)}m ago" if race_age != float("inf") else "no paper output",
                level="warn")

    hist = load(D("docs", "data", "claudebot-historian.json"), {})
    hist_age = age_min(hist.get("generatedAt"), now)
    a.check("clio", "CIO historian produced weekly research",
            bool(hist.get("leaderboard")) and 0 <= hist_age <= 9 * 24 * 60,
            f"historian updated {round(hist_age)}m ago" if hist_age != float("inf") else "historian missing",
            level="warn")

    moon = load(D("docs", "data", "claudebot-moonshot-paper.json"), {})
    moon_age = age_min(moon.get("updatedAt"), now)
    if "moxie" in fired:
        a.skip("moxie", "Moonshot research", "retired by HR: no work credited")
    else:
        a.check("moxie", "Moonshot research remains paper only", moon.get("mode") == "paper",
                f"mode {moon.get('mode', 'missing')}")
        a.check("moxie", "Moonshot paper evidence refreshed",
                0 <= moon_age <= 4 * 24 * 60,
                f"updated {round(moon_age)}m ago" if moon_age != float("inf") else "no moonshot paper output",
                level="warn")

    # Sim was re-hired 2026-11-05 onto the GitHub spread desk (claudebot/spread_paper_gh.py), which writes
    # claudebot-spread-paper.json. The old Paper Lab file is no longer refreshed, so judge Sim on the new desk.
    spl = load(D("docs", "data", "claudebot-spread-paper.json"), {}) or {}
    pa = age_min(spl.get("updatedAt"), now)
    if "sim" in fired:
        a.skip("sim", "Retired spread Paper Lab", "retired by HR: archived paper files are not evidence of current work")
    else:
        a.check("sim", "Spread Paper Lab stays paper only", spl.get("mode") == "paper",
                f"mode {spl.get('mode', 'missing')}")
        a.check("sim", "Spread Paper Lab refreshed",
                0 <= pa <= (420 if mkt else 4 * 24 * 60),
                f"spread desk updated {round(pa)}m ago" if pa != float("inf") else "spread desk file missing", level="warn")
    if "echo" in fired:
        a.skip("echo", "Retired crypto Paper Lab", "retired by HR: old results are not new work")
    else:
        a.check("echo", "Crypto paper test present",
                "cryraw" in (pled.get("strategies") or {}),
                "crypto raw paper strategy present" if "cryraw" in (pled.get("strategies") or {}) else "no crypto paper stream",
                level="warn")

    # Paper jobs belong to the research organization, not to retired staff.
    for filename, label in (("claudebot-daytrade-paper.json", "Intraday equity paper desk"),
                            ("claudebot-daytrade-wide.json", "Market-wide paper desk")):
        desk = load(D("docs", "data", filename), {})
        a.check("analyst", f"{label} is paper-only",
                desk.get("mode") == "paper", f"mode {desk.get('mode', 'missing')}")
    reports.append(a.done())

    # ---------------- Atlas: operations (health, books, planning)
    t = Report("atlas", "Chief Operating Officer", ["medic", "ledger", "planner"])
    dled0 = load(D("docs", "data", "claudebot-dip-ledger.json"), {})
    runs = sorted(led.get("runs", []) + oled.get("runs", []) + dled0.get("runs", []), key=lambda r: r["t"])
    ra = age_min(runs[-1]["t"], now) if runs else float("inf")
    # market-day schedule: runs 9:44, 2:14, 2:44 CT; the GitHub gate covers the gaps; the first run of a day follows the overnight/weekend gap
    first_today = ct.hour * 60 + ct.minute < 10 * 60 + 30 or not mkt
    gate = load(D("docs", "data", "claudebot-gate.json"), {})
    gage = age_min(gate.get("generatedAt"), now)
    t.check("medic", "Trader is running", bool(runs) and (ra <= 150 or first_today or gage <= 60),
            (f"last full run {round(ra)}m ago" + (f"; GitHub gate watching ({round(gage)}m ago)" if gage <= 60 else "") + (" (first run of the day)" if first_today and ra > 150 else "")) if runs else "never ran")
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
    badd = [x for x in dl.get("trades", []) if abs(round(x["entryPrice"] and x["pnlUsd"], 2) - round(x.get("usd", 25) * (x["exitPrice"] / x["entryPrice"] - 1), 2)) > 1.0]
    t.check("ledger", "Dip desk P&L adds up", not badd, f"{len(badd)} trades don't reconcile" if badd else f"{len(dl.get('trades', []))} trades reconcile")
    pub = json.dumps([led, oled, pled, dl, load(D("docs", "data", "claudebot-optbuy-ledger.json"), {})])
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
