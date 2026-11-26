#!/usr/bin/env python3
"""One shared US-equity market calendar for every ClaudeBot script (2026-11-26).

Before this, five files carried their own copy of the holiday list, none knew about early closes,
and the audit knew neither (Thanksgiving 2026 produced a false "Trader is running" fail).
Times are America/Chicago. Regular session 8:30-15:00 CT; early-close days end 12:00 CT.
Keep the lists in sync with the NYSE calendar each year (add the next year before December).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

CT = ZoneInfo("America/Chicago")
OPEN_MIN = 8 * 60 + 30
CLOSE_MIN = 15 * 60
EARLY_CLOSE_MIN = 12 * 60

HOLIDAYS = frozenset({
    "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
    "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
})
EARLY_CLOSES = frozenset({"2026-11-27", "2026-12-24", "2027-11-26"})


def _d(d) -> str:
    return d if isinstance(d, str) else d.isoformat()


def is_trading_day(d) -> bool:
    if isinstance(d, str):
        d = date.fromisoformat(d)
    return d.weekday() < 5 and d.isoformat() not in HOLIDAYS


def close_minute(d) -> int:
    """Minute of day (CT) the regular session ends on trading day d."""
    return EARLY_CLOSE_MIN if _d(d) in EARLY_CLOSES else CLOSE_MIN


def market_open(now: datetime) -> bool:
    loc = now.astimezone(CT)
    m = loc.hour * 60 + loc.minute
    return is_trading_day(loc.date()) and OPEN_MIN <= m < close_minute(loc.date())


def minutes_to_close(now: datetime) -> float:
    """Minutes until today's close (negative after it, None on a non-trading day)."""
    loc = now.astimezone(CT)
    if not is_trading_day(loc.date()):
        return None
    return close_minute(loc.date()) - (loc.hour * 60 + loc.minute + loc.second / 60)


def next_open(now: datetime) -> datetime:
    """UTC time of the next regular-session open strictly after the current session (or now)."""
    loc = now.astimezone(CT)
    d = loc.date()
    if not (is_trading_day(d) and loc.hour * 60 + loc.minute < OPEN_MIN):
        d += timedelta(days=1)
        while not is_trading_day(d):
            d += timedelta(days=1)
    return datetime.combine(d, time(OPEN_MIN // 60, OPEN_MIN % 60), CT).astimezone(timezone.utc)


def trading_days_between(a: date, b: date) -> int:
    """Trading days after a, up to and including b."""
    n, d = 0, a
    while d < b:
        d += timedelta(days=1)
        if is_trading_day(d):
            n += 1
    return n
