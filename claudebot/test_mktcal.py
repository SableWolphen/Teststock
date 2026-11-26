#!/usr/bin/env python3
"""Shared market calendar: holidays, early closes, next open, trading-day counts."""
import os, sys
from datetime import date, datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mktcal as m  # noqa: E402
import governor as g  # noqa: E402

u = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
assert not m.market_open(u("2026-11-26T17:00:00Z"))            # Thanksgiving
assert m.market_open(u("2026-11-27T17:30:00Z"))                # 11:30 CT early-close day
assert not m.market_open(u("2026-11-27T18:05:00Z"))            # 12:05 CT after early close
assert m.market_open(u("2026-11-30T20:30:00Z"))                # normal Monday 14:30 CT
assert not g.market_open(u("2026-11-27T18:05:00Z"))            # governor follows the calendar
assert m.next_open(u("2026-11-26T17:00:00Z")) == u("2026-11-27T14:30:00Z")
assert m.next_open(u("2026-11-27T19:00:00Z")) == u("2026-11-30T14:30:00Z")   # over the weekend
assert m.next_open(u("2026-11-30T12:00:00Z")) == u("2026-11-30T14:30:00Z")   # pre-open: today
assert m.next_open(u("2026-12-24T19:00:00Z")) == u("2026-12-28T14:30:00Z")   # skips Christmas
assert m.trading_days_between(date(2026, 11, 24), date(2026, 11, 30)) == 3   # 25, 27, 30
assert m.minutes_to_close(u("2026-11-27T17:00:00Z")) == 60
print("mktcal ok")
