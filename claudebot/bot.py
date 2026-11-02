#!/usr/bin/env python3
"""ClaudeBot executor brain + ledger.

The scheduled Claude run gathers live Robinhood facts with the Robinhood MCP
tools, then asks this script what to do. All trading rules live here (pure,
testable). Claude only executes the returned actions and records results.

  python claudebot/bot.py plan  facts.json          -> JSON list of actions
  python claudebot/bot.py entry --symbol SOL --price 187.12 --dollars 12.30 --account-value 17.26
  python claudebot/bot.py set-stop --price 183.50
  python claudebot/bot.py exit  --price 191.02 --reason target
  python claudebot/bot.py snapshot facts.json       -> append equity point
  python claudebot/bot.py log   --action buy --detail "..."

facts.json shape (filled in by the executor from Robinhood each run):
{
  "now": "2026-11-02T03:12:00Z",
  "accountValue": 17.26,          # get_portfolio total_value
  "cryptoBuyingPower": 12.97,     # get_portfolio crypto_buying_power
  "positions": {"SOL": 0.0651},   # get_crypto_positions quantity_transferable (+ held_for_sell)
  "openOrders": [{"id": "...", "symbol": "SOL", "side": "sell", "type": "stop_loss",
                  "stopPrice": 183.5, "quantity": 0.0651}],
  "quotes": {"SOL": {"bid": 187.0, "ask": 187.4}}
}
Account numbers, balances and order ids never get written to the public ledger.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "claudebot", "config.json")
SIGNAL = os.path.join(ROOT, "docs", "data", "claudebot-signal.json")
LEDGER = os.path.join(ROOT, "docs", "data", "claudebot-ledger.json")
DUST_USD = 1.0
MAX_SNAPSHOTS = 24 * 120
MAX_RUNS = 72


def load(p):
    with open(p) as f:
        return json.load(f)


def save(p, d):
    with open(p, "w") as f:
        json.dump(d, f, indent=1)
        f.write("\n")


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def px(p: float) -> float:
    """Round a price to a sane crypto tick."""
    if p >= 1000:
        return round(p, 2)
    if p >= 1:
        return round(p, 4)
    return round(p, 6)


def coin(signal: dict, sym: str) -> dict | None:
    return next((c for c in signal.get("coins", []) if c["symbol"] == sym), None)


# ------------------------------------------------------------------ planning
def plan(facts: dict, cfg: dict, signal: dict, ledger: dict) -> dict:
    now = ts(facts["now"])
    risk, strat = cfg["risk"], cfg["strategy"]
    cost = cfg["costs"]["roundTripPct"] / 100
    actions: list[dict] = []
    notes: list[str] = []
    pos = ledger.get("open")
    quotes = facts.get("quotes", {})
    orders = [o for o in facts.get("openOrders", [])]

    # ---------- manage an open position first (exits before entries)
    if pos:
        sym = pos["symbol"]
        qty = float(facts.get("positions", {}).get(sym, 0) or 0)
        q = quotes.get(sym)
        if q is None:
            return dict(actions=[dict(do="need_quote", symbol=sym)], notes=["quote missing for held coin"])
        bid = float(q["bid"])
        sym_orders = [o for o in orders if o["symbol"] == sym]
        sells = [o for o in sym_orders if o["side"] == "sell"]
        if qty * bid < DUST_USD:
            if sells:
                return dict(actions=[dict(do="wait", reason=f"{sym} sell order working")], notes=notes)
            return dict(actions=[dict(do="record_stop_exit", symbol=sym, fallbackPrice=pos["stop"],
                                      reason="position gone: stop order filled (look up its average fill price)")],
                        notes=notes)

        c = coin(signal, sym) or {}
        held_h = (now - ts(pos["enteredAt"])).total_seconds() / 3600
        exit_reason = None
        if bid <= pos["stop"]:
            exit_reason = "stop (price through stop)"
        elif bid >= pos["target"]:
            exit_reason = "target"
        elif held_h >= strat["maxHoldHours"]:
            exit_reason = f"time ({held_h:.0f}h)"
        elif c.get("exitSignal") and c.get("barTime") and ts(c["barTime"]) > ts(pos["enteredAt"]):
            exit_reason = "trend break (closed below EMA50)"

        if exit_reason:
            for o in sells:
                actions.append(dict(do="cancel", orderId=o["id"], why="free coins for exit"))
            actions.append(dict(do="sell_market", symbol=sym, quantity=qty, reason=exit_reason))
            return dict(actions=actions, notes=notes)

        desired = pos["stop"]
        if bid >= pos["entryPrice"] + strat["breakevenAfterAtr"] * pos["atr"]:
            be = px(pos["entryPrice"] * (1 + cost / 2))
            if be > desired:
                desired = be
                notes.append("moving stop to breakeven")
        stops = [o for o in sells if o["type"] in ("stop_loss", "stop_limit")]
        good = [o for o in stops if abs(float(o.get("stopPrice") or 0) - desired) / desired < 0.001
                and float(o.get("quantity") or 0) >= qty * 0.999]
        if good and len(stops) == 1:
            actions.append(dict(do="none", reason=f"holding {sym}: bid {bid}, stop {desired}, target {pos['target']}, {held_h:.1f}h"))
        else:
            for o in sells:
                actions.append(dict(do="cancel", orderId=o["id"], why="replace stop"))
            actions.append(dict(do="place_stop", symbol=sym, quantity=qty, stopPrice=px(desired)))
        return dict(actions=actions, notes=notes)

    # ---------- look for a new entry
    def skip(reason):
        return dict(actions=[dict(do="none", reason=reason)], notes=notes)

    if not cfg.get("enabled", True):
        return skip("bot disabled in claudebot/config.json")
    gen = signal.get("generatedAt")
    if not gen or (now - ts(gen)) > timedelta(minutes=risk["signalMaxAgeMinutes"]):
        return skip(f"signal stale (generated {gen})")
    if signal.get("regime", {}).get("riskOff"):
        return skip("market risk-off (BTC downtrend) - staying in cash")
    best = signal.get("bestCandidate")
    if not best:
        top = (signal.get("coins") or [{}])[0]
        return skip(f"no setup this hour (closest: {top.get('symbol')} - {', '.join(top.get('blockers', [])[:1])})")
    if facts["accountValue"] < risk["pauseNewEntriesBelowAccountValueUsd"]:
        return skip(f"account below ${risk['pauseNewEntriesBelowAccountValueUsd']} floor - entries paused")

    snaps = [s for s in ledger.get("snapshots", []) if now - ts(s["t"]) <= timedelta(hours=24)]
    if snaps:
        peak = max(s["index"] for s in snaps)
        dd = 100 * (ledger["equityIndex"] / peak - 1)
        if dd <= -risk["dailyLossLimitPct"]:
            return skip(f"24h loss limit hit ({dd:.1f}%) - no new entries")
    last = (ledger.get("trades") or [None])[-1]
    if last and last["returnPct"] < 0 and now - ts(last["exitedAt"]) < timedelta(hours=risk["cooldownHoursAfterLoss"]):
        return skip("cooling down after a losing trade")
    non_dust = [s for s, qn in facts.get("positions", {}).items()
                if s in quotes and float(qn) * float(quotes[s]["bid"]) >= DUST_USD]
    if non_dust:
        return skip(f"untracked crypto holding {non_dust} - not opening another position")

    c = coin(signal, best)
    q = quotes.get(best)
    if q is None:
        return dict(actions=[dict(do="need_quote", symbol=best)], notes=notes)
    bid, ask = float(q["bid"]), float(q["ask"])
    spread = 100 * (ask - bid) / ((ask + bid) / 2)
    if spread > risk["maxSpreadPct"]:
        return skip(f"{best} spread {spread:.2f}% too wide")
    chase = 100 * (ask / c["lastClose"] - 1)
    if chase > risk["maxChasePctAboveSignalClose"]:
        return skip(f"{best} ran {chase:.1f}% past the signal - not chasing")
    dollars = math.floor(facts["cryptoBuyingPower"] * risk["positionPctOfCryptoBuyingPower"]) / 100
    if dollars < risk["minOrderUsd"]:
        return skip(f"only ${dollars:.2f} crypto buying power")
    return dict(actions=[dict(
        do="buy_market", symbol=best, dollarAmount=f"{dollars:.2f}",
        why=f"{best} setup: score {c['score']}, RSI {c['rsi']}, trend {c['trend']}, spread {spread:.2f}%",
        atr=c["atr"])], notes=notes)


# ------------------------------------------------------------------ ledger ops
def mark_index(ledger: dict, facts: dict | None) -> float:
    pos = ledger.get("open")
    if not pos or not facts:
        return ledger["equityIndex"]
    q = facts.get("quotes", {}).get(pos["symbol"])
    if not q:
        return ledger["equityIndex"]
    r = float(q["bid"]) / pos["entryPrice"] - 1
    return round(ledger["equityIndex"] * (1 + pos["allocationPct"] / 100 * r), 4)


def log_run(ledger, action, detail, now=None):
    ledger.setdefault("runs", []).append(dict(t=iso(now or datetime.now(timezone.utc)), action=action, detail=detail))
    ledger["runs"] = ledger["runs"][-MAX_RUNS:]


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("facts")
    p = sub.add_parser("snapshot"); p.add_argument("facts")
    p = sub.add_parser("entry")
    for a in ("--symbol", "--price", "--dollars", "--account-value"):
        p.add_argument(a, required=True)
    p.add_argument("--atr")
    p = sub.add_parser("set-stop"); p.add_argument("--price", required=True, type=float)
    p = sub.add_parser("exit"); p.add_argument("--price", required=True, type=float); p.add_argument("--reason", required=True)
    p = sub.add_parser("log"); p.add_argument("--action", required=True); p.add_argument("--detail", default="")
    a = ap.parse_args(argv)

    cfg, ledger = load(CONFIG), load(LEDGER)
    signal = load(SIGNAL) if os.path.exists(SIGNAL) else {}
    now = datetime.now(timezone.utc)

    if a.cmd == "plan":
        print(json.dumps(plan(load(a.facts), cfg, signal, ledger), indent=1))
        return 0

    if a.cmd == "snapshot":
        facts = load(a.facts)
        ledger.setdefault("snapshots", []).append(dict(t=iso(now), index=mark_index(ledger, facts)))
        ledger["snapshots"] = ledger["snapshots"][-MAX_SNAPSHOTS:]
        ledger["startedAt"] = ledger.get("startedAt") or iso(now)
        save(LEDGER, ledger)
        print("snapshot", ledger["snapshots"][-1])
        return 0

    if a.cmd == "entry":
        if ledger.get("open"):
            print("ERROR: a position is already open in the ledger", file=sys.stderr)
            return 2
        sym = a.symbol.upper()
        price = float(a.price)
        c = coin(signal, sym) or {}
        atr = float(a.atr) if a.atr else float(c["atr"])
        alloc = min(100.0, 100 * float(a.dollars) / float(a.account_value))
        s = cfg["strategy"]
        ledger["open"] = dict(symbol=sym, enteredAt=iso(now), entryPrice=price, atr=atr,
                              stop=px(price - s["stopAtr"] * atr), initialStop=px(price - s["stopAtr"] * atr),
                              target=px(price + s["targetAtr"] * atr), allocationPct=round(alloc, 2))
        ledger["startedAt"] = ledger.get("startedAt") or iso(now)
        log_run(ledger, "buy", f"Bought {sym} at {price} with {alloc:.0f}% of account; stop {ledger['open']['stop']}, target {ledger['open']['target']}", now)
        save(LEDGER, ledger)
        print(json.dumps(ledger["open"]))
        return 0

    if a.cmd == "set-stop":
        if not ledger.get("open"):
            return 2
        ledger["open"]["stop"] = px(a.price)
        save(LEDGER, ledger)
        return 0

    if a.cmd == "exit":
        pos = ledger.get("open")
        if not pos:
            print("ERROR: no open position", file=sys.stderr)
            return 2
        ret = 100 * (a.price / pos["entryPrice"] - 1)
        impact = pos["allocationPct"] / 100 * ret
        ledger["equityIndex"] = round(ledger["equityIndex"] * (1 + impact / 100), 4)
        hold = (now - ts(pos["enteredAt"])).total_seconds() / 3600
        ledger.setdefault("trades", []).append(dict(
            symbol=pos["symbol"], enteredAt=pos["enteredAt"], exitedAt=iso(now),
            entryPrice=pos["entryPrice"], exitPrice=a.price, allocationPct=pos["allocationPct"],
            returnPct=round(ret, 3), accountImpactPct=round(impact, 3), holdHours=round(hold, 1),
            exitReason=a.reason))
        ledger["open"] = None
        ledger["snapshots"].append(dict(t=iso(now), index=ledger["equityIndex"]))
        log_run(ledger, "sell", f"Sold {pos['symbol']} at {a.price} ({ret:+.2f}%, {a.reason})", now)
        save(LEDGER, ledger)
        print(json.dumps(ledger["trades"][-1]))
        return 0

    if a.cmd == "log":
        log_run(ledger, a.action, a.detail, now)
        save(LEDGER, ledger)
        return 0


if __name__ == "__main__":
    sys.exit(main())
