"""Offline, deterministic verification of forward-only paper fills and fail-closed governance."""
from __future__ import annotations

import copy
import json
import tempfile
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from tournament import (
    MAX_ENTRY_GAP_PCT, STRATEGIES, SYMS, agent_health, build_report,
    new_state, normalize_bars, options_challengers, process_day,
    summarize_strategy, update, validate_universe
)
from tournament_audit import validate


def business_dates(count, first=date(2025, 1, 2)):
    days = []
    d = first
    while len(days) < count:
        if d.weekday() < 5:
            days.append(d.isoformat())
        d += timedelta(days=1)
    return days


def raw_bar(day, o, c, low=None):
    return {"t": day + "T05:00:00Z", "o": o,
            "h": max(o, c) * 1.01,
            "l": min(o, c) * .99 if low is None else low,
            "c": c, "v": 150000}


def fixture(count=225):
    days = business_dates(count + 3)
    prices = [100 + .1 * i for i in range(count)]
    # Three closes lower while above SMA200: generates an after-close down3 signal.
    prices[-3:] = [prices[-4] - .2, prices[-4] - .4, prices[-4] - .6]
    out = {s: [raw_bar(days[i], p, p) for i, p in enumerate(prices)]
           for s in SYMS}
    return out, days


def at(day):
    return datetime.combine(date.fromisoformat(day), time(22, 0), tzinfo=timezone.utc)


bars, days = fixture()
state = new_state()
update(state, bars, at(days[224]))
assert state["lastProcessedDay"] == days[224]
assert all(len(v["trades"]) == 0 for v in state["strategies"].values())
assert state["strategies"]["down3"]["pending"]
assert not state["strategies"]["down3"]["positions"]
# An after-close signal must not fabricate same-close entries.
report = build_report(state, Path("docs/data"), at(days[224]))
assert validate(state, report)
assert report["decision"] == "NO_NEW_LIVE_STRATEGIES"
assert report["researchLeader"] is None
assert all(row["liveEligible"] is False for row in report["etfLeaderboard"])
assert not report["optionsCohort"]["comparableToEtf"]

# Next session: orders fill at the observed opening price plus cost, not
# at the previous close. Only three positions allowed in a $100 paper sleeve.
close = bars[SYMS[0]][-1]["c"]
for s in SYMS:
    bars[s].append(raw_bar(days[225], close * 1.001, close * 1.01))
update(state, bars, at(days[225]))
desk = state["strategies"]["down3"]
assert len(desk["positions"]) == 3
assert all(p["entryDay"] == days[225] and p["signalDay"] == days[224]
           and p["entryFill"] > p["entryOpenRaw"] for p in desk["positions"].values())
assert desk["skips"].get("PAPER_CAPACITY_OR_DUPLICATE", 0) >= 1
assert all(order["side"] == "SELL" for order in desk["pending"].values())
for s in SYMS:
    bars[s].append(raw_bar(days[226], close * 1.015, close * 1.02))
update(state, bars, at(days[226]))
assert len(desk["positions"]) == 0
assert len(desk["trades"]) == 3
for tr in desk["trades"]:
    assert tr["entrySignalDay"] < tr["entryDay"] < tr["exitDay"]
    assert tr["entryFill"] > tr["entryOpenRaw"]
    assert tr["exitFill"] < tr["exitReference"]
    assert tr["grossPnlUsd"] > tr["netPnlUsd"] > tr["stressedNetUsd"]
old = copy.deepcopy(state)
update(state, bars, at(days[226]))  # rerun idempotence
assert state["strategies"] == old["strategies"]
report = build_report(state, Path("docs/data"), at(days[226]))
assert validate(state, report)
assert all(row["researchLeader"] is None for row in [report])

# The gap-through-stop model can lose more than the nominal five-percent stop.
gap_state = new_state()
update(gap_state, {s: bs[:-2] for s, bs in bars.items()}, at(days[224]))
opening = close * 1.001
for s in SYMS:
    rows = bars[s][:225] + [raw_bar(days[225], opening, opening, low=opening * .90)]
    bars[s] = rows
