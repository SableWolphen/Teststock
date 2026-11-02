#!/usr/bin/env python3
"""ClaudeBot Options-buying desk (LIVE, single-leg calls, board order 2026-11-02).

Entry: in the 14:00-14:59 CT run, when a fund in optbuy_config.json `symbols` (or, via the nightly
claudebot-optbuy-scan.json triggers, any name in `scanUniverse`) shows the Dip
desk's tested signal (RSI(2) < 5 and price above its 200-day average), buy ONE call on it:
12-35 days out (nearest 21), strike from the money up to 8% above, delta >= 0.15, quotes not
too wide, premium <= min($50, 43% of account); stocks skip earnings within 10 days. Highest delta that fits wins.
Exit: a resting GTC limit sell at +10% goes in right after the fill (profit taken between runs);
sell at the bid if it falls 40%, after 7 trading days, or 5 days before expiry.

  python claudebot/optbuy_bot.py plan facts.json
  python claudebot/optbuy_bot.py open  --json '<buy action>' --price 0.27
  python claudebot/optbuy_bot.py close --price 0.30 --reason "take profit"
  python claudebot/optbuy_bot.py log   --action hold --detail "..."

facts.json (same file as the Dip desk's /tmp/dfacts.json, plus option fields):
 {"now", "marketOpen", "accountValue", "buyingPower",
  "symbols": {"KRE": {"price", "closes": [...>= 201 daily closes...], "heldQty"}},
  "expirations": {"KRE": ["2026-11-20", ...]},
  "calls": [{"symbol", "id", "strike", "expiration", "bid", "ask", "delta"}],
  "optHeld": 1, "optQuote": {"bid", "ask"}, "tpOrder": {"id", "price"} | null}
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONFIG = os.path.join(HERE, "optbuy_config.json")
LEDGER = os.path.join(ROOT, "docs", "data", "claudebot-optbuy-ledger.json")
CT = ZoneInfo("America/Chicago")
_sp = importlib.util.spec_from_file_location("dipb", os.path.join(HERE, "dip_bot.py"))
dipb = importlib.util.module_from_spec(_sp); _sp.loader.exec_module(dipb)
load, save, ts, iso, rsi2, sma, tdays = dipb.load, dipb.save, dipb.ts, dipb.iso, dipb.rsi2, dipb.sma, dipb.trading_days_between


def tick_up(p):
    step = 0.01 if p < 3 else 0.05
    return round(math.ceil(round(p / step, 6)) * step, 2)


def plan(f, cfg, led):
    now = ts(f["now"]); local = now.astimezone(CT); today = local.date()
    s, c, x, r = cfg["signal"], cfg["contract"], cfg["exit"], cfg["risk"]
    none = lambda why: {"actions": [{"do": "none", "reason": why}]}
    if not f.get("marketOpen"):
        return none("market closed")
    pos = led.get("open")
    if pos:
        if "optQuote" not in f or "optHeld" not in f:
            return {"actions": [{"do": "need_position", "id": pos["id"], "note": "optHeld from get_option_positions, optQuote from get_option_quotes, tpOrder from open option orders"}]}
        if float(f["optHeld"]) <= 0:
            return {"actions": [{"do": "record_broker_close", "id": pos["id"], "note": "sold at broker (take-profit filled?): find the filled sell and record it"}]}
        bid, cost = float(f["optQuote"]["bid"]), pos["entryPrice"]
        entered = ts(pos["enteredAt"]).astimezone(CT).date()
        dte = (date.fromisoformat(pos["expiration"]) - today).days
        why = None
        if bid >= cost * (1 + x["takeProfitPct"] / 100):
            why = "take profit"
        elif bid <= cost * (1 - x["stopPct"] / 100):
            why = "stop"
        elif tdays(entered, today) >= x["maxHoldDays"]:
            why = "time"
        elif dte <= x["exitAtDte"]:
            why = "expiry near"
        tp = f.get("tpOrder")
        if why:
            acts = [{"do": "cancel_order", "orderId": tp["id"]}] if tp else []
            if bid <= 0:
                return {"actions": acts + [{"do": "none", "reason": f"wanted to sell ({why}) but the bid is 0; next run retries"}]}
            return {"actions": acts + [{"do": "sell", "id": pos["id"], "symbol": pos["symbol"], "limitPrice": f"{bid:.2f}", "quantity": "1", "reason": why}]}
        want = tick_up(cost * (1 + x["takeProfitPct"] / 100))
        if not tp:
            return {"actions": [{"do": "place_tp", "id": pos["id"], "symbol": pos["symbol"], "limitPrice": f"{want:.2f}", "quantity": "1", "timeInForce": "gtc"}]}
        return none(f"holding {pos['label']} from {cost} (bid {bid}); take-profit resting at {tp['price']}")
    if not cfg.get("enabled", True):
        return none("options-buying desk disabled")
    w0, w1 = (time.fromisoformat(t) for t in s["windowCT"])
    if not (w0 <= local.time() <= w1):
        return none("entries only in the last run before the close (14:00-14:59 CT)")
    acct = float(f.get("accountValue", 0))
    if acct < r["pauseBelowAccountValueUsd"]:
        return none("account below the pause floor")
    budget = min(r["maxPremiumUsd"], acct * r["maxPctOfAccount"] / 100, float(f.get("buyingPower", 0)) - r["minCashAfterUsd"])
    if budget < 5:
        return none("not enough free cash for an option")
    syms, looked, sigs = f.get("symbols", {}), [], []
    # 1) the tested ETFs (full closes, shared with the Dip desk)
    skip = set(f.get("skip") or [])   # news veto for this run (EXECUTOR news check)
    for sym in cfg["symbols"]:
        d = syms.get(sym)
        if sym in skip:
            continue
        if not d:
            return {"actions": [{"do": "need_symbol", "symbol": sym}]}
        cl = [float(v) for v in d["closes"]][-(s["trendSma"] + 10):] + [float(d["price"])]
        if len(cl) < s["trendSma"] + 1:
            continue
        rv = rsi2(cl); looked.append(f"{sym} RSI2 {rv:.0f}")
        if cl[-1] > sma(cl, s["trendSma"]) and rv < s["rsi2Below"]:
            sigs.append((sym, "etf", rv))
    # 2) the wider universe (stocks + extra ETFs) from the nightly scan's trigger prices
    scan = f.get("scan")
    if cfg.get("scanUniverse") and scan is not None:
        age = (now - ts(scan["generatedAt"])).total_seconds() / 3600 if scan.get("generatedAt") else 999
        if age > cfg["scan"]["maxAgeHours"] or not scan.get("asOf") or scan["asOf"] >= today.isoformat():
            looked.append(f"universe scan stale ({age:.0f}h old), skipped")
        else:
            px = f.get("scanPrices") or {}
            miss = [w for w in scan.get("watch", []) if w not in px and w not in cfg["symbols"]]
            if miss:
                return {"actions": [{"do": "need_scan_prices", "symbols": miss, "note": "scanPrices[SYM] = live price from get_equity_quotes"}]}
            hits = []
            for w in [w for w in scan.get("watch", []) if w not in skip]:
                r = scan["symbols"].get(w) or {}
                if w in cfg["symbols"] or w not in px or not r.get("rsiTrigger"):
                    continue
                p_ = float(px[w])
                if r["trendFloor"] < p_ < r["rsiTrigger"]:
                    hits.append((w, "etf" if w in cfg.get("scanEtfs", []) else "stock", (r["rsiTrigger"] - p_) / p_))
                    syms.setdefault(w, {"price": p_})
            # deepest below its trigger first
            sigs += [(w, k, -depth) for w, k, depth in sorted(hits, key=lambda t: -t[2])]
            looked.append(f"universe: {len(scan.get('watch', []))} on watch, {len(hits)} signals")
    if not sigs:
        return none("no dip signal: " + ", ".join(looked))
    skipped = []
    for sig, kind, _ in sigs[: cfg["scan"].get("maxSignalsPerRun", 6)]:
        if kind == "stock":
            earn = f.get("earnings") or {}
            if sig not in earn:
                return {"actions": [{"do": "need_earnings", "symbol": sig, "note": "earnings[SYM] = next report date YYYY-MM-DD within ~31 days, or null"}]}
            if earn[sig] and 0 <= (date.fromisoformat(earn[sig]) - today).days <= c["earningsBufferDays"]:
                skipped.append(f"{sig} earnings {earn[sig]}"); continue
        exps = (f.get("expirations") or {}).get(sig)
        if exps is None:
            return {"actions": [{"do": "need_expirations", "symbol": sig}]}
        ok = [e for e in exps if c["minDte"] <= (date.fromisoformat(e) - today).days <= c["maxDte"]]
        if not ok:
            skipped.append(f"{sig} no {c['minDte']}-{c['maxDte']} day expiry"); continue
        exp = min(ok, key=lambda e: abs((date.fromisoformat(e) - today).days - c["targetDte"]))
        px = float(syms[sig]["price"])
        cands = [k for k in f.get("calls", []) if k["symbol"] == sig and k["expiration"] == exp]
        if not cands and f"{sig}|{exp}" not in (f.get("callsFetched") or []):
            return {"actions": [{"do": "need_calls", "symbol": sig, "expiration": exp, "type": "call", "strikeMin": round(px, 2), "strikeMax": round(px * (1 + c["maxStrikeAbovePct"] / 100), 2)}]}
        fit = []
        for k in cands:
            bid, ask, dl = float(k["bid"]), float(k["ask"]), abs(float(k.get("delta") or 0))
            mid = (bid + ask) / 2
            if not (px <= float(k["strike"]) <= px * (1 + c["maxStrikeAbovePct"] / 100)) or bid <= 0 or dl < c["minDelta"]:
                continue
            if ask - bid > mid * c["maxSpreadPctOfMid"] / 100 + 1e-9:
                continue
            lim = tick_up(mid)
            if lim * 100 + 0.04 > budget:
                continue
            fit.append((dl, k, lim))
        if not fit:
            skipped.append(f"{sig} no {exp} call fits"); continue
        dl, k, lim = max(fit, key=lambda t: t[0])
        return {"actions": [{"do": "buy", "symbol": sig, "id": k["id"], "strike": float(k["strike"]), "expiration": exp, "limitPrice": f"{lim:.2f}",
                             "maxPrice": f"{min(float(k['ask']), budget / 100):.2f}", "quantity": "1", "delta": round(dl, 3),
                             "label": f"{sig} {exp[5:]} {float(k['strike']):g}C", "why": f"{sig} dip signal; call delta {dl:.2f} for ${lim * 100:.0f}"}]}
    return none(f"dip signals but nothing fits (budget ${budget:.0f}, delta >= {c['minDelta']}, tight quotes): " + "; ".join(skipped))


def main(argv=None):
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("facts")
    p = sub.add_parser("open"); p.add_argument("--json", required=True); p.add_argument("--price", type=float, required=True)
    p = sub.add_parser("close"); p.add_argument("--price", type=float, required=True); p.add_argument("--reason", required=True)
    p = sub.add_parser("log"); p.add_argument("--action", required=True); p.add_argument("--detail", default="")
    p = sub.add_parser("mark"); p.add_argument("facts")
    a = ap.parse_args(argv)
    cfg = load(CONFIG)
    led = load(LEDGER) if os.path.exists(LEDGER) else {"schemaVersion": 1, "mode": "live", "open": None, "trades": [], "runs": []}
    now = datetime.now(timezone.utc)
    def log(act, det):
        led.setdefault("runs", []).append({"t": iso(now), "action": act, "detail": det}); led["runs"] = led["runs"][-60:]
    if a.cmd == "plan":
        print(json.dumps(plan(load(a.facts), cfg, led), indent=1)); return 0
    if a.cmd == "open":
        if led.get("open"):
            print("ERROR: position already open", file=sys.stderr); return 2
        b = json.loads(a.json)
        led["open"] = {k: b[k] for k in ("symbol", "id", "strike", "expiration", "label", "delta")} | {"entryPrice": a.price, "enteredAt": iso(now)}
        led["startedAt"] = led.get("startedAt") or iso(now)
        log("buy", f"bought 1 {b['label']} at {a.price} (${a.price * 100:.0f})"); save(LEDGER, led); return 0
    if a.cmd == "close":
        o = led.get("open")
        if not o:
            print("ERROR: nothing open", file=sys.stderr); return 2
        pnl = round((a.price - o["entryPrice"]) * 100 - 0.06, 2)
        led["trades"].append({"label": o["label"], "symbol": o["symbol"], "enteredAt": o["enteredAt"], "exitedAt": iso(now), "entryPrice": o["entryPrice"],
                              "exitPrice": a.price, "pnlUsd": pnl, "returnPct": round(100 * (a.price / o["entryPrice"] - 1), 1), "reason": a.reason})
        led["open"] = None; log("sell", f"sold {o['label']} at {a.price} ({a.reason}, {'+' if pnl >= 0 else ''}${pnl})"); save(LEDGER, led); return 0
    if a.cmd == "mark":
        # record the held option's live bid for the dashboard's "made today" (prices only)
        o, f = led.get("open"), load(a.facts)
        q = f.get("optQuote") or {}
        if o and q.get("bid") is not None:
            today = now.astimezone(CT).date().isoformat(); prev = o.get("mark")
            if ts(o["enteredAt"]).astimezone(CT).date().isoformat() == today:
                base = o["entryPrice"]
            elif prev and prev.get("day") == today:
                base = prev["dayBase"]
            else:
                base = prev["price"] if prev else o["entryPrice"]
            o["mark"] = {"t": iso(now), "price": float(q["bid"]), "dayBase": base, "day": today}
            save(LEDGER, led)
        return 0
    if a.cmd == "log":
        log(a.action, a.detail); save(LEDGER, led); return 0


if __name__ == "__main__":
    sys.exit(main())
