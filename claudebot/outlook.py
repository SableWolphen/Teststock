#!/usr/bin/env python3
"""Exit outlook: in plain numbers, what each held Dip-desk position is waiting for.

READ ONLY. It never trades and never changes a rule. It restates the sell conditions in
dip_bot.plan as prices and dates so the site can say "sells at $X or higher, stop at $Y, time
limit <date>" instead of a generic sentence. test_outlook.py checks that these numbers agree with
what the live planner actually does, so the two cannot drift apart unnoticed.
"""
from __future__ import annotations

import importlib.util
import os
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
CT = ZoneInfo("America/Chicago")
RULE_NAMES = {"dip": "Dip", "double7": "Double 7s", "down3": "3 down days"}


def _dip_bot():
    sp = importlib.util.spec_from_file_location("dip_bot_for_outlook", os.path.join(HERE, "dip_bot.py"))
    m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)
    return m


def is_trading_day(d: date, holidays=()):
    return d.weekday() < 5 and d.isoformat() not in holidays


def next_trading_day(d: date, holidays=()):
    d = date.fromordinal(d.toordinal() + 1)
    while not is_trading_day(d, holidays):
        d = date.fromordinal(d.toordinal() + 1)
    return d


def session_date(local: datetime, holidays=()):
    """The session the outlook is for: today until the 3 PM CT close, otherwise the next trading day."""
    d = local.date()
    if is_trading_day(d, holidays) and local.time() < time(15, 0):
        return d
    return next_trading_day(d, holidays)


def _md(d: date):
    return f"{d.strftime('%b')} {d.day}"


def _cent_at_or_below(v):
    c = round(v, 2)
    return round(c - 0.01, 2) if c > v else c


def _cent_at_or_above(v):
    c = round(v, 2)
    return round(c + 0.01, 2) if c < v else c


def exit_outlook(pos, closes, price, cfg, session: date, holidays=()):
    """closes = completed daily closes BEFORE `session`; price = latest price."""
    db = _dip_bot()
    x = cfg["exit"]; rule = pos.get("rule", "dip"); er = (cfg.get("edges") or {}).get(rule, {})
    c = [float(v) for v in closes]; price = float(price); entry = float(pos["entryPrice"])
    # The planner sells at price <= entry * (1 - stop%). Show the highest whole-cent price that does that.
    stop = _cent_at_or_below(entry * (1 - x["stopPct"] / 100))
    later = None
    if rule == "double7":
        k = int(er.get("k", 7)); prior = c[-(k - 1):] if k > 1 else [price]
        level, or_higher, why = max(prior), True, f"a {k}-day high"
        for j in range(1, k):                          # when does the level drop if the price just holds?
            lv = max((c + [price] * j)[-(k - 1):]) if k > 1 else price
            if lv < level - 0.005:
                d = session
                for _ in range(j):
                    d = next_trading_day(d, holidays)
                later = {"session": d.isoformat(), "price": round(lv, 2)}
                break
    elif rule == "down3":
        level, or_higher, why = c[-1], False, "an up day versus the previous close"
    else:
        n = int(x["smaBounce"]); level, or_higher = sum(c[-(n - 1):]) / (n - 1), False
        why = f"back over its {n}-day average"
    # whole cents, rounded the way the planner's comparison works (>= for a high, > for the others)
    level = _cent_at_or_above(level) if or_higher else _cent_at_or_below(level)
    entered = datetime.fromisoformat(pos["enteredAt"].replace("Z", "+00:00")).astimezone(CT).date()
    max_hold = int(er.get("maxHoldDays") or x["maxHoldDays"])
    limit = entered
    while db.trading_days_between(entered, limit) < max_hold or not is_trading_day(limit, holidays):
        limit = date.fromordinal(limit.toordinal() + 1)
    away = round(100 * (level / price - 1), 2) if price > 0 else None
    reached = price >= level if or_higher else price > level
    out = {"symbol": pos["symbol"], "rule": rule, "ruleName": er.get("name") or RULE_NAMES.get(rule, rule),
           "entryPrice": entry, "lastPrice": round(price, 2), "session": session.isoformat(),
           "sellAt": {"price": level, "orHigher": or_higher, "why": why}, "awayPct": away,
           "stopPrice": stop, "timeLimit": limit.isoformat(), "later": later,
           "boughtThisSession": entered == session}
    if out["boughtThisSession"]:
        head = "Bought today, so sell checks start next session."
    elif reached:
        head = f"At ${price:.2f} it has reached the sell level (${level:.2f}, {why}): it sells at the next check."
    else:
        head = (f"Sells at ${level:.2f} or higher" if or_higher else f"Sells above ${level:.2f}") + \
               f" ({why}); now ${price:.2f}, {abs(away):.1f}% below that."
    tail = f" Stop at ${stop:.2f}. Time limit {_md(limit)}."
    if rule == "dip":
        tail = f" A strong two-day bounce (RSI(2) over {x['rsi2Above']}) also sells." + tail
    if later and not reached:
        tail += f" If the price holds, the sell level drops to about ${later['price']:.2f} on {_md(date.fromisoformat(later['session']))}."
    out["text"] = head + tail
    return out
