#!/usr/bin/env python3
"""Robustness checks for the ClaudeBot put-spread rule (the MT5-style checklist):
cost stress, parameter sweep, per-year breakdown, walk-forward, Monte Carlo.
Modeled option prices, so this checks the rule's shape, not exact P&L.
Writes docs/data/claudebot-options-robustness.json."""
import copy, importlib.util, itertools, json, os, random, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ob", os.path.join(HERE, "options_backtest.py"))
ob = importlib.util.module_from_spec(spec); spec.loader.exec_module(ob)
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-options-robustness.json")
BASE = copy.deepcopy(ob.CFG)
SYMS = BASE["underlyings"]


def trades_for(data, params, slip=None):
    cfg = copy.deepcopy(BASE)
    cfg["entry"]["maxShortDelta"] = params["delta"]
    cfg["entry"]["targetDte"] = params["dte"]
    cfg["exit"]["takeProfitPctOfCredit"] = params["tp"]
    cfg["exit"]["stopAtMultipleOfCredit"] = params["stop"]
    if slip is not None:
        cfg["model"]["slippagePerSpread"] = slip
    ob.CFG = cfg
    out = []
    for sym, (bars, ivs) in data.items():
        for t in ob.run(bars, ivs, True, unlimited=True, keep_trades=True):
            out.append({**t, "symbol": sym})
    ob.CFG = BASE
    return out


def stats(tr):
    if not tr:
        return dict(trades=0)
    w = [t["pnl"] for t in tr if t["pnl"] > 0]; l = [t["pnl"] for t in tr if t["pnl"] <= 0]
    eq = pk = dd = 0.0
    for t in sorted(tr, key=lambda t: t["exited"]):
        eq += t["pnl"]; pk = max(pk, eq); dd = min(dd, eq - pk)
    return dict(trades=len(tr), winRatePct=round(100 * len(w) / len(tr), 1), avgPnl=round(sum(w + l) / len(tr), 2),
                avgWin=round(sum(w) / len(w), 2) if w else None, avgLoss=round(sum(l) / len(l), 2) if l else None,
                profitFactor=round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, totalPnl=round(sum(w + l), 2),
                maxDrawdownUsd=round(dd, 2),
                exits={k: sum(1 for t in tr if t["why"] == k) for k in ("take profit", "stop", "short strike breached", "expiry")})


def monte_carlo(pnls, start, need, floor, n_trades=40, runs=20000, seed=7):
    rnd = random.Random(seed); ends = []; paused = 0; stuck = 0
    for _ in range(runs):
        eq = start
        for _ in range(n_trades):
            if eq < floor:
                paused += 1; break
            if eq < need:
                stuck += 1; break
            eq += rnd.choice(pnls)
        ends.append(eq)
    ends.sort()
    return dict(trades=n_trades, runs=runs, startUsd=start, pctEndingUp=round(100 * sum(e > start for e in ends) / runs, 1),
                pctStuckOrPaused=round(100 * (paused + stuck) / runs, 1), medianEndUsd=round(ends[runs // 2], 2),
                p10EndUsd=round(ends[runs // 10], 2), p90EndUsd=round(ends[runs * 9 // 10], 2))


def main():
    data = {}
    for s in SYMS:
        bars, _ = ob.daily_bars(s, BASE["backtest"]["start"])
        data[s] = (bars, ob.vol_index(ob.VOL_INDEX[s]) if s in ob.VOL_INDEX else {})
    base = dict(delta=BASE["entry"]["maxShortDelta"], dte=BASE["entry"]["targetDte"],
                tp=BASE["exit"]["takeProfitPctOfCredit"], stop=BASE["exit"]["stopAtMultipleOfCredit"])
    bt = trades_for(data, base)
    res = dict(generatedAt=datetime.now(timezone.utc).isoformat(), symbols=SYMS, baseline=dict(params=base, **stats(bt)))
    res["byYear"] = {y: stats([t for t in bt if t["entered"][:4] == y]) for y in sorted({t["entered"][:4] for t in bt})}
    res["bySymbol"] = {s: stats([t for t in bt if t["symbol"] == s]) for s in SYMS}
    res["costStress"] = {f"slippage {sl}": stats(trades_for(data, base, sl)) for sl in (0.02, 0.04, 0.06)}
    grid = []
    for d, dte, tp, st in itertools.product((0.15, 0.18, 0.22, 0.26, 0.30), (7, 11, 16), (40, 50, 65), (2.0, 2.5, 3.5)):
        p = dict(delta=d, dte=dte, tp=tp, stop=st)
        tr = trades_for(data, p)
        grid.append(dict(params=p, all=stats(tr), trades=tr))
    # walk-forward: pick the best params on all data before year Y (>=40 trades), trade year Y
    wf = []
    for y in ("2024", "2025", "2026"):
        best = max((g for g in grid if len([t for t in g["trades"] if t["entered"][:4] < y]) >= 40),
                   key=lambda g: stats([t for t in g["trades"] if t["entered"][:4] < y])["avgPnl"])
        wf.append(dict(year=y, chosen=best["params"], inSample=stats([t for t in best["trades"] if t["entered"][:4] < y]),
                       outOfSample=stats([t for t in best["trades"] if t["entered"][:4] == y]),
                       baselineSameYear=res["byYear"].get(y)))
    res["walkForward"] = wf
    res["grid"] = sorted(({"params": g["params"], **g["all"]} for g in grid), key=lambda g: -(g.get("avgPnl") or -99))
    pnls = [t["pnl"] for t in bt]
    res["monteCarlo"] = dict(
        account113=monte_carlo(pnls, 113, 86, BASE["risk"]["pauseBelowAccountValueUsd"]),
        account300=monte_carlo(pnls, 300, 86, BASE["risk"]["pauseBelowAccountValueUsd"]),
        note="Resamples the baseline's modeled per-spread P&L, 1 spread at a time. 'Stuck' = too little cash (~$86) to open the next spread.")
    json.dump(res, open(OUT, "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "grid"}, indent=1)[:6000])
    res["gridTopMin150Trades"] = [g for g in res["grid"] if g.get("trades", 0) >= 150][:15]
    json.dump(res, open(OUT, "w"), indent=1)
    print("TOP GRID"); [print(g) for g in res["gridTopMin150Trades"]]


if __name__ == "__main__":
    main()
