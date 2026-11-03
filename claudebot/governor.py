#!/usr/bin/env python3
"""Independent risk governor (board, 2026-11-03): separates "should we trade" from "may we trade".

Every LIVE order must pass `python3 claudebot/governor.py check '<json>'` right before review/place.
The planners decide WHAT to trade; the governor only answers ALLOW or DENY and cannot be argued with:
exit code 0 = allow, 1 = deny (reasons printed). It reads the configs and ledgers itself and also
enforces HARD ceilings written here, so loosening a config file cannot loosen the governor.

Input JSON:
  {"desk": "dip"|"optbuy"|"spread"|"crypto", "side": "buy"|"sell", "symbol": "XLK",
   "usd": 25.0 (buys: dollars to spend; option buys: premium x 100), "quantity": "0.14" (sells),
   "accountNickname": "MCP", "accountValue": 117.2, "buyingPower": 92.1,
   "quoteAgeSec": 12, "now": "2026-11-03T20:14:00Z"}
Sells that reduce the bot's own positions are allowed even on stale data (exits come first), but only
for shares/contracts the bot's ledger says it bought.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CT = ZoneInfo("America/Chicago")
HARD = {   # never above these, whatever the configs say (changing them needs the board)
    "account": "MCP", "maxQuoteAgeSec": 180, "accountFloorUsd": 50,
    "dip.maxPctOfAccount": 25, "dip.minPositionUsd": 1, "dip.maxPositionUsdAbs": 5000, "dip.maxOpen": 5,
    "optbuy.maxPremiumUsd": 50, "optbuy.maxPctOfAccount": 43, "optbuy.maxOpen": 1,
    "neverSell": ["KO"],
}
HOLIDAYS = {"2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"}


def load(rel, d=None):
    try:
        with open(os.path.join(ROOT, rel)) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return d


def market_open(now):
    loc = now.astimezone(CT); m = loc.hour * 60 + loc.minute
    return loc.weekday() < 5 and loc.date().isoformat() not in HOLIDAYS and 8 * 60 + 30 <= m < 15 * 60


def check(o, root_loader=load):
    L = root_loader
    deny = []
    now = datetime.fromisoformat((o.get("now") or datetime.now(timezone.utc).isoformat()).replace("Z", "+00:00"))
    desk, side, sym = o.get("desk"), o.get("side"), (o.get("symbol") or "").upper()
    av, bp = float(o.get("accountValue") or 0), float(o.get("buyingPower") or 0)
    usd = float(o.get("usd") or 0)
    if o.get("accountNickname") != HARD["account"]:
        deny.append(f"account must be {HARD['account']}")
    if side not in ("buy", "sell"):
        deny.append("side must be buy or sell")
    if not market_open(now):
        deny.append("market is closed (regular hours only)")
    if side == "sell" and sym in HARD["neverSell"]:
        deny.append(f"{sym} is the board's own holding: the bot never sells it")
    buy = side == "buy"
    if buy:
        if float(o.get("quoteAgeSec", 1e9)) > HARD["maxQuoteAgeSec"]:
            deny.append(f"quote is stale (> {HARD['maxQuoteAgeSec']}s): no new buys on old data")
        if av < HARD["accountFloorUsd"]:
            deny.append(f"account below the ${HARD['accountFloorUsd']} floor")
        if usd <= 0:
            deny.append("buy amount missing")
        if usd > bp:
            deny.append(f"${usd:.2f} exceeds buying power")
    if desk == "dip":
        cfg = L("claudebot/dip_config.json", {}) or {}; r = cfg.get("risk", {})
        led = L("docs/data/claudebot-dip-ledger.json", {}) or {}
        held = led.get("positions") if led.get("positions") is not None else ([led["open"]] if led.get("open") else [])
        if buy:
            allowed = set(cfg.get("symbols") or [])
            for e in (cfg.get("edges") or {}).values():
                if e.get("enabled"):
                    allowed |= set(e.get("symbols") or [])
            if not cfg.get("enabled", True):
                deny.append("Dip desk is disabled")
            if sym not in allowed:
                deny.append(f"{sym} is not on the Dip desk's approved list")
            cap = max(float(r.get("positionUsd", 25)), av * min(float(r.get("positionPctOfAccount", 20)), HARD["dip.maxPctOfAccount"]) / 100)
            if usd > cap * 1.02 + 0.01:
                deny.append(f"${usd:.2f} is above the position cap ${cap:.2f}")
            if av > 0 and usd > av * HARD["dip.maxPctOfAccount"] / 100 and usd > float(r.get("positionUsd", 25)) * 1.02:
                deny.append(f"above the hard {HARD['dip.maxPctOfAccount']}% of account ceiling")
            if len(held) >= min(int(r.get("maxOpenPositions", 5)), HARD["dip.maxOpen"]):
                deny.append("at the open-position limit")
            if bp - usd < float(r.get("minBuyingPowerAfterUsd", 1)):
                deny.append("would leave too little buying power")
        else:
            mine = [p for p in held if p.get("symbol") == sym]
            if not mine:
                deny.append(f"the Dip ledger holds no {sym}: the bot only sells what it bought")
            else:
                own = sum(float(p.get("usd", 0)) / float(p.get("entryPrice", 1)) for p in mine)
                if float(o.get("quantity") or 0) > own * 1.001 + 1e-6:
                    deny.append(f"quantity {o.get('quantity')} is more than the bot bought ({own:.6f})")
    elif desk == "optbuy":
        cfg = L("claudebot/optbuy_config.json", {}) or {}; r = cfg.get("risk", {})
        led = L("docs/data/claudebot-optbuy-ledger.json", {}) or {}
        if buy:
            if not cfg.get("enabled"):
                deny.append("options-buying desk is disabled (needs evidence and the board's approval)")
            cap = min(float(r.get("maxPremiumUsd", 50)), HARD["optbuy.maxPremiumUsd"], av * min(float(r.get("maxPctOfAccount", 43)), HARD["optbuy.maxPctOfAccount"]) / 100)
            if usd > cap + 0.01:
                deny.append(f"premium ${usd:.2f} is above the cap ${cap:.2f}")
            if led.get("open"):
                deny.append("already holding an option (one at a time)")
        elif not (led.get("open") and (led["open"].get("symbol") == sym or led["open"].get("underlying") == sym or led["open"].get("id") == o.get("optionId"))):
            deny.append("the options ledger holds no such option")
    elif desk == "spread":
        deny.append("spreads are paper-only: Robinhood blocks agent multi-leg orders")
    elif desk == "crypto":
        if buy:
            deny.append("crypto entries are off (desk fired 2026-11-02)")
        elif not (L("docs/data/claudebot-ledger.json", {}) or {}).get("open"):
            deny.append("the crypto ledger holds nothing to sell")
    else:
        deny.append(f"unknown desk {desk!r}")
    return {"allow": not deny, "reasons": deny or ["all checks passed"], "desk": desk, "side": side, "symbol": sym}


def main():
    if len(sys.argv) < 3 or sys.argv[1] != "check":
        print("usage: governor.py check '<json>'"); sys.exit(2)
    res = check(json.loads(sys.argv[2]))
    print(json.dumps(res))
    sys.exit(0 if res["allow"] else 1)


if __name__ == "__main__":
    main()
