#!/usr/bin/env python3
"""Trade gate (board order 2026-11-02: "everything runs on GitHub until a trade is ready").

Runs every 15 minutes in market hours in GitHub Actions (free). It replays the live Dip desk's
exact planner (dip_bot.plan, including promoted edges) on Alpaca prices and writes
docs/data/claudebot-gate.json:
  {"needed": true/false, "reasons": [...], "generatedAt", "freshUntil", "marketOpen"}
The Claude trader runs read this first and stop immediately when nothing is needed. Robinhood
remains the authority: a full run re-checks everything live before any order.
Read-only: it never trades and never changes rules.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "docs", "data", "claudebot-gate.json")
CT = ZoneInfo("America/Chicago")
HOLIDAYS = {"2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"}
H = None


def load(p, d=None):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return d


def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30).read())


def symbol_facts(sym, today):
    start = (datetime.now(timezone.utc) - timedelta(days=420)).date().isoformat()
    bars, tok = [], None
    while True:
        d = get(f"https://data.alpaca.markets/v2/stocks/{sym}/bars?timeframe=1Day&start={start}&adjustment=split&feed=iex&limit=10000" + (f"&page_token={tok}" if tok else ""))
        bars += d.get("bars") or []
        tok = d.get("next_page_token")
        if not tok:
            break
    closes = [b["c"] for b in bars if b["t"][:10] < today]
    trade = get(f"https://data.alpaca.markets/v2/stocks/{sym}/trades/latest?feed=iex")["trade"]
    return {"price": float(trade["p"]), "closes": closes[-260:], "heldQty": 0}


def main():
    global H
    H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    now = datetime.now(timezone.utc)
    if os.environ.get("GATE_TEST_NOW"):               # test mode: pretend it is this time (writes nothing)
        now = datetime.fromisoformat(os.environ["GATE_TEST_NOW"].replace("Z", "+00:00"))
    local = now.astimezone(CT); today = local.date().isoformat()
    market = local.weekday() < 5 and today not in HOLIDAYS and 8 * 60 + 30 <= local.hour * 60 + local.minute < 15 * 60
    out = {"generatedAt": now.isoformat().replace("+00:00", "Z"), "freshUntil": (now + timedelta(minutes=45)).isoformat().replace("+00:00", "Z"),
           "marketOpen": market, "needed": False, "reasons": [], "checked": []}
    sp = importlib.util.spec_from_file_location("db", os.path.join(HERE, "dip_bot.py")); db = importlib.util.module_from_spec(sp); sp.loader.exec_module(db)
    cfg, led = db.load(db.CONFIG), db.load(db.LEDGER)
    held = db.positions(led)
    # Broker positions can require a defensive exit even when a paper-price
    # gate has no new entry signal. Schedule a full read-only reconciliation.
    if market and held:
        out["needed"] = True
        out["reasons"].append("Dip holding: verify broker position, open orders and protective exits")
    # other live desks that need Robinhood attention whenever they hold something
    EOD = "options desk: end-of-day signal check"
    if (load(os.path.join(ROOT, "docs", "data", "claudebot-optbuy-ledger.json"), {}) or {}).get("open"):
        out["needed"] = True; out["reasons"].append("options-buying desk holds an option (manage its exit)")
    elif market and (load(os.path.join(HERE, "optbuy_config.json"), {}) or {}).get("enabled") and local.hour * 60 + local.minute >= 14 * 60 + 35:
        # The options desk only buys in the last run before the close and its signals are not replayed here,
        # so that run (2:44 PM CT) must do the full check. It never triggers an extra call by itself (see below).
        out["needed"] = True; out["reasons"].append(EOD)
    if (load(os.path.join(ROOT, "docs", "data", "claudebot-ledger.json"), {}) or {}).get("open"):
        out["reasons"].append("crypto position held (its stop rests at Robinhood; checked on full runs)")
    if market:
        facts = {"now": out["generatedAt"], "marketOpen": True, "accountValue": 117.0, "buyingPower": 112.0, "symbols": {}}
        news = load(os.path.join(ROOT, "docs", "data", "claudebot-news.json"), {}) or {}
        if news.get("flags"):                         # Nova's news veto: no NEW buys in flagged funds
            facts["skip"] = sorted(news["flags"]); out["newsFlags"] = news["flags"]
        for p in held:     # assume still held at the broker; the full run reconciles
            pass
        for _ in range(40):
            plan = db.plan(facts, cfg, led)["actions"][0]
            if plan["do"] == "need_symbol":
                s = plan["symbol"]
                try:
                    facts["symbols"][s] = symbol_facts(s, today)
                except Exception as e:  # noqa: BLE001
                    out["needed"] = True; out["reasons"].append(f"price data for {s} unavailable ({e}); full run checks live"); break
                if any(p["symbol"] == s for p in held):
                    facts["symbols"][s]["heldQty"] = 1.0
                out["checked"].append(s); continue
            if plan["do"] in ("buy", "sell"):
                out["needed"] = True
                out["reasons"].append(f"Dip desk: {plan['do']} {plan['symbol']} ({plan.get('reason') or plan.get('why', '')})")
            else:
                out["note"] = plan.get("reason", "")
            break
    # Exit outlook for the site: what each holding is waiting for, in prices and dates. Read-only and
    # wrapped so that it can never change or break the gate decision above.
    try:
        sp2 = importlib.util.spec_from_file_location("outlook", os.path.join(HERE, "outlook.py")); ol = importlib.util.module_from_spec(sp2); sp2.loader.exec_module(ol)
        sess = ol.session_date(local, HOLIDAYS)
        rows = []
        for p in held:
            sf = (facts["symbols"].get(p["symbol"]) if market else None) or symbol_facts(p["symbol"], sess.isoformat())
            rows.append(ol.exit_outlook(p, sf["closes"], sf["price"], cfg, sess, HOLIDAYS))
        out["outlook"] = {"session": sess.isoformat(), "positions": rows}
    except Exception as e:  # noqa: BLE001
        out["outlookError"] = str(e)[:120]
    # Call Claude right away when a trade is ready (board order 2026-11-02). At most once per 40 min
    # for the same reasons, so one signal never starts a pile of runs. The workflow does the call
    # AFTER pushing this file, so the called run reads needed=true.
    prev = load(OUT, {}) or {}
    last_at, last_why = prev.get("lastCallAt"), prev.get("lastCallReasons")
    out["lastCallAt"], out["lastCallReasons"] = last_at, last_why
    stale = not last_at or now - datetime.fromisoformat(last_at.replace("Z", "+00:00")) > timedelta(minutes=40)
    call_reasons = [r_ for r_ in out["reasons"] if r_ != EOD]      # the scheduled 2:44 PM run handles the end-of-day check
    out["callClaude"] = bool(call_reasons and out["needed"] and market and (stale or last_why != call_reasons))
    if out["callClaude"]:
        out["lastCallAt"], out["lastCallReasons"] = out["generatedAt"], call_reasons
    if os.environ.get("GATE_TEST_NOW"):
        print("TEST", json.dumps(out)); return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1); f.write("\n")
    print(json.dumps({k: out[k] for k in ("marketOpen", "needed", "reasons", "callClaude")}))


if __name__ == "__main__":
    main()
