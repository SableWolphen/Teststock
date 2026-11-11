#!/usr/bin/env python3
"""Cheap dip-call PAPER desk (board, 2026-11-11: "can't we just do the same but cheaper options we can
afford"). The winning dip-call recipe (claudebot/dipcall_paper.py: buy on the Dip signal, sell when the
fund's own sell rule fires) with the one change the account needs: the contract is the call CLOSEST TO
THE PRICE that costs $50 or less at the ask, fees included.

Why paper first: on real historical option prices (claudebot-dipcall-cheap-research.json) this lost in
2024 at every expiry and made money in 2025-26 at 30 and 45 days, so it did not pass the same bar the
near-the-price version passed. A forward test at live quotes is the fair next step.

Runs after each close in GitHub (free). NEVER places an order. One pretend contract per signal:
  entry  Dip signal at today's close (RSI(2) < 5 above the 200-day average) on the same 8 funds ->
         the expiry nearest 45 days (else nearest 30) that has a call at or above the price costing
         <= $50 at the ASK; within it, the strike closest to the price
  exit   the fund closes above its 5-day average, after 10 trading days, or 5% below entry -> sell at the BID
Fees $0.05/contract each way. Writes docs/data/claudebot-cheapcall-paper.json.
Real money would need 30+ paper trades over 20+ sessions, profit factor >= 1.3, a profit with doubled
costs, the risk governor's caps and the board. None of that is automatic here.
"""
from __future__ import annotations

import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-cheapcall-paper.json")
sp = importlib.util.spec_from_file_location("dipcall_paper", os.path.join(HERE, "dipcall_paper.py"))
dp = importlib.util.module_from_spec(sp); sp.loader.exec_module(dp)
CAP, MAX_OTM = 50.0, 0.15
INDEX_FUNDS = {"SPY", "QQQ", "IWM"}
NAME = "Cheap dip calls (closest call to the price costing $50 or less, sold on the bounce)"


def pick(sym, px, today, cap=CAP):
    for target, lo, hi in ((45, 38, 52), (30, 24, 37)):
        best, tok = None, None
        for _ in range(8):                                   # at most 8 pages of quotes per fund
            url = (f"https://data.alpaca.markets/v1beta1/options/snapshots/{sym}?feed=indicative&type=call&limit=1000"
                   f"&expiration_date_gte={today + timedelta(days=lo)}&expiration_date_lte={today + timedelta(days=hi)}"
                   f"&strike_price_gte={px:.2f}&strike_price_lte={px * (1 + MAX_OTM):.2f}" + (f"&page_token={tok}" if tok else ""))
            d = dp.get(url)
            for occ, sn in (d.get("snapshots") or {}).items():
                q = sn.get("latestQuote") or {}; a, b = float(q.get("ap") or 0), float(q.get("bp") or 0)
                mo = dp.OCC.match(occ)
                if not mo or a <= 0 or b <= 0 or a * 100 + dp.FEE > cap:
                    continue
                k = int(mo.group(4)) / 1000; exp = datetime.strptime(mo.group(2), "%y%m%d").date()
                key = (abs((exp - today).days - target), k)   # the expiry nearest the target, then closest to the price
                if best is None or key < best[0]:
                    best = (key, {"symbol": occ, "strike": k, "expiration": exp.isoformat(), "ask": a, "bid": b,
                                  "otmPct": round(100 * (k / px - 1), 1), "dteTarget": target})
            tok = d.get("next_page_token")
            if not tok:
                break
        if best:
            return best[1]
    return None


