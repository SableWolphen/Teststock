#!/usr/bin/env python3
"""HR: automatic firing (board order 2026-11-03: "learn what works and what doesn't, fire who you need").

Runs nightly in GitHub after the paper desks and the Historian. Rules (evidence only, never feelings):
  vega   options race lead     fired when EVERY race variant has been retired (30+ trades, PF < 0.8, net loss)
  moxie  moonshot scout        fired after 20+ closed paper bets with a net loss
  quinn  live Dip desk         after 15+ closed LIVE trades with PF < 0.9 and a net loss: the desk's new
                               buys are switched off (exits keep running) and the board is told. Firing
                               only ever REDUCES risk; re-hiring needs fresh evidence and the board.
  sim, echo                    fired by the CEO on 2026-11-03 (see reasons below).
Fired agents stop working: their GitHub steps check `python3 claudebot/hr.py active <agent>` first,
the runbook skips their parts, and the office shows them as fired with no pay.
Writes docs/data/claudebot-hr.json.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "claudebot-hr.json")
# Re-hired: Sim (2026-11-05, board: "do everything on paper... options and spreads"). The spread desk
# now runs free on GitHub (claudebot/spread_paper_gh.py), so the usage reason for firing is gone.
REHIRED = {"sim"}
CEO_DECISIONS = {
    "echo": "Crypto paper desk: the crypto desk was fired 2026-11-02 (about 1.9% round-trip cost at $15 positions). "
            "Paper-testing a desk that will not be rehired is wasted work.",
}


def load(rel, d=None):
    try:
        with open(os.path.join(ROOT, rel)) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return d


def evaluate():
    hr = load("docs/data/claudebot-hr.json", {}) or {}
    fired = {f["agent"]: f for f in hr.get("fired", []) if f["agent"] not in REHIRED}
    today = datetime.now(timezone.utc).date().isoformat()
    notes = []

    def fire(agent, reason):
        if agent not in fired:
            fired[agent] = {"agent": agent, "date": today, "reason": reason}
            notes.append(f"FIRED {agent}: {reason}")

    for a, why in CEO_DECISIONS.items():
        fire(a, why)
    race = (load("docs/data/claudebot-optscalp-paper.json", {}) or {}).get("leaderboard") or []
    real = [r for r in race if r.get("id") != "notrade"]
    if real and all(r.get("retired") for r in real):
        fire("vega", "every options race variant lost money and was retired")
    ms = (load("docs/data/claudebot-moonshot-paper.json", {}) or {}).get("leaderboard") or []
    if ms and (ms[0].get("trades") or 0) >= 20 and (ms[0].get("pnlUsd") or 0) < 0:
        fire("moxie", f"{ms[0]['trades']} closed moonshot bets, net {ms[0]['pnlUsd']} USD")
    dled = load("docs/data/claudebot-dip-ledger.json", {}) or {}
    tr = [t for t in dled.get("trades", []) if t.get("mode", "live") == "live" and t.get("pnlUsd") is not None]
    w = sum(t["pnlUsd"] for t in tr if t["pnlUsd"] > 0); l = -sum(t["pnlUsd"] for t in tr if t["pnlUsd"] <= 0)
    if len(tr) >= 15 and (w / l if l else 9) < 0.9 and w - l < 0:
        cfgp = os.path.join(ROOT, "claudebot", "dip_config.json")
        cfg = load("claudebot/dip_config.json", {})
        if cfg.get("enabled", True):
            cfg["enabled"] = False
            cfg.setdefault("changeLog", []).append({"date": today, "by": "hr.py", "change": "new Dip buys switched off: live PF < 0.9 and a net loss over 15+ trades; exits keep running; re-enable needs the board"})
            with open(cfgp, "w") as f:
                json.dump(cfg, f, indent=2); f.write("\n")
        fire("quinn", f"live Dip desk lost money over {len(tr)} trades (PF {round(w / l, 2) if l else '-'}): new buys off, exits continue")
    out = {"updatedAt": datetime.now(timezone.utc).isoformat(), "fired": sorted(fired.values(), key=lambda f: f["date"]),
           "rules": __doc__.split("Rules (evidence only, never feelings):")[1].split("Fired agents stop")[0].strip(), "lastNotes": notes}
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1); f.write("\n")
    return out


def active(agent):
    return agent not in {f["agent"] for f in (load("docs/data/claudebot-hr.json", {}) or {}).get("fired", [])}


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "active":
        ok = active(sys.argv[2]); print(f"{sys.argv[2]}: {'active' if ok else 'FIRED'}"); sys.exit(0 if ok else 1)
    print(json.dumps(evaluate()["lastNotes"]))
