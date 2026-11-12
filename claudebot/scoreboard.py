#!/usr/bin/env python3
"""Scoreboard: is the bot beating the easy alternatives? (board, 2026-11-11)

For every real-money trade (finished and still open) it compares what the bot made with what the SAME
dollars would have made over the SAME days if they had (a) simply sat in SPY, or (b) sat in a savings
account. No balances are needed or written: only the $ amounts already in the public ledgers.
READ ONLY. Writes docs/data/claudebot-scoreboard.json. Past results do not predict future results.
"""
from __future__ import annotations

import importlib.util
import json
import os
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "docs", "data")
OUT = os.path.join(DATA, "claudebot-scoreboard.json")
SAVINGS_APY = 4.0   # a typical high-yield savings rate in 2026; shown on the page so it can be checked


def load(n):
    try:
        return json.load(open(os.path.join(DATA, n)))
    except Exception:  # noqa: BLE001
        return {}


def day(iso):
    return iso[:10] if iso else None


def close_on_or_before(bars, d):
    best = None
    for bd, c in bars:
        if bd <= d:
            best = c
        else:
            break
    return best


def real_trades(now_iso, marks=None):
    """[(desk, label, usd, pnlUsd, start, end, open?)] for every real-money trade, closed or open."""
    marks = marks or {}; out = []
    dl, ol = load("claudebot-dip-ledger.json"), load("claudebot-optbuy-ledger.json")
    for t in dl.get("trades") or []:
        out.append(("Stocks", t["label"], t["usd"], t["pnlUsd"], day(t["enteredAt"]), day(t["exitedAt"]), False))
    for p in dl.get("positions") or []:
        px = (p.get("mark") or {}).get("price") or marks.get(p["symbol"])
        if px:
            out.append(("Stocks", p["symbol"] + " (open)", p["usd"], round(p["usd"] * (px / p["entryPrice"] - 1), 2), day(p["enteredAt"]), day(now_iso), True))
    for t in ol.get("trades") or []:
        out.append(("Options", t["label"], round(t["entryPrice"] * 100, 2), t["pnlUsd"], day(t["enteredAt"]), day(t["exitedAt"]), False))
    for p in ol.get("positions") or ([ol["open"]] if ol.get("open") else []):
        px = (p.get("mark") or {}).get("price")
        if px is not None:
            out.append(("Options", p["label"] + " (open)", round(p["entryPrice"] * 100, 2), round((px - p["entryPrice"]) * 100, 2), day(p["enteredAt"]), day(now_iso), True))
    for t in (load("claudebot-ledger.json").get("trades") or []):
        if t.get("pnlUsd") is not None and t.get("usd"):
            out.append(("Crypto", t.get("label") or t.get("symbol", "crypto"), t["usd"], t["pnlUsd"], day(t.get("enteredAt")), day(t.get("exitedAt")), False))
    return out


def build(trades, spy_bars, now_iso):
    rows, tot = [], {"bot": 0.0, "spy": 0.0, "savings": 0.0}
    for desk, label, usd, pnl, s, e, is_open in trades:
        s0, e0 = close_on_or_before(spy_bars, s), close_on_or_before(spy_bars, e)
        spy = round(usd * (e0 / s0 - 1), 2) if s0 and e0 else None
        days_ = max(0, (date.fromisoformat(e) - date.fromisoformat(s)).days)
        sav = round(usd * SAVINGS_APY / 100 * days_ / 365, 2)
        rows.append({"desk": desk, "trade": label, "usd": usd, "from": s, "to": e, "open": is_open, "botUsd": pnl, "spyUsd": spy, "savingsUsd": sav})
        tot["bot"] += pnl; tot["spy"] += spy or 0; tot["savings"] += sav
    tot = {k: round(v, 2) for k, v in tot.items()}
    best = max(tot, key=lambda k: tot[k]) if rows else None
    verdict = ("No real trades yet." if not rows else
               "The bot is ahead of both." if best == "bot" else
               f"Doing nothing would have done better so far: {'holding SPY' if best == 'spy' else 'a savings account'} on the same dollars and days.")
    return {"generatedAt": now_iso, "savingsApyPct": SAVINGS_APY, "totals": tot, "verdict": verdict, "trades": rows,
            "note": "Same dollars, same days. Real-money trades only; open trades at their latest marked price. Past results do not predict future results."}


def main():
    sp = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py")); ob = importlib.util.module_from_spec(sp); sp.loader.exec_module(ob)
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    spy = ob.daily_bars("SPY", "2026-10-01")[0]
    out = build(real_trades(now), spy, now)
    json.dump(out, open(OUT, "w"), indent=1)
    print(out["totals"], out["verdict"])


if __name__ == "__main__":
    main()