def step(led, bars_by_sym, today, key="cheapcall", syms=None, picker=None, max_px=None, board=None):
    """Pure ledger logic for one evening. bars_by_sym = {fund: [(day, close), ...]}."""
    st = led["strategies"][key]; made = []; picker = picker or pick; nofit = 0
    for s in (syms or dp.SYMS):
        bars = bars_by_sym.get(s) or []
        d = [x for x, _ in bars]; c = [x for _, x in bars]
        if len(c) < 210 or (led.get("lastDay") and d[-1] <= led["lastDay"]):
            continue
        day = d[-1]; pos = st["open"].get(s)
        if pos:
            held = sum(1 for x in d if pos["in"] < x <= day)
            why = "5% stop" if c[-1] <= pos["etfPx"] * 0.95 else "bounce" if c[-1] > sum(c[-5:]) / 5 else "time" if held >= 10 else None
            if why:
                q = dp.get(f"https://data.alpaca.markets/v1beta1/options/snapshots?symbols={pos['symbol']}&feed=indicative").get("snapshots") or {}
                bid = float(((q.get(pos["symbol"]) or {}).get("latestQuote") or {}).get("bp") or 0)
                pnl = round((bid - pos["ask"]) * 100 - 2 * dp.FEE, 2)
                st["trades"].append({**pos, "out": day, "exitBid": bid, "why": why, "pnlUsd": pnl, "retPct": round(100 * (bid / pos["ask"] - 1), 1),
                                     "etfRetPct": round(100 * (c[-1] / pos["etfPx"] - 1), 2), "days": held})
                del st["open"][s]; made.append(f"sold {pos['symbol']} {why} {pnl:+.2f}")
        elif (max_px is None or c[-1] <= max_px) and c[-1] > sum(c[-200:]) / 200 and dp.rsi2(c[-31:]) < 5:
            opt = picker(s, c[-1], today)
            if opt:
                st["open"][s] = {**opt, "in": day, "etfPx": c[-1], "underlying": s}; made.append(f"bought {opt['symbol']} at {opt['ask']}")
            else:
                nofit += 1
        led["_day"] = max(led.get("_day") or "", day)
    if led.get("_day"):
        led["lastDay"] = led.pop("_day")
    if nofit:
        made.append(f"{nofit} signal{'s' if nofit > 1 else ''} had no call that fits the rule for $50 or less")
    def row(rid, name, t, n_open):
        w = [x["pnlUsd"] for x in t if x["pnlUsd"] > 0]; l = [x["pnlUsd"] for x in t if x["pnlUsd"] <= 0]
        return {"id": rid, "name": name, "trades": len(t), "wins": len(w), "winRatePct": round(100 * len(w) / len(t), 1) if t else None,
                "pnlUsd": round(sum(w + l), 2), "avgRetPct": round(sum(x["retPct"] for x in t) / len(t), 1) if t else None,
                "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, "open": n_open}
    # The second row is the SAME trades counted for SPY, QQQ and IWM only: on historical prices that slice was
    # about flat in 2024 and profitable in 2025-26, while the other funds lost. Tracked forward, not traded twice.
    idx = lambda x: x.get("underlying") in INDEX_FUNDS
    led["leaderboard"] = board(row, st) if board else [
        row("cheapcall", st["name"], st["trades"], len(st["open"])),
        row("cheapcall_index", "of which SPY, QQQ and IWM only", [x for x in st["trades"] if idx(x)], sum(1 for x in st["open"].values() if idx(x)))]
    led["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    led["runs"] = (led.get("runs", []) + [{"t": led["updatedAt"], "detail": ", ".join(made) or "no signals"}])[-60:]
    return led


def new_ledger():
    return {"schemaVersion": 1, "mode": "paper", "lastDay": None,
            "note": "PAPER ONLY. The dip-call recipe with the closest-to-the-price call that costs $50 or less. Mixed on historical option prices; this is its forward test.",
            "strategies": {"cheapcall": {"name": NAME, "open": {}, "trades": []}}, "runs": []}


def main():
    dp.H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    sp2 = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); ob = importlib.util.module_from_spec(sp2); sp2.loader.exec_module(ob)
    try:
        led = json.load(open(OUT))
    except Exception:  # noqa: BLE001
        led = new_ledger()
    today = datetime.now(timezone.utc).date()
    bars = {s: ob.daily_bars(s, (today - timedelta(days=600)).isoformat())[0] for s in dp.SYMS}
    led = step(led, bars, today)
    json.dump(led, open(OUT, "w"), indent=1)
    print(led["runs"][-1]["detail"])


if __name__ == "__main__":
    main()
