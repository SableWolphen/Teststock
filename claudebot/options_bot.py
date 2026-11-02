#!/usr/bin/env python3
"""ClaudeBot options: put credit spreads on a small list of ETFs with $1 strikes.

Same pattern as bot.py: the hourly Claude run gathers live Robinhood facts, this
script decides, Claude carries out the orders (live) or records them (paper).

  python claudebot/options_bot.py plan facts.json
  python claudebot/options_bot.py open  --json '<the open_spread action>' [--credit <actual fill>]
  python claudebot/options_bot.py close --debit 0.07 --reason "take profit"
  python claudebot/options_bot.py log   --action hold --detail "..."
  python claudebot/options_bot.py snapshot facts.json

facts.json:
{
  "now": "2026-11-02T15:14:00Z",
  "marketOpen": true,
  "accountValue": 117.27,            # live mode: get_portfolio total_value
  "buyingPower": 112.97,             # live mode: get_portfolio buying_power
  "underlyings": {"SPY": {"price": 758.3, "closes": [... last 21 daily closes, oldest first ...],
                          "expirations": ["2026-11-06", ...]}},
  "candidates": [{"symbol": "SPY", "id": "...", "strike": 729, "expiration": "2026-11-13",
                  "bid": 1.84, "ask": 1.88, "delta": -0.22}],
  "legs": {"<id>": {"bid": 1.2, "ask": 1.25}}
}
Entry and exit prices for the decision are deliberately pessimistic: halfway between
mid and the natural price.
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


def realized_pnl(ledger):
    return round(sum(t["pnlUsd"] for t in ledger["trades"]), 2)


def paper_equity(ledger):
    return round((ledger.get("startingAccountUsd") or 0) + realized_pnl(ledger), 2)


def spread_debit(legs, pos):
    """Pessimistic cost to buy the spread back now."""
    s, l = legs[pos["shortId"]], legs[pos["longId"]]
    mid = (s["bid"] + s["ask"]) / 2 - (l["bid"] + l["ask"]) / 2
    natural = s["ask"] - l["bid"]
    return c2(max(0.0, (mid + natural) / 2))


def ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def est_strikes(S, closes, dte, max_delta, n_above=2, n_below=4):
    """Estimate the integer strike near the target put delta from realized vol."""
    rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    rv = (sum(r * r for r in rets) / max(len(rets), 1) * 252) ** 0.5
    T = max(dte, 1) / 365
    K = math.floor(S)
    while K > S * 0.85:
        sig = max(rv * 1.2, 0.10) * (1 + 1.5 * max(0.0, math.log(S / K)))
        d1 = (math.log(S / K) + sig * sig / 2 * T) / (sig * math.sqrt(T))
        if abs(ncdf(d1) - 1) <= max_delta:
            break
        K -= 1
    return list(range(K + n_above, K - n_below - 1, -1))


def plan(facts, cfg, ledger):
    now = ts(facts["now"])
    local = now.astimezone(CT)
    e, x, r = cfg["entry"], cfg["exit"], cfg["risk"]
    live = ledger.get("mode") == "live"

    def none(reason):
        return dict(actions=[dict(do="none", reason=reason)])

    if not facts.get("marketOpen"):
        return none("market closed")
    unders = facts.get("underlyings") or {}
    pos = ledger.get("open")

    # ---------------- manage the open spread first
    if pos:
        legs = facts.get("legs") or {}
        u = unders.get(pos["underlying"])
        if not u:
            return dict(actions=[dict(do="need_underlying", symbol=pos["underlying"])])
        if pos["shortId"] not in legs or pos["longId"] not in legs:
            return dict(actions=[dict(do="need_leg_quotes", ids=[pos["shortId"], pos["longId"]])])
        S = float(u["price"])
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
            return dict(actions=[dict(do="close_spread", debit=debit, limitPrice=c2(min(debit + 0.02, pos["width"])),
                                      reason=why, underlying=pos["underlying"],
                                      shortId=pos["shortId"], longId=pos["longId"])])
        pnl_now = c2((pos["credit"] - debit) * 100)
        return none(f"holding {pos['label']}: buy-back {debit} vs credit {pos['credit']} ({pnl_now:+.2f} USD), {dte} DTE")

    # ---------------- look for an entry
    if not cfg.get("enabled", True):
        return none("options bot disabled")
    start, end = (time.fromisoformat(t) for t in e["entryWindowCT"])
    if not (start <= local.time() <= end):
        return none("outside entry window")
    eq = float(facts["accountValue"]) if live else paper_equity(ledger)
    bp = float(facts.get("buyingPower", eq)) if live else eq
    if eq < r["pauseBelowAccountValueUsd"]:
        return none(f"account {eq} below pause floor {r['pauseBelowAccountValueUsd']}")
    last = (ledger.get("trades") or [None])[-1]
    if last and last["pnlUsd"] < 0 and now - ts(last["exitedAt"]) < timedelta(days=r["cooldownDaysAfterLoss"]):
        return none("cooling down after a loss")

    reasons = []
    w = e["widthUsd"]
    for sym in cfg["underlyings"]:
        u = unders.get(sym)
        if not u:
            return dict(actions=[dict(do="need_underlying", symbol=sym)])
        S, closes = float(u["price"]), [float(c) for c in u["closes"]]
        sma = sum(closes[-20:]) / min(20, len(closes))
        if e["trendFilter"] and S <= sma:
            reasons.append(f"{sym} below 20-day avg")
            continue
        exps = [d for d in u.get("expirations", [])
                if e["minDte"] <= (date.fromisoformat(d) - local.date()).days <= e["maxDte"]]
        if not exps:
            reasons.append(f"{sym} no 7-16 day expiry")
            continue
        exp = min(exps, key=lambda d: abs((date.fromisoformat(d) - local.date()).days - e["targetDte"]))
        cands = [c for c in facts.get("candidates", []) if c["symbol"] == sym and c["expiration"] == exp]
        if not cands:
            dte = (date.fromisoformat(exp) - local.date()).days
            return dict(actions=[dict(do="need_contracts", symbol=sym, expiration=exp, type="put",
                                      strikes=est_strikes(S, closes, dte, e["maxShortDelta"]))])
        by_strike = {float(c["strike"]): c for c in cands}
        found = None
        for K in sorted(by_strike, reverse=True):
            sh = by_strike[K]
            if sh.get("delta") is None or abs(float(sh["delta"])) > e["maxShortDelta"]:
                continue
            lg = by_strike.get(K - w)
            if not lg:
                continue
            found = (K, sh, lg)
            break
        if not found:
            hi = max(by_strike)
            if by_strike[hi].get("delta") is not None and abs(float(by_strike[hi]["delta"])) <= e["maxShortDelta"]:
                # our strike guess was too low: fetch a few strikes higher
                return dict(actions=[dict(do="need_contracts", symbol=sym, expiration=exp, type="put",
                                          strikes=[int(hi) + k for k in (3, 2, 1)])])
            reasons.append(f"{sym} no $1-wide pair at delta <= {e['maxShortDelta']}")
            continue
        K, sh, lg = found
        if sh["ask"] - sh["bid"] > e["maxLegSpreadUsd"] or lg["ask"] - lg["bid"] > e["maxLegSpreadUsd"]:
            reasons.append(f"{sym} {K:g} quotes too wide")
            continue
        mid = (sh["bid"] + sh["ask"]) / 2 - (lg["bid"] + lg["ask"]) / 2
        natural = sh["bid"] - lg["ask"]
        credit = c2((mid + natural) / 2)
        if credit < e["minCreditUsd"]:
            reasons.append(f"{sym} {K:g}/{K - w:g} credit {credit} < {e['minCreditUsd']}")
            continue
        max_loss = c2((w - credit) * 100)
        if max_loss > eq * r["maxLossPctOfAccount"] / 100 or max_loss > bp:
            reasons.append(f"{sym} max loss ${max_loss} too big for the account")
            continue
        return dict(actions=[dict(
            do="open_spread", underlying=sym, expiration=exp, width=w,
            shortStrike=K, longStrike=K - w, shortId=sh["id"], longId=lg["id"],
            credit=credit, limitPrice=c2(mid), minAcceptableCredit=credit, maxLossUsd=max_loss,
            shortDelta=float(sh["delta"]), underlyingPrice=S,
            label=f"{sym} {exp[5:]} {K:g}/{K - w:g}P")])
    return none("; ".join(reasons) or "no candidates")


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("facts")
    p = sub.add_parser("snapshot"); p.add_argument("facts")
    p = sub.add_parser("open"); p.add_argument("--json", required=True); p.add_argument("--credit", type=float)
    p = sub.add_parser("close"); p.add_argument("--debit", type=float, required=True); p.add_argument("--reason", required=True)
    p = sub.add_parser("log"); p.add_argument("--action", required=True); p.add_argument("--detail", default="")
    a = ap.parse_args(argv)
    cfg, led = load(CONFIG), load(LEDGER)
    now = datetime.now(timezone.utc)
    mode = led.get("mode", "paper").upper()

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
        keep = ("underlying", "expiration", "width", "shortStrike", "longStrike", "shortId", "longId",
                "credit", "maxLossUsd", "shortDelta", "underlyingPrice", "label")
        led["open"] = {k: o[k] for k in keep}
        if a.credit is not None:
            led["open"]["credit"] = a.credit
            led["open"]["maxLossUsd"] = c2((o["width"] - a.credit) * 100)
        led["open"]["enteredAt"] = iso(now)
        led["startedAt"] = led.get("startedAt") or iso(now)
        p_ = led["open"]
        log("open", f"{mode}: sold {p_['label']} for {p_['credit']} credit (max loss ${p_['maxLossUsd']}, delta {p_['shortDelta']})")
        save(LEDGER, led); print(json.dumps(p_)); return 0
    if a.cmd == "close":
        pos = led.get("open")
        if not pos:
            print("ERROR: nothing open", file=sys.stderr); return 2
        pnl = c2((pos["credit"] - a.debit) * 100 - cfg["model"]["feesPerRoundTrip"])
        led["trades"].append(dict(label=pos["label"], underlying=pos["underlying"], mode=led.get("mode", "paper"),
                                  enteredAt=pos["enteredAt"], exitedAt=iso(now), credit=pos["credit"],
                                  debit=a.debit, pnlUsd=pnl, reason=a.reason,
                                  holdDays=round((now - ts(pos["enteredAt"])).total_seconds() / 86400, 1)))
        led["open"] = None
        led.setdefault("snapshots", []).append(dict(t=iso(now), pnlUsd=realized_pnl(led)))
        log("close", f"{mode}: bought back {pos['label']} at {a.debit} ({pnl:+.2f} USD, {a.reason})")
        save(LEDGER, led); print(json.dumps(led["trades"][-1])); return 0
    if a.cmd == "snapshot":
        f = load(a.facts)
        v = realized_pnl(led)
        pos = led.get("open")
        if pos and pos["shortId"] in (f.get("legs") or {}) and pos["longId"] in f["legs"]:
            v = c2(v + (pos["credit"] - spread_debit(f["legs"], pos)) * 100)
        led.setdefault("snapshots", []).append(dict(t=iso(now), pnlUsd=v))
        led["snapshots"] = led["snapshots"][-2000:]
        save(LEDGER, led); print("snapshot", v); return 0
    if a.cmd == "log":
        log(a.action, a.detail); save(LEDGER, led); return 0


if __name__ == "__main__":
    sys.exit(main())
