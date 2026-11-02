#!/usr/bin/env python3
"""ClaudeBot Dip desk: buy short, sharp dips in index ETFs that are in uptrends.

Rule (from claudebot-dip-backtest.json, chosen on 2023-24 and confirmed on 2025-26):
  BUY  in the last hourly run before the close (14:00-14:59 CT) when RSI(2) < 5 and price > 200-day SMA
  SELL in that same window on a later day when price > 5-day SMA or RSI(2) > 70, or after 10 trading days
  STOP any run on a later day if price <= entry * (1 - 5%)
Up to maxOpenPositions at once (one per ETF), $25 fractional market orders; when the options desk is flat,
enough cash stays free for it to open its spread. Never sells shares it didn't buy.

  python claudebot/dip_bot.py plan dfacts.json
  python claudebot/dip_bot.py open  --symbol SPY --price 741.2 --usd 25.00
  python claudebot/dip_bot.py close --symbol SPY --price 752.1 --reason bounce
  python claudebot/dip_bot.py log   --action hold --detail "..."

dfacts.json: {"now", "marketOpen", "accountValue", "buyingPower",
              "symbols": {"SPY": {"price": 758.3, "closes": [... >= 201 completed daily closes, oldest first ...],
                                  "heldQty": 0.033}}}     # heldQty = shares_available_for_sells (0 if none)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONFIG = os.path.join(HERE, "dip_config.json")
LEDGER = os.path.join(ROOT, "docs", "data", "claudebot-dip-ledger.json")
CT = ZoneInfo("America/Chicago")


def load(p):
    with open(p) as f:
        return json.load(f)


def save(p, d):
    with open(p, "w") as f:
        json.dump(d, f, indent=1); f.write("\n")


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(d):
    return d.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def rsi2(c):
    g = l = 0.0
    for i in range(1, len(c)):
        d = c[i] - c[i - 1]; up, dn = max(d, 0), max(-d, 0)
        if i <= 2: g += up / 2; l += dn / 2
        else: g = (g + up) / 2; l = (l + dn) / 2
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def sma(c, n):
    return sum(c[-n:]) / n


OPTIONS_LEDGER = os.path.join(ROOT, "docs", "data", "claudebot-options-ledger.json")


def options_open():
    try:
        return bool(load(OPTIONS_LEDGER).get("open"))
    except Exception:  # noqa: BLE001
        return True    # unknown: don't hold cash back, the broker's buying power is the limit


def positions(led):
    if led.get("positions") is not None:
        return led["positions"]
    return [led["open"]] if led.get("open") else []


def save_led(led, ps):
    led["positions"] = ps; led["open"] = ps[0] if ps else None    # "open" kept for the site
    save(LEDGER, led)


def trading_days_between(a: date, b: date):
    n, d = 0, a
    while d < b:
        d = date.fromordinal(d.toordinal() + 1)
        if d.weekday() < 5: n += 1
    return n


def plan(facts, cfg, led):
    now = ts(facts["now"]); local = now.astimezone(CT)
    e, x, r = cfg["entry"], cfg["exit"], cfg["risk"]
    none = lambda why: {"actions": [{"do": "none", "reason": why}]}
    if not facts.get("marketOpen"):
        return none("market closed")
    w0, w1 = (time.fromisoformat(t) for t in e["windowCT"])
    in_window = w0 <= local.time() <= w1
    syms = facts.get("symbols", {})
    held = positions(led)
    holds = []
    for pos in held:                                   # exits first, one action per plan
        s = syms.get(pos["symbol"])
        if not s:
            return {"actions": [{"do": "need_symbol", "symbol": pos["symbol"]}]}
        px, hq = float(s["price"]), float(s.get("heldQty") or 0)
        qty = round(min(hq, pos["usd"] / pos["entryPrice"]), 6)
        if hq <= 0:
            return {"actions": [{"do": "record_broker_close", "symbol": pos["symbol"], "note": "position gone at broker: find the filled sell and record it"}]}
        entered = ts(pos["enteredAt"]).astimezone(CT).date()
        if entered == local.date():
            holds.append(f"{pos['symbol']} bought today (exits start tomorrow)"); continue
        why = None
        if px <= pos["entryPrice"] * (1 - x["stopPct"] / 100):
            why = "stop"
        elif in_window:
            c = [float(v) for v in s["closes"]] + [px]
            if px > sma(c, x["smaBounce"]) or rsi2(c) > x["rsi2Above"]:
                why = "bounce"
            elif trading_days_between(entered, local.date()) >= x["maxHoldDays"]:
                why = "time"
        if why:
            return {"actions": [{"do": "sell", "symbol": pos["symbol"], "quantity": f"{qty:.6f}", "reason": why}]}
        holds.append(f"{pos['symbol']} from {pos['entryPrice']} (now {px}, {100 * (px / pos['entryPrice'] - 1):+.2f}%)")
    def none(why):
        return {"actions": [{"do": "none", "reason": ("holding " + "; ".join(holds) + ". " if holds else "") + why}]}
    if len(held) >= r["maxOpenPositions"]:
        return none(f"at the {r['maxOpenPositions']}-position limit")
    if not cfg.get("enabled", True):
        return none("dip desk disabled")
    if not in_window:
        return none("entries only in the last run before the close (14:00-14:59 CT)")
    if float(facts.get("accountValue", 0)) < r["pauseBelowAccountValueUsd"]:
        return none("account below the pause floor")
    bp = float(facts.get("buyingPower", 0))
    reserve = r["minBuyingPowerAfterUsd"] if options_open() else max(r["minBuyingPowerAfterUsd"], r.get("reserveForOptionsUsd", 0))
    if bp - r["positionUsd"] < reserve:
        return none("not enough free cash" + ("" if options_open() else f" (keeping ${reserve:.0f} free so the options desk can open its spread)"))
    looked = []
    for sym in cfg["symbols"]:
        s = syms.get(sym)
        if sym in {p["symbol"] for p in held}:
            continue
        if not s:
            return {"actions": [{"do": "need_symbol", "symbol": sym}]}
        c = [float(v) for v in s["closes"]][-(e["trendSma"] + 10):] + [float(s["price"])]
        if len(c) < e["trendSma"] + 1:
            looked.append(f"{sym} needs {e['trendSma']} days of history"); continue
        rv, tr = rsi2(c), sma(c, e["trendSma"])
        looked.append(f"{sym} RSI2 {rv:.0f}{'' if c[-1] > tr else ' (below 200d)'}")
        if c[-1] > tr and rv < e["rsi2Below"]:
            return {"actions": [{"do": "buy", "symbol": sym, "dollarAmount": f"{r['positionUsd']:.2f}", "why": f"{sym} RSI(2) {rv:.1f} < {e['rsi2Below']} above its 200-day average"}]}
    return none("no dip today: " + ", ".join(looked))


def main(argv=None):
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("facts")
    p = sub.add_parser("open"); p.add_argument("--symbol", required=True); p.add_argument("--price", type=float, required=True); p.add_argument("--usd", type=float, required=True)
    p = sub.add_parser("close"); p.add_argument("--symbol", required=True); p.add_argument("--price", type=float, required=True); p.add_argument("--reason", required=True)
    p = sub.add_parser("log"); p.add_argument("--action", required=True); p.add_argument("--detail", default="")
    a = ap.parse_args(argv)
    cfg = load(CONFIG)
    led = load(LEDGER) if os.path.exists(LEDGER) else {"schemaVersion": 1, "mode": "live", "open": None, "trades": [], "runs": []}
    now = datetime.now(timezone.utc)
    def log(act, det):
        led.setdefault("runs", []).append({"t": iso(now), "action": act, "detail": det}); led["runs"] = led["runs"][-60:]
    if a.cmd == "plan":
        print(json.dumps(plan(load(a.facts), cfg, led), indent=1)); return 0
    ps = positions(led)
    if a.cmd == "open":
        if any(p_["symbol"] == a.symbol for p_ in ps):
            print(f"ERROR: already holding {a.symbol}", file=sys.stderr); return 2
        if len(ps) >= cfg["risk"]["maxOpenPositions"]:
            print("ERROR: position limit reached", file=sys.stderr); return 2
        ps.append({"symbol": a.symbol, "entryPrice": a.price, "usd": round(a.usd, 2), "enteredAt": iso(now)})
        led["startedAt"] = led.get("startedAt") or iso(now)
        log("buy", f"bought ${a.usd:.2f} of {a.symbol} at {a.price}"); save_led(led, ps); return 0
    if a.cmd == "close":
        p_ = next((x for x in ps if x["symbol"] == a.symbol), None)
        if not p_:
            print(f"ERROR: no open {a.symbol} position", file=sys.stderr); return 2
        ret = 100 * (a.price / p_["entryPrice"] - 1)
        led["trades"].append({"label": p_["symbol"], "symbol": p_["symbol"], "enteredAt": p_["enteredAt"], "exitedAt": iso(now), "entryPrice": p_["entryPrice"],
                              "exitPrice": a.price, "returnPct": round(ret, 3), "pnlUsd": round(p_["usd"] * ret / 100, 2), "reason": a.reason})
        ps.remove(p_); log("sell", f"sold {p_['symbol']} at {a.price} ({ret:+.2f}%, {a.reason})"); save_led(led, ps); return 0
    if a.cmd == "log":
        log(a.action, a.detail); save(LEDGER, led); return 0


if __name__ == "__main__":
    sys.exit(main())