update(gap_state, bars, at(days[225]))
stops = gap_state["strategies"]["down3"]["trades"]
assert stops and all(t["why"].startswith("intraday stop") for t in stops)
assert all(t["netPnlUsd"] < 0 for t in stops)
assert validate(gap_state, build_report(gap_state, Path("docs/data"), at(days[225])))

# Skip entries after a large adverse next-day opening gap, rather than invent
# perfect fills at yesterday's close.
gap_skips = new_state()
update(gap_skips, {s: bs[:225] for s, bs in bars.items()}, at(days[224]))
for s in SYMS:
    bars[s] = bars[s][:225] + [raw_bar(days[225], close * (1 + (MAX_ENTRY_GAP_PCT + 1) / 100),
                                          close * 1.05)]
update(gap_skips, bars, at(days[225]))
assert not gap_skips["strategies"]["down3"]["positions"]
assert gap_skips["strategies"]["down3"]["skips"].get("GAP_TOO_LARGE_SKIP") == len(SYMS)

# Malformed/nonfinite observations and incomplete universes must fail, never
# produce success-shaped scorecards.
for corrupt in (
    lambda b: b.pop(SYMS[0]),
    lambda b: b[SYMS[0]][-1].update({"c": float("nan")}),
    lambda b: b[SYMS[0]][-1].update({"v": 0}),
):
    bad = copy.deepcopy(bars)
    corrupt(bad)
    try:
        valid = {s: normalize_bars(s, rows) for s, rows in bad.items()}
        validate_universe(valid, at(days[225]))
        raise AssertionError("Malformed/incomplete feed was accepted")
    except ValueError:
        pass
# Replayed historic bars are not counted as independent forward trades.
state2 = new_state()
update(state2, {s: bs[:225] for s, bs in bars.items()}, at(days[224]))
assert not any(st["trades"] for st in state2["strategies"].values())

# Independent accounting validator catches report tampering and unsafe
# promotions, even after a producer's own tests have passed.
for mutate in (
    lambda s, r: r.update({"autoPromote": True}),
    lambda s, r: r["etfLeaderboard"][1].update({"netPaperUsd": 999}),
    lambda s, r: r["optionsCohort"].update({"comparableToEtf": True}),
    lambda s, r: r.update({"brokerVerified": True}),
    lambda s, r: r.update({"account_number": "private"}),
):
    s, r = copy.deepcopy(state), copy.deepcopy(report)
    mutate(s, r)
    try:
        validate(s, r)
        raise AssertionError("Unsafe/tampered report was accepted")
    except ValueError:
        pass

with tempfile.TemporaryDirectory() as tmp:
    data = Path(tmp)
    (data / "claudebot-hr.json").write_text(json.dumps(
        {"fired": [{"agent": "moxie"}]}))
    (data / "claudebot-optbuy-scan.json").write_text(json.dumps(
        {"generatedAt": at(days[224]).isoformat()}))
    health = agent_health(data, at(days[225]))
    assert health["moxie_moonshot"]["status"] == "INACTIVE"
    assert health["clio_historian"]["status"] == "MISSING"
    assert health["scout_etf_watch"]["status"] == "HEALTHY"
    (data / "claudebot-optscalp-paper.json").write_text(json.dumps({
        "mode": "paper", "strategies": {"a": {"trades": [{"day": "2026-01-01", "symbol": "C", "boughtAt": "T"}]},
                                        "b": {"trades": [{"day": "2026-01-01", "symbol": "C", "boughtAt": "T"}]}}}))
    cohort = options_challengers(data)
    assert cohort["distinctUnderlyingOpportunities"] == 1
    assert not cohort["comparableToEtf"]

print("forward-only modeled fill, no lookahead, stress accounting, independence, health and safety tests passed")
