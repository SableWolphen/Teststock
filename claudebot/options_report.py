#!/usr/bin/env python3
"""Options report card (board, 2026-11-11: "find a better way to learn which ones to get, to not lose
money quickly"). One small file that puts every options idea the company has tested side by side:
what it buys, what a contract costs, how it did on unseen historical prices, how it is doing on paper
at live prices, and whether the account can even buy it.

READ ONLY. It only reads result files that other jobs already wrote (no prices, no network, no orders,
no rule changes) and writes docs/data/claudebot-options-report.json for the site.
Past results do not predict future results.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data")
OUT = os.path.join(DATA, "claudebot-options-report.json")


def load(name, root=DATA):
    try:
        with open(os.path.join(root, name)) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def rng(vals, fmt="{:.0f}", suffix=""):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    lo, hi = min(vals), max(vals)
    return (fmt.format(lo) if lo == hi else f"{fmt.format(lo)} to {fmt.format(hi)}") + suffix


def money(v):
    return ("-" if v < 0 else "+") + f"${abs(v):,.2f}"


def paper_stats(trades):
    pn = [t.get("pnlUsd") for t in trades if t.get("pnlUsd") is not None]
    return {"trades": len(pn), "wins": sum(1 for p in pn if p > 0), "netUsd": round(sum(pn), 2)} if pn else {"trades": 0, "wins": 0, "netUsd": 0.0}


def build(data_dir=DATA, cfg_dir=os.path.join(ROOT, "claudebot")):
    L = lambda n: load(n, data_dir)
    dcr, dcp, obb, sbt, osp, spp = (L("claudebot-dipcall-research.json"), L("claudebot-dipcall-paper.json"), L("claudebot-optbuy-backtest.json"),
                                    L("claudebot-scalp-backtest.json"), L("claudebot-optscalp-paper.json"), L("claudebot-spread-paper.json"))
    optcfg = load("optbuy_config.json", cfg_dir)
    cap = (optcfg.get("risk") or {}).get("maxPremiumUsd", 50)
    rows = []

    # 1) Dip calls: at/in the money, 30-60 days, held exactly as long as the stock rule
    calls = [r for r in dcr.get("rows", []) if r.get("side") == "calls" and (r.get("test") or {}).get("trades")]
    if calls:
        t = [r["test"] for r in calls]
        both = (dcr.get("calls") or {}).get("settingsPositiveBoth")
        dp = paper_stats([x for st in (dcp.get("strategies") or {}).values() for x in st.get("trades") or []])
        rows.append({
            "id": "dipcalls", "verdict": "held up" if (dcr.get("calls") or {}).get("verdict") == "edge" else "not proven",
            "type": "Calls at or in the money, 30 to 60 days out, bought on the Dip signal and sold when the fund's own sell rule fires",
            "cost": "$" + rng([x.get("medianPremiumUsd") for x in t], "{:,.0f}") + " per contract (typical)",
            "history": f"{both} settings made money in both the pick and the unseen period. Unseen: {rng([x['trades'] for x in t])} trades, "
                       f"{rng([x['winRatePct'] for x in t], '{:.0f}', '%')} wins, {rng([x['avgRetPct'] for x in t], '{:+.1f}', '%')} average per trade. "
                       f"Single trades still lost up to {abs(min(x['worstRetPct'] for x in t)):.0f}% of the premium.",
            "paper": f"{dp['trades']} paper trades so far" + (f", net {money(dp['netUsd'])}" if dp["trades"] else " (it buys on paper at each Dip signal; needs 20+ before any proposal)"),
            "affordable": max(x.get("affordableAt117Pct") or 0 for x in t) > 0,
            "canBuy": "No: one contract costs several times the whole account", "status": "Paper only"})
    # 2) Cheap out-of-the-money calls on the same signal (what the cap can buy)
    a = (obb.get("modes") or {}).get("acct117") or {}
    if a.get("chosenOnTrain"):
        te = a["chosenOnTrain"].get("test") or {}
        rows.append({
            "id": "cheapcalls", "verdict": "lost",
            "type": "Cheap out-of-the-money calls on the same signal (what the bot's cap can buy)",
            "cost": f"up to ${cap:.0f} per contract",
            "history": f"{a.get('combosPositiveBoth', '?')} settings made money in both periods. The setting that looked best on the pick period then went "
                       f"{te.get('trades')} unseen trades, {te.get('winRatePct'):.0f}% wins, account {te.get('returnPct'):+.0f}%.",
            "paper": "not paper traded", "affordable": True, "canBuy": "Yes",
            "status": "Live desk exists but is switched off" if not optcfg.get("enabled") else "LIVE"})
    # 2b) The winning recipe with the closest-to-the-price call the cap can buy (board idea, 2026-11-11)
    ch, chp = L("claudebot-dipcall-cheap-research.json"), L("claudebot-cheapcall-paper.json")
    if ch.get("rows"):
        tr = [r["train"] for r in ch["rows"] if r["train"].get("trades")]; te = [r for r in ch["rows"] if r["test"].get("trades")]
        won_unseen = [r for r in te if (r["test"].get("avgRetPct") or -1) > 0]
        verdict = "held up" if ch.get("verdict") == "held up" else "mixed" if won_unseen else "lost"
        cp = paper_stats([x for st in (chp.get("strategies") or {}).values() for x in st.get("trades") or []])
        per = "; ".join(f"{r['dte']} days: {r['test']['trades']} trades, {r['test']['winRatePct']:.0f}% wins, {r['test']['avgRetPct']:+.1f}% average" for r in te)
        rows.append({
            "id": "cheapdipcalls", "verdict": verdict,
            "type": "The same recipe with the closest-to-the-price call that costs $50 or less",
            "cost": f"up to ${ch.get('capUsd', cap):.0f} per contract, sitting {rng([r['test'].get('avgOtmPct') for r in te], '{:.0f}', '%')} above the price on average",
            "history": f"{ch.get('settingsPositiveBoth')} settings made money in both periods. Pick period (2024): "
                       f"{'lost at every expiry' if all((x.get('avgRetPct') or 0) <= 0 for x in tr) else 'mixed'}. Unseen (2025-26): {per}. "
                       f"Single trades lost up to {abs(min(r['test']['worstRetPct'] for r in te)):.0f}%. "
                       f"For {rng([r['noAffordableContract'] for r in ch['rows']])} of {ch['rows'][0]['signals']} signals, no contract within 15% of the price fit the cap.",
            "paper": (f"{cp['trades']} paper trades, net {money(cp['netUsd'])}" if cp["trades"] else "0 paper trades so far (its forward test at live prices has just started)"),
            "affordable": True, "canBuy": "Yes", "status": "Paper test at live prices"})
    # 3) Quick in-and-out trades
    s = (sbt.get("modes") or {}).get("acct120") or {}
    seen, alls = set(), []
    for st in (osp.get("strategies") or {}).values():
        for x in st.get("trades") or []:
            alls.append(x); seen.add((x.get("symbol"), (x.get("boughtAt") or "")[:16]))
    if s or alls:
        ps = paper_stats(alls)
        spreads = [x.get("spreadPct") for x in alls if x.get("spreadPct") is not None]
        rows.append({
            "id": "scalps", "verdict": "lost",
            "type": "Quick in-and-out trades (minutes to an hour) on cheap contracts",
            "cost": f"up to ${cap:.0f} per contract",
            "history": f"{s.get('combosPositiveInTest', '?')} settings made money on unseen data.",
            "paper": (f"{len(seen)} contracts bought on paper, replayed through {len([1 for st in (osp.get('strategies') or {}).values() if st.get('trades')])} sell rules: "
                      f"{ps['wins']} of {ps['trades']} results positive. The buy/sell gap alone cost {rng(spreads, '{:.0f}', '%')} of the price each time.") if alls else "no paper trades",
            "affordable": True, "canBuy": "Yes",
            "status": "Retired: nothing is bought unless the forecast after costs is positive, and it has not been"})
    # 4) Puts on the mirror signal
    puts = [r for r in dcr.get("rows", []) if r.get("side") == "puts" and (r.get("test") or {}).get("trades")]
    if puts:
        t = [r["test"] for r in puts]
        rows.append({
            "id": "puts", "verdict": "no edge",
            "type": "Puts on the mirror-image signal (overbought in a downtrend)",
            "cost": "$" + rng([x.get("medianPremiumUsd") for x in t], "{:,.0f}") + " per contract (typical)",
            "history": f"No setting held up; only {sum(x['trades'] for x in t)} unseen trades in total, mixed results.",
            "paper": "not paper traded", "affordable": False, "canBuy": "No: too expensive", "status": "Not traded"})
    # 5) Put credit spreads
    lb = [r for r in (spp.get("leaderboard") or []) if r.get("id") == "spreads"]
    if lb:
        r = lb[0]
        rows.append({
            "id": "spreads", "verdict": "too early" if (r.get("trades") or 0) < 20 else ("held up" if (r.get("pnlUsd") or 0) > 0 else "lost"),
            "type": "Put credit spreads ($1 wide, sell a put and buy a lower one)",
            "cost": "up to about $100 at risk per spread",
            "history": "not in this report",
            "paper": f"{r.get('trades')} paper trades, net {money(r.get('pnlUsd') or 0)}",
            "affordable": False, "canBuy": "Not by the bot: Robinhood does not accept two-leg orders from it", "status": "Paper only"})
    affordable_ok = [r for r in rows if r["affordable"] and r["verdict"] == "held up"]
    lessons = []
    if rows:
        aff = [r for r in rows if r["affordable"]]
        mixed = [r for r in aff if r["verdict"] == "mixed"]
        lessons.append("At least one affordable kind held up: see below." if affordable_ok else
                       "The only kind that clearly held up costs far more than the account. Of the kinds the account can afford, "
                       + (f"{len(aff) - len(mixed)} lost and {len(mixed)} gave mixed results (it lost in one period and made money in the other)." if mixed
                          else "every one lost on unseen data."))
        lessons.append("Cheap contracts are far from the price and close to expiry, so they lose value fastest and the buy/sell gap takes a bigger share.")
        lessons.append("How it is sold matters as much as what is bought: the kind that held up followed the stock rule's own exit instead of a fixed target.")
    return {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "note": "Read-only summary of results other jobs produced. Paper and history only. Past results do not predict future results.",
            "premiumCapUsd": cap, "anyAffordableKindHeldUp": bool(affordable_ok), "rows": rows, "lessons": lessons}


def main():
    out = build()
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1); f.write("\n")
    for r in out["rows"]:
        print(f"{r['verdict']:10} | {r['type'][:60]:60} | {r['cost']}")
    print("lessons:", *out["lessons"], sep="\n  ")


if __name__ == "__main__":
    main()
