#!/usr/bin/env python3
"""ClaudeBot Historian: one leaderboard of every strategy the company has tested on history.

Reads the backtest files the research workflows write, ranks strategies by their OUT-OF-SAMPLE
(unseen-data) results, labels each LIVE / PAPER / REJECTED, and keeps a weekly history so a winner
that starts fading gets flagged. Read-only: it never trades and never changes rules.
Writes docs/data/claudebot-historian.json. Run weekly by .github/workflows/claudebot-historian.yml.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda n: os.path.join(ROOT, "docs", "data", n)
C = lambda n: os.path.join(ROOT, "claudebot", n)
OUT = D("claudebot-historian.json")
ACCOUNT = 117.0   # model account size for the North Star metric


def load(p):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def entry(id_, name, status, unit, oos, sample, source, note, generated):
    won = oos is not None and oos > 0
    return {"id": id_, "name": name, "status": status, "unit": unit, "outOfSample": oos, "sample": sample,
            "verdict": "won" if won else ("lost" if oos is not None else "untested"), "source": source, "note": note, "dataAsOf": generated}


def build():
    rows = []
    dip = load(D("claudebot-dip-backtest.json"))
    if dip and dip.get("chosenOnTrain"):
        t = dip["chosenOnTrain"]["test"]
        rows.append(entry("dip", "Dip desk: buy sharp dips in uptrending ETFs", "LIVE", "% per trade", t.get("avgTradePct"),
                          f"{t.get('trades')} unseen trades, {t.get('winRatePct')}% wins, PF {t.get('profitFactor')}", "claudebot-dip-backtest.json",
                          f"{dip.get('combosWithPositiveTest')} nearby settings also won on unseen data", dip.get("generatedAt")))
        sec = dip.get("sectorScan") or {}
        if sec.get("qualified"):
            rows.append(entry("dipSectors", "Dip desk on sector ETFs (" + ", ".join(sec["qualified"]) + ")", "LIVE", "% per trade",
                              round(sum(sec["bySymbol"][s]["test"]["avgTradePct"] for s in sec["qualified"]) / len(sec["qualified"]), 3),
                              f"{sum(sec['bySymbol'][s]['test']['trades'] for s in sec['qualified'])} unseen trades", "claudebot-dip-backtest.json",
                              "frozen live settings, passed both periods", dip.get("generatedAt")))
    rob = load(D("claudebot-options-robustness.json"))
    if rob:
        wf = rob.get("walkForward") or []
        oos = [w.get("outOfSample") or w.get("test") or {} for w in wf]
        n = sum(o.get("trades", 0) for o in oos)
        avg = round(sum(o.get("avgPnl", 0) * o.get("trades", 0) for o in oos) / n, 2) if n else None
        mc = (rob.get("monteCarlo") or {}).get("account113", {})
        rows.append(entry("spreads", "Put credit spreads (modeled option prices)", "PAPER", "$ per spread", avg,
                          f"{n} walk-forward trades" if n else "walk-forward missing", "claudebot-options-robustness.json",
                          f"Robinhood blocks bot spreads. At ~$113 the simulation ended up {mc.get('pctEndingUp', '?')}% of the time (median ${mc.get('medianEndUsd', '?')}); better at $300+",
                          rob.get("generatedAt")))
    dt = load(D("claudebot-daytrade-backtest.json"))
    if dt and dt.get("chosenOnTrain"):
        t = dt["chosenOnTrain"]["test"]
        rows.append(entry("daytrade", "Stock day trading (4 intraday strategies)", "PAPER", "% per trade", t.get("avgTradePct"),
                          f"{t.get('trades')} unseen trades; {dt.get('combosWithPositiveTest')} settings positive", "claudebot-daytrade-backtest.json",
                          dt.get("verdictText", ""), dt.get("generatedAt")))
    sc = load(D("claudebot-scalp-backtest.json"))
    if sc:
        for mk, label in (("acct120", "$120"), ("acct1000", "$1,000")):
            m = (sc.get("modes") or {}).get(mk) or {}
            ch = m.get("chosenOnTrain")
            if ch:
                t = ch.get("test") or ch.get("testCompounded") or {}
                rows.append(entry(f"scalp_{mk}", f"Options scalping, {label} account (real option prices)", "REJECTED", "% per trade",
                                  t.get("avgNetPctPerTrade"), f"{t.get('trades')} unseen trades, {t.get('winRatePct')}% wins; {m.get('combosPositiveInTest')} variants positive",
                                  "claudebot-scalp-backtest.json", "every variant lost after spreads and fees", sc.get("generatedAt")))
    ob = load(D("claudebot-optbuy-backtest.json"))
    ocfg = load(C("optbuy_config.json")) or {}
    if ob:
        for mk, label in (("acct117", "$117"), ("acct1000", "$1,000")):
            m = (ob.get("modes") or {}).get(mk) or {}
            for key, nm in (("chosenOnTrain", "best settings"), ("currentLiveRules", "the desk's rules")):
                r = m.get(key)
                if r:
                    t = r["test"]
                    rows.append(entry(f"calls_{mk}_{key}", f"Buy calls on dips, {nm}, {label} account (real option prices)",
                                      "LIVE" if ocfg.get("enabled") else "OFF", "% per trade", t.get("avgRetPct"),
                                      f"{t.get('trades')} unseen trades, {t.get('winRatePct')}% wins; {m.get('combosPositiveBoth')} variants won both periods",
                                      "claudebot-optbuy-backtest.json", f"same signals bought as the ETF: {t.get('sameSignalsEtfAvgPct')}% per trade", ob.get("generatedAt")))
    er = load(D("claudebot-edge-research.json"))
    for kind, st in ((er or {}).get("strategies") or {}).items():
        t = st["chosenOnTrain"]["test"]
        rows.append(entry(f"edge_{kind}", st["name"] + " (ETFs)", "CANDIDATE" if st["verdict"] == "edge" else "REJECTED", "% per trade", t.get("avgTradePct"),
                          f"{t.get('trades')} unseen trades, {t.get('winRatePct')}% wins, PF {t.get('profitFactor')}; {st['combosPositiveTest']} settings positive",
                          "claudebot-edge-research.json", f"overlaps the Dip desk on {t.get('overlapWithDipPct')}% of trades", er.get("generatedAt")))
    vo = {"won": 0, "untested": 1, "lost": 2}; so = {"LIVE": 0, "CANDIDATE": 1, "PAPER": 2, "OFF": 3, "REJECTED": 4}
    rows.sort(key=lambda r: (vo[r["verdict"]], so.get(r["status"], 9)))   # units differ ($ vs %), so no cross-ranking by size
    return rows


def cio_memo(rows, paper):
    """Chief Investment Officer memo: which strategy deserves the capital and why. Advisory only: it can
    rank and explain, but it has no authority over orders or limits (the risk governor decides those)."""
    live = [r for r in rows if r["status"] == "LIVE" and r["verdict"] == "won"]
    cands = [r for r in rows if r["status"] == "CANDIDATE" and r["verdict"] == "won"]
    lost = [r for r in rows if r["verdict"] == "lost"]
    osp = load(D("claudebot-optscalp-paper.json")) or {}
    lb = [r for r in osp.get("leaderboard", []) if r.get("id") != "notrade"]
    best_opt = max(lb, key=lambda r: r.get("pnlUsd") or 0) if lb else None
    traded = sum(r.get("trades") or 0 for r in lb)
    fc = (osp.get("forecast") or {})
    lines = []
    if live:
        b = max(live, key=lambda r: r["outOfSample"] or 0)
        lines.append(f"Capital goes to: {b['name']} ({b['outOfSample']:+} {b['unit']} on unseen data; {b['sample']}). The Dip desk is the only strategy with a proven edge.")
    if cands:
        lines.append("Next in line (paper, switch on automatically if proven): " + "; ".join(f"{r['name']} {r['outOfSample']:+} {r['unit']}" for r in cands) + ".")
    if traded:
        lines.append(f"Options paper race: {traded} paper trades so far; best variant {best_opt['name']} at ${best_opt['pnlUsd']:+.2f}. "
                     + ("A variant has passed every gate: proposal for the board." if osp.get("proposals") else "No variant has passed the gates; 'no trade' remains the better choice for real money."))
    else:
        lines.append("Options paper race: no completed paper trades yet; 'no trade' remains the better choice for real money.")
    if fc.get("samples"):
        lines.append(f"Learned forecast: {fc['samples']} observed moves; on average {round(100 * fc.get('carry', 0))}% of a 30-minute move carries on"
                     + (" (moves tend to snap back)" if fc.get("carry", 0) < 0 else "") + ".")
    if lost:
        lines.append("Not funded (lost on unseen data): " + ", ".join(r["name"] for r in lost[:4]) + (" and others." if len(lost) > 4 else "."))
    top_paper = [p for p in paper if (p.get("trades") or 0) > 0][:3]
    if top_paper:
        lines.append("Paper desks ranked by risk-adjusted growth (all still unproven): " + "; ".join(f"{p['desk']} {p['name']} {p.get('netGrowthPct', 0):+}%" for p in top_paper) + ".")
    return {"title": "CIO memo", "decision": lines[0] if lines else "Hold cash: nothing has a proven edge.", "lines": lines,
            "authority": "Advisory only. Orders and limits are decided by the planners and the independent risk governor."}


def main():
    now = datetime.now(timezone.utc).isoformat()
    prev = load(OUT) or {}
    rows = build()
    hist = prev.get("history", [])
    hist.append({"t": now, "scores": {r["id"]: r["outOfSample"] for r in rows}})
    hist = hist[-52:]
    alerts = []
    if len(hist) >= 2:
        last = hist[-2]["scores"]
        for r in rows:
            a, b = last.get(r["id"]), r["outOfSample"]
            if a is not None and b is not None and a > 0 and (b <= 0 or b < a * 0.5):
                alerts.append(f"{r['name']}: unseen-data result fell from {a} to {b} {r['unit']}. Review before trusting it.")
            if r["status"] == "LIVE" and b is not None and b <= 0:
                alerts.append(f"{r['name']} is LIVE but no longer wins on unseen data. Consider switching it off.")
    # forward evidence: every paper desk, ranked by real-time results (not backtests)
    paper, trade_lists = [], []
    for fn, desk in (("claudebot-edge-paper.json", "2nd edge"), ("claudebot-crypto-paper.json", "Crypto 24/7"), ("claudebot-optscalp-paper.json", "Options quick-profit"), ("claudebot-moonshot-paper.json", "Moonshot"), ("claudebot-dipcall-paper.json", "Dip calls"), ("claudebot-daytrade-paper.json", "Day trade"), ("claudebot-paper-ledger.json", "Paper Lab")):
        dsk = load(D(fn)) or {}
        for r in dsk.get("leaderboard", []) or []:
            n = r.get("trades") or 0
            if n == 0 and not r.get("open"):
                pass
            paper.append({"desk": desk, "name": r.get("name"), "trades": n, "winRatePct": r.get("winRatePct") if r.get("winRatePct") is not None else (round(100 * r["wins"] / n, 1) if n and r.get("wins") is not None else None),
                          "pnlUsd": r.get("pnlUsd"), "profitFactor": r.get("profitFactor")})
            st = (dsk.get("strategies") or {}).get(r.get("id")) or {}
            trade_lists.append([x.get("pnlUsd", 0) or 0 for x in st.get("trades", []) or [] if isinstance(x, dict)])
    # North Star (board, 2026-11-03): risk-adjusted net account growth on a ~$117 account, not win rate.
    # growth = net P&L after costs as % of the account; ranked by growth per unit of worst drawdown.
    for r, trades in zip(paper, trade_lists):
        eq = peak = dd = 0.0
        for t in trades:
            eq += t; peak = max(peak, eq); dd = min(dd, eq - peak)
        r["netGrowthPct"] = round(100 * (r["pnlUsd"] or 0) / ACCOUNT, 2)
        r["maxDrawdownPct"] = round(100 * dd / ACCOUNT, 2)
        r["northStar"] = round(r["netGrowthPct"] / (1 + abs(r["maxDrawdownPct"])), 3)
    paper.sort(key=lambda r: -r["northStar"])
    cio = cio_memo(rows, paper)
    out = {"generatedAt": now, "leaderboard": rows, "paperLeaderboard": paper, "winners": [r["name"] for r in rows if r["verdict"] == "won"],
           "losers": [r["name"] for r in rows if r["verdict"] == "lost"], "alerts": alerts, "history": hist, "cio": cio,
           "northStar": "Paper desks are ranked by risk-adjusted net account growth: net P&L after costs as % of a $117 account, divided by (1 + worst drawdown %). Win rate alone never ranks a strategy.",
           "rule": "Ranked by out-of-sample (unseen-data) results only. Picking on old data and checking on new data is the only test that counts."}
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1); f.write("\n")
    print(json.dumps({"winners": out["winners"], "losers": out["losers"], "alerts": alerts}, indent=1))


if __name__ == "__main__":
    main()
