#!/usr/bin/env python3
"""ClaudeBot Options-buying desk (LIVE, single-leg calls).

Board order 2026-11-11 ("Live: cheap-stock + index", chosen when asked whether to skip the
30-paper-trade rule): the desk trades two rules, one option at a time, inside the governor's caps.
  cheapStock  Dip signal (RSI(2) < 5 above the 200-day average) on a name from `scanUniverse` priced
              $25 or less -> the call within 3% of the price, about 30 days out (24-37), costing
              <= min($50, 43% of account). Stocks skip earnings inside the holding window.
  index       the same signal on SPY, QQQ or IWM -> the call closest to the price (up to 15% above)
              about 45 days out (38-52) that fits the same budget.
Entries at any run 8:40-14:59 CT (board order 2026-11-11; the tests bought at the close). A contract is skipped when its
quote is wider than the tests assumed by enough to erase the tested edge (see `forecast`).
Exit follows the STOCK, as in the tests: the underlying falls 5% below where it was at entry (any run),
or, at any run (board order 2026-11-11), it is back above its 5-day average or 10 trading days have passed; also
5 days before expiry. There is no resting take-profit order and no premium stop: the most one trade
can lose is what was paid for the option.
A rule switches itself off after 10 closed live trades if its profit factor is below 1.0.
Evidence and its limits: optbuy_config.json `rules[*].evidence` (thin: tens of trades, not hundreds).

  python claudebot/optbuy_bot.py plan facts.json
  python claudebot/optbuy_bot.py open  --json '<buy action>' --price 0.27
  python claudebot/optbuy_bot.py close --price 0.30 --reason "bounce"
  python claudebot/optbuy_bot.py log   --action hold --detail "..."

facts.json (same file as the Dip desk's /tmp/dfacts.json, plus option fields):
 {"now", "marketOpen", "accountValue", "buyingPower",
  "symbols": {"SPY": {"price", "closes": [...>= 201 daily closes...], "heldQty"}},
  "scan": <docs/data/claudebot-optbuy-scan.json>, "scanPrices": {"F": 12.1}, "earnings": {"F": "2026-12-02" | null},
  "expirations": {"F": ["2026-12-11", ...]},
  "calls": [{"symbol", "id", "strike", "expiration", "bid", "ask", "delta"}], "callsFetched": ["F|2026-12-11"],
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
_gk = importlib.util.spec_from_file_location("gatekeeper_for_optbuy", os.path.join(HERE, "gatekeeper.py"))
gk = importlib.util.module_from_spec(_gk); _gk.loader.exec_module(gk)


def tick_up(p):
    step = 0.01 if p < 3 else 0.05
    return round(math.ceil(round(p / step, 6)) * step, 2)


def positions(led):
    """Held options (board 2026-11-11: up to maxOpenPositions at once). Reads the older single 'open' too."""
    if led.get("positions") is not None:
        return led["positions"]
    return [led["open"]] if led.get("open") else []


def rule_state(cfg, led, rule):
    """(ok, closedTrades, profitFactor). A rule switches itself off once it has `afterTrades` closed live
    trades with a profit factor below the floor (board order: stop after 10 live trades if it is losing)."""
    rb = cfg.get("rollback") or {}; since = rb.get("since") or ""
    t = [x for x in led.get("trades") or [] if x.get("rule") == rule and (x.get("enteredAt") or "") >= since]
    w = sum(x["pnlUsd"] for x in t if x["pnlUsd"] > 0); l = -sum(x["pnlUsd"] for x in t if x["pnlUsd"] <= 0)
    pf = (w / l) if l > 0 else None
    ok = not (len(t) >= rb.get("afterTrades", 10) and pf is not None and pf < rb.get("minProfitFactor", 1.0))
    return ok, len(t), pf


def forecast(rc, bid, ask):
    """Expected $ per contract after costs: the rule's tested average return on what is paid (the lower of
    its two test periods), less any buy/sell gap wider than the test assumed. <= 0 means: skip this quote."""
    mid = (bid + ask) / 2; g = rc.get("assumedGap") or {}
    assumed = max(float(g.get("abs", 0.01)), mid * float(g.get("pctOfPrice", 0)) / 100)
    return round(ask * 100 * rc["expectedRetPct"] / 100 - max(0.0, (ask - bid) - assumed) * 100, 2)


def plan(f, cfg, led):
    now = ts(f["now"]); local = now.astimezone(CT); today = local.date()
    s, c, x, r = cfg["signal"], cfg["contract"], cfg["exit"], cfg["risk"]
    none = lambda why: {"actions": [{"do": "none", "reason": why}]}
    if not f.get("marketOpen"):
        return none("market closed")
    syms = f.get("symbols", {})
    held = positions(led)
    if held:
        # facts per held option, keyed by option id: optHeldById, optQuotes, tpOrders (see need_position)
        if "optQuotes" not in f or "optHeldById" not in f:
            return {"actions": [{"do": "need_position", "ids": [p["id"] for p in held],
                                 "note": "optHeldById[id] from get_option_positions, optQuotes[id] = {bid, ask} from get_option_quotes, tpOrders[id] = {id, price} of any open sell-to-close order"}]}
        notes = []
        for pos in held:
            if float(f["optHeldById"].get(pos["id"], 0)) <= 0:
                return {"actions": [{"do": "record_broker_close", "id": pos["id"], "note": "no longer held at the broker: find the filled sell and record it"}]}
            d = syms.get(pos["symbol"])
            if not d or not d.get("closes"):                 # the exit follows the stock, so its price and closes are needed
                return {"actions": [{"do": "need_symbol", "symbol": pos["symbol"]}]}
            q = f["optQuotes"].get(pos["id"]) or {}
            bid, cost, px = float(q.get("bid") or 0), pos["entryPrice"], float(d["price"])
            entered = ts(pos["enteredAt"]).astimezone(CT).date()
            dte = (date.fromisoformat(pos["expiration"]) - today).days
            c0, c1 = (time.fromisoformat(t) for t in x["closeWindowCT"])
            why, upx = None, pos.get("underlyingPx")
            if entered != today:                             # as in the tests: no exit on the day it was bought
                cl = [float(v) for v in d["closes"]]; n = x["bounceSma"]
                if upx and px <= float(upx) * (1 - x["stockStopPct"] / 100):
                    why = "stock stop"
                elif dte <= x["exitAtDte"]:
                    why = "expiry near"
                elif c0 <= local.time() <= c1:
                    if len(cl) >= n - 1 and px > (sum(cl[-(n - 1):]) + px) / n:
                        why = "bounce"
                    elif tdays(entered, today) >= x["maxHoldDays"]:
                        why = "time"
            tp = (f.get("tpOrders") or {}).get(pos["id"])     # this rule keeps no resting order: clear any left over
            acts = [{"do": "cancel_order", "orderId": tp["id"]}] if tp else []
            if why:
                if bid <= 0:
                    notes.append(f"{pos['label']}: wanted to sell ({why}) but the bid is 0; next run retries")
                    if acts:
                        return {"actions": acts}
                    continue
                return {"actions": acts + [{"do": "sell", "id": pos["id"], "symbol": pos["symbol"], "label": pos["label"], "limitPrice": f"{bid:.2f}", "quantity": "1", "reason": why}]}
            if acts:
                return {"actions": acts}
            notes.append(f"holding {pos['label']} from {cost} (bid {bid}); {pos['symbol']} at {px}"
                         + (" (bought today)" if entered == today else ""))
        if len(held) >= r.get("maxOpenPositions", 1):
            return none("; ".join(notes) + f"; at the limit of {r.get('maxOpenPositions', 1)} options")
    if not cfg.get("enabled", True):
        return none("options-buying desk disabled")
    w0, w1 = (time.fromisoformat(t) for t in s["windowCT"])
    if not (w0 <= local.time() <= w1):
        return none(f"entries only {s['windowCT'][0]}-{s['windowCT'][1]} CT")
    acct = float(f.get("accountValue", 0))
    if acct < r["pauseBelowAccountValueUsd"]:
        return none("account below the pause floor")
    open_usd = sum(p["entryPrice"] * 100 for p in held)
    budget = min(r["maxPremiumUsd"], acct * r["maxPctOfAccount"] / 100, float(f.get("buyingPower", 0)) - r["minCashAfterUsd"],
                 acct * r.get("maxTotalPctOfAccount", 100) / 100 - open_usd)
    held_syms = {p["symbol"] for p in held}
    if budget < 5:
        return none("not enough free cash for an option")
    live, off = {}, []
    for name, rc in (cfg.get("rules") or {}).items():
        if not rc.get("enabled", True):
            continue
        if not (rc.get("boardApproval") or {}).get("approvalId"):
            off.append(f"{name} has no recorded board approval"); continue
        ok, n, pf = rule_state(cfg, led, name)
        if not ok:
            off.append(f"{rc.get('name', name)} switched itself off after {n} live trades (profit factor {pf:.2f})"); continue
        live[name] = rc
    if not live:
        return none("no option rule is live" + (": " + "; ".join(off) if off else ""))
    looked, sigs = list(off), []
    skip = set(f.get("skip") or [])   # news veto for this run (EXECUTOR news check)
    # 1) cheap stocks, from the nightly scan's trigger prices (the stronger evidence, so tried first)
    cs = live.get("cheapStock")
    if cs and cfg.get("scanUniverse"):
        scan = f.get("scan")
        if scan is None:
            return {"actions": [{"do": "need_scan", "note": "facts.scan = the contents of docs/data/claudebot-optbuy-scan.json"}]}
        age = (now - ts(scan["generatedAt"])).total_seconds() / 3600 if scan.get("generatedAt") else 999
        if age > cfg["scan"]["maxAgeHours"] or not scan.get("asOf") or scan["asOf"] >= today.isoformat():
            looked.append(f"cheap-stock scan stale ({age:.0f}h old), skipped")
        else:
            px = f.get("scanPrices") or {}
            near = cs["maxStockPrice"] * (1 + cfg["scan"].get("maxDropPct", 6) / 100)    # could be cheap enough today
            watch = [w for w in scan.get("watch", []) if 0 < float((scan["symbols"].get(w) or {}).get("lastClose") or 0) <= near]
            miss = [w for w in watch if w not in px]
            if miss:
                return {"actions": [{"do": "need_scan_prices", "symbols": miss, "note": "scanPrices[SYM] = live price from get_equity_quotes"}]}
            hits = []
            for w in [w for w in watch if w not in skip and w not in held_syms]:
                rr = scan["symbols"].get(w) or {}
                if not rr.get("rsiTrigger"):
                    continue
                p_ = float(px[w])
                if rr["trendFloor"] < p_ < rr["rsiTrigger"] and p_ <= cs["maxStockPrice"]:
                    hits.append((w, "etf" if w in cfg.get("scanEtfs", []) else "stock", (rr["rsiTrigger"] - p_) / p_))
                    if not (syms.get(w) or {}).get("closes"):
                        syms[w] = {**(syms.get(w) or {}), "price": p_}
            sigs += [(w, "cheapStock", kind) for w, kind, _ in sorted(hits, key=lambda t: -t[2])]     # deepest below its trigger first
            looked.append(f"cheap stocks: {len(watch)} on watch, {len(hits)} signals")
    # 2) the three index funds (full closes, shared with the Dip desk)
    ix = live.get("index")
    for sym in (ix or {}).get("symbols", []):
        if sym in skip or sym in held_syms:
            continue
        d = syms.get(sym)
        if not d or not d.get("closes"):
            return {"actions": [{"do": "need_symbol", "symbol": sym}]}
        cl = [float(v) for v in d["closes"]][-(s["trendSma"] + 10):] + [float(d["price"])]
        if len(cl) < s["trendSma"] + 1:
            continue
        rv = rsi2(cl); looked.append(f"{sym} RSI2 {rv:.0f}")
        if cl[-1] > sma(cl, s["trendSma"]) and rv < s["rsi2Below"]:
            sigs.append((sym, "index", "etf"))
    if not sigs:
        return none("no dip signal: " + ", ".join(looked))
    skipped = []
    for sig, rule, kind in sigs[: cfg["scan"].get("maxSignalsPerRun", 6)]:
        rc = live[rule]
        qc = rc.get("quality")
        if kind == "stock" and qc:
            # board 2026-11-11 "only buy good stocks": profitable and rated a buy by most analysts (untested filter)
            ql = (f.get("quality") or {}).get(sig)
            if ql is None:
                return {"actions": [{"do": "need_quality", "symbol": sig,
                                     "note": "quality[SYM] = {pe: get_equity_fundamentals pe_ratio (null if none), buy, hold, sell: get_equity_analyst_ratings counts (0 if no coverage)}"}]}
            n_ = sum(int(ql.get(k) or 0) for k in ("buy", "hold", "sell"))
            pe_ = ql.get("pe")
            if pe_ is None or float(pe_) <= qc["minPe"]:
                skipped.append(f"{sig} not profitable (P/E {pe_})"); continue
            if n_ < qc["minAnalysts"] or 100 * int(ql.get("buy") or 0) / n_ < qc["minBuyPct"]:
                skipped.append(f"{sig} not rated a buy ({int(ql.get('buy') or 0)} of {n_} analysts)"); continue
        if kind == "stock":
            earn = f.get("earnings") or {}
            if sig not in earn:
                return {"actions": [{"do": "need_earnings", "symbol": sig, "note": "earnings[SYM] = next report date YYYY-MM-DD within ~31 days, or null"}]}
            if earn[sig] and 0 <= (date.fromisoformat(earn[sig]) - today).days <= c["earningsBufferDays"]:
                skipped.append(f"{sig} earnings {earn[sig]}"); continue
        exps = (f.get("expirations") or {}).get(sig)
        if exps is None:
            return {"actions": [{"do": "need_expirations", "symbol": sig}]}
        ok = [e for e in exps if rc["minDte"] <= (date.fromisoformat(e) - today).days <= rc["maxDte"]]
        if not ok:
            skipped.append(f"{sig} no {rc['minDte']}-{rc['maxDte']} day expiry"); continue
        exp = min(ok, key=lambda e: abs((date.fromisoformat(e) - today).days - rc["targetDte"]))
        px = float(syms[sig]["price"])
        lo, hi = ((px * (1 - rc["strikeWithinPct"] / 100), px * (1 + rc["strikeWithinPct"] / 100)) if "strikeWithinPct" in rc
                  else (px, px * (1 + rc["maxStrikeAbovePct"] / 100)))
        cands = [k for k in f.get("calls", []) if k["symbol"] == sig and k["expiration"] == exp]
        if not cands and f"{sig}|{exp}" not in (f.get("callsFetched") or []):
            return {"actions": [{"do": "need_calls", "symbol": sig, "expiration": exp, "type": "call", "strikeMin": round(lo, 2), "strikeMax": round(hi, 2)}]}
        fit, wide = [], 0
        for k in cands:
            bid, ask, strike = float(k["bid"]), float(k["ask"]), float(k["strike"])
            mid = (bid + ask) / 2
            if not (lo - 1e-9 <= strike <= hi + 1e-9) or bid <= 0 or ask < bid:
                continue
            if ask - bid > mid * c["maxSpreadPctOfMid"] / 100 + 1e-9:
                wide += 1; continue
            lim = tick_up(mid)
            if lim * 100 + 0.04 > budget:
                continue
            fc = forecast(rc, bid, ask)
            # Only propose what the Profitability Gatekeeper would pass on the same numbers (it is still run
            # independently before the order): a profit after costs, better than the Dip desk, and survivable.
            if not gk.evaluate({"ask": ask, "bid": bid, "forecastUsd": fc}, acct, evidence="board", live=True, hold_minutes=rc.get("holdMinutes", 1170))["pass"]:
                wide += 1; continue
            fit.append((abs(strike - px), strike, k, lim, fc))
        if not fit:
            skipped.append(f"{sig} no {exp} call fits" + (f" ({wide} had quotes too wide to keep the tested edge)" if wide else "")); continue
        _, strike, k, lim, fc = min(fit, key=lambda t: (t[0], t[1]))      # closest to the price
        dl = abs(float(k.get("delta") or 0))
        return {"actions": [{"do": "buy", "symbol": sig, "id": k["id"], "strike": strike, "expiration": exp, "limitPrice": f"{lim:.2f}",
                             "maxPrice": f"{min(float(k['ask']), budget / 100):.2f}", "quantity": "1", "delta": round(dl, 3),
                             "rule": rule, "underlyingPx": round(px, 4), "bid": float(k["bid"]), "ask": float(k["ask"]),
                             "forecastUsd": fc, "holdMinutes": rc.get("holdMinutes", 1170), "strategyId": f"optbuy:{rule}",
                             "label": f"{sig} {exp[5:]} {strike:g}C",
                             "why": f"{sig} dip signal ({rc.get('name', rule)}); {strike:g} call {100 * (strike / px - 1):+.1f}% from the price for ${lim * 100:.0f}"}]}
    return none(f"dip signals but nothing fits (budget ${budget:.0f}, tight quotes): " + "; ".join(skipped))


def main(argv=None):
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("facts")
    p = sub.add_parser("open"); p.add_argument("--json", required=True); p.add_argument("--price", type=float, required=True)
    p = sub.add_parser("close"); p.add_argument("--price", type=float, required=True); p.add_argument("--reason", required=True); p.add_argument("--id")
    p = sub.add_parser("log"); p.add_argument("--action", required=True); p.add_argument("--detail", default="")
    p = sub.add_parser("mark"); p.add_argument("facts")
    a = ap.parse_args(argv)
    cfg = load(CONFIG)
    led = load(LEDGER) if os.path.exists(LEDGER) else {"schemaVersion": 1, "mode": "live", "open": None, "positions": [], "trades": [], "runs": []}
    now = datetime.now(timezone.utc)
    def log(act, det):
        led.setdefault("runs", []).append({"t": iso(now), "action": act, "detail": det}); led["runs"] = led["runs"][-60:]
    if a.cmd == "plan":
        print(json.dumps(plan(load(a.facts), cfg, led), indent=1)); return 0
    ps = positions(led)
    def save_led():
        led["positions"] = ps; led["open"] = ps[0] if ps else None     # "open" mirrors the first one for older readers
        save(LEDGER, led)
    if a.cmd == "open":
        b = json.loads(a.json)
        if len(ps) >= int(cfg["risk"].get("maxOpenPositions", 1)) or any(p["id"] == b["id"] for p in ps):
            print("ERROR: at the option limit or this option is already held", file=sys.stderr); return 2
        ps.append({k: b[k] for k in ("symbol", "id", "strike", "expiration", "label", "delta")}
                  | {k: b[k] for k in ("rule", "underlyingPx", "forecastUsd") if k in b} | {"entryPrice": a.price, "enteredAt": iso(now)})
        led["startedAt"] = led.get("startedAt") or iso(now)
        log("buy", f"bought 1 {b['label']} at {a.price} (${a.price * 100:.0f})"); save_led(); return 0
    if a.cmd == "close":
        o = next((p for p in ps if p["id"] == a.id), None) if a.id else (ps[0] if len(ps) == 1 else None)
        if not o:
            print("ERROR: no such open option (pass --id when more than one is held)", file=sys.stderr); return 2
        pnl = round((a.price - o["entryPrice"]) * 100 - 0.06, 2)
        led["trades"].append({"label": o["label"], "symbol": o["symbol"], "enteredAt": o["enteredAt"], "exitedAt": iso(now), "entryPrice": o["entryPrice"],
                              "exitPrice": a.price, "pnlUsd": pnl, "returnPct": round(100 * (a.price / o["entryPrice"] - 1), 1), "reason": a.reason,
                              "rule": o.get("rule")})
        ps.remove(o); log("sell", f"sold {o['label']} at {a.price} ({a.reason}, {'+' if pnl >= 0 else ''}${pnl})"); save_led(); return 0
    if a.cmd == "mark":
        # record each held option's live bid for the dashboard's "made today" (prices only)
        f = load(a.facts); qs = f.get("optQuotes") or {}
        today = now.astimezone(CT).date().isoformat()
        for o in ps:
            q = qs.get(o["id"]) or {}
            if q.get("bid") is None:
                continue
            prev = o.get("mark")
            if ts(o["enteredAt"]).astimezone(CT).date().isoformat() == today:
                base = o["entryPrice"]
            elif prev and prev.get("day") == today:
                base = prev["dayBase"]
            else:
                base = prev["price"] if prev else o["entryPrice"]
            o["mark"] = {"t": iso(now), "price": float(q["bid"]), "dayBase": base, "day": today}
        save_led(); return 0
    if a.cmd == "log":
        log(a.action, a.detail); save(LEDGER, led); return 0


if __name__ == "__main__":
    sys.exit(main())
