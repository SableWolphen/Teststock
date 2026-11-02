#!/usr/bin/env python3
"""ClaudeBot options: IWM put-credit-spread trader. PAPER mode by default.

Same pattern as bot.py: the hourly Claude run gathers live Robinhood facts,
this script decides, Claude carries out / records the result.

  python claudebot/options_bot.py plan facts.json
  python claudebot/options_bot.py open  --json '<the open_spread action>'
  python claudebot/options_bot.py close --debit 0.07 --reason "take profit"
  python claudebot/options_bot.py log   --action hold --detail "..."
  python claudebot/options_bot.py snapshot facts.json

facts.json:
{
  "now": "2026-11-02T15:14:00Z",
  "marketOpen": true,                       # underlying quote traded in the last 15 min
  "underlying": {"price": 280.7, "sma20": 276.4},
  "expirations": ["2026-11-06", "2026-11-09", ...],          # from get_option_chains
  "candidates": [{"id": "...", "strike": 271, "expiration": "2026-11-13",
                  "bid": 1.84, "ask": 1.88, "delta": -0.22}],  # puts, after need_contracts
  "legs": {"<id>": {"bid": 1.2, "ask": 1.25}}                 # quotes for an open spread's legs
}
Paper fills are deliberately pessimistic: halfway between mid and the natural price.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "claudebot", "options_config.json")
LEDGER = os.path.join(ROOT, "docs", "data", "claudebot-options-ledger.json")
CT = ZoneInfo("America/Chicago")


def load(p):
    with open(p) as f:
        return json.load(f)


def save(p, d):
    with open(p, "w") as f:
        json.dump(d, f, indent=1)
        f.write("\n")


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(d):
    return d.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def c2(x):
    return round(x + 1e-9, 2)


def equity(ledger):
    return round(ledger["startingAccountUsd"] + sum(t["pnlUsd"] for t in ledger["trades"]), 2)


def spread_debit(legs, pos):
    """Pessimistic cost to buy the spread back now."""
    s, l = legs[pos["shortId"]], legs[pos["longId"]]
    mid = (s["bid"] + s["ask"]) / 2 - (l["bid"] + l["ask"]) / 2
    natural = s["ask"] - l["bid"]
    return c2(max(0.0, (mid + natural) / 2))


def plan(facts, cfg, ledger):
    now = ts(facts["now"])
    local = now.astimezone(CT)
    e, x, r = cfg["entry"], cfg["exit"], cfg["risk"]

    def none(reason):
        return dict(actions=[dict(do="none", reason=reason)])

    if not facts.get("marketOpen"):
        return none("market closed")
    pos = ledger.get("open")
    S = float(facts["underlying"]["price"])

    # ---------------- manage the open spread
    if pos:
        legs = facts.get("legs") or {}
        if pos["shortId"] not in legs or pos["longId"] not in legs:
            return dict(actions=[dict(do="need_leg_quotes", ids=[pos["shortId"], pos["longId"]])])
        debit = spread_debit(legs, pos)
        dte = (date.fromisoformat(pos["expiration"]) - local.date()).days
        why = None
        if debit <= c2(pos["credit"] * (1 - x["takeProfitPctOfCredit"] / 100)):
            why = "take profit"
        elif debit >= c2(pos["credit"] * x["stopAtMultipleOfCredit"]):
            why = "stop"
        elif S < pos["shortStrike"]:
            why = "short strike breached"
        elif dte <= x["closeAtDte"] and local.time() >= time(13, 0):
            why = "close before expiry"
        if why:
            return dict(actions=[dict(do="close_spread", debit=debit, reason=why,
                                      shortId=pos["shortId"], longId=pos["longId"])])
        pnl_now = c2((pos["credit"] - debit) * 100)
        return none(f"holding {pos['label']}: buy-back {debit} vs credit {pos['credit']} ({pnl_now:+.2f} USD), {dte} DTE")

    # ---------------- look for an entry
    if not cfg.get("enabled", True):
        return none("options bot disabled")
    start, end = (time.fromisoformat(t) for t in e["entryWindowCT"])
    if not (start <= local.time() <= end):
        return none("outside entry window")
    eq = equity(ledger)
    if eq < r["pauseBelowAccountValueUsd"]:
        return none(f"paper account {eq} below pause floor")
    last = (ledger.get("trades") or [None])[-1]
    if last and last["pnlUsd"] < 0 and now - ts(last["exitedAt"]) < timedelta(days=r["cooldownDaysAfterLoss"]):
        return none("cooling down after a loss")
    sma = float(facts["underlying"]["sma20"])
    if e["trendFilter"] and S <= sma:
        return none(f"{cfg['underlying']} {S} not above its 20-day average {sma:.2f}")

    exps = [d for d in facts.get("expirations", [])
            if e["minDte"] <= (date.fromisoformat(d) - local.date()).days <= e["maxDte"]]
    if not exps:
        return none("no expiration in the 7-16 day window")
    exp = min(exps, key=lambda d: abs((date.fromisoformat(d) - local.date()).days - e["targetDte"]))

    cands = [c for c in facts.get("candidates", []) if c["expiration"] == exp]
    if not cands:
        lo, hi = math.floor(S * 0.955), math.floor(S * 0.985)
        return dict(actions=[dict(do="need_contracts", expiration=exp, type="put",
                                  strikes=list(range(hi, lo - 1, -1)))])
    by_strike = {float(c["strike"]): c for c in cands}
    w = e["widthUsd"]
    for K in sorted(by_strike, reverse=True):
        sh = by_strike[K]
        if sh.get("delta") is None or abs(float(sh["delta"])) > e["maxShortDelta"]:
            continue
        lg = by_strike.get(K - w)
        if not lg:
            continue
        if sh["ask"] - sh["bid"] > e["maxLegSpreadUsd"] or lg["ask"] - lg["bid"] > e["maxLegSpreadUsd"]:
            return none(f"{K} put spread quotes too wide")
        mid = (sh["bid"] + sh["ask"]) / 2 - (lg["bid"] + lg["ask"]) / 2
        natural = sh["bid"] - lg["ask"]
        credit = c2((mid + natural) / 2)
        if credit < e["minCreditUsd"]:
            return none(f"{K}/{K - w} credit {credit} below {e['minCreditUsd']}")
        max_loss = c2((w - credit) * 100)
        if max_loss > eq * r["maxLossPctOfAccount"] / 100:
            return none(f"max loss {max_loss} too big for paper account {eq}")
        return dict(actions=[dict(
            do="open_spread", underlying=cfg["underlying"], expiration=exp,
            shortStrike=K, longStrike=K - w, shortId=sh["id"], longId=lg["id"],
            credit=credit, limitPrice=c2(mid), maxLossUsd=max_loss,
            shortDelta=float(sh["delta"]), underlyingPrice=S,
            label=f"{cfg['underlying']} {exp[5:]} {K:g}/{K - w:g}P")])
    return none("no strike at or below the delta limit with a 1-wide partner")


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("facts")
    p = sub.add_parser("snapshot"); p.add_argument("facts")
    p = sub.add_parser("open"); p.add_argument("--json", required=True)
    p = sub.add_parser("close"); p.add_argument("--debit", type=float, required=True); p.add_argument("--reason", required=True)
    p = sub.add_parser("log"); p.add_argument("--action", required=True); p.add_argument("--detail", default="")
    a = ap.parse_args(argv)
    cfg, led = load(CONFIG), load(LEDGER)
    now = datetime.now(timezone.utc)

    def log(action, detail):
        led.setdefault("runs", []).append(dict(t=iso(now), action=action, detail=detail))
        led["runs"] = led["runs"][-72:]

    if a.cmd == "plan":
        print(json.dumps(plan(load(a.facts), cfg, led), indent=1))
        return 0
    if a.cmd == "open":
        if led.get("open"):
            print("ERROR: spread already open", file=sys.stderr); return 2
        o = json.loads(a.json)
        led["open"] = {k: o[k] for k in ("underlying", "expiration", "shortStrike", "longStrike", "shortId", "longId",
                                          "credit", "maxLossUsd", "shortDelta", "underlyingPrice", "label")}
        led["open"]["enteredAt"] = iso(now)
        led["startedAt"] = led.get("startedAt") or iso(now)
        log("open", f"{led['mode'].upper()}: sold {o['label']} for {o['credit']} credit (max loss ${o['maxLossUsd']}, delta {o['shortDelta']})")
        save(LEDGER, led); print(json.dumps(led["open"])); return 0
    if a.cmd == "close":
        pos = led.get("open")
        if not pos:
            print("ERROR: nothing open", file=sys.stderr); return 2
        pnl = c2((pos["credit"] - a.debit) * 100 - cfg["model"]["feesPerRoundTrip"])
        led["trades"].append(dict(label=pos["label"], enteredAt=pos["enteredAt"], exitedAt=iso(now), credit=pos["credit"],
                                  debit=a.debit, pnlUsd=pnl, reason=a.reason,
                                  holdDays=round((now - ts(pos["enteredAt"])).total_seconds() / 86400, 1)))
        led["open"] = None
        led.setdefault("snapshots", []).append(dict(t=iso(now), equity=equity(led)))
        log("close", f"{led['mode'].upper()}: bought back {pos['label']} at {a.debit} ({pnl:+.2f} USD, {a.reason})")
        save(LEDGER, led); print(json.dumps(led["trades"][-1])); return 0
    if a.cmd == "snapshot":
        f = load(a.facts)
        eqv = equity(led)
        pos = led.get("open")
        if pos and pos["shortId"] in (f.get("legs") or {}) and pos["longId"] in f["legs"]:
            eqv = c2(eqv + (pos["credit"] - spread_debit(f["legs"], pos)) * 100)
        led.setdefault("snapshots", []).append(dict(t=iso(now), equity=eqv))
        led["snapshots"] = led["snapshots"][-2000:]
        save(LEDGER, led); print("snapshot", eqv); return 0
    if a.cmd == "log":
        log(a.action, a.detail); save(LEDGER, led); return 0


if __name__ == "__main__":
    sys.exit(main())
