#!/usr/bin/env python3
"""Board question 2026-11-19: would a half-size ($0.50-wide) put credit spread lose money?
Same modeled backtest and rules as options_robustness.py (2023-now, the live underlyings),
run side by side at $1 and $0.50 wide. Fees ($0.20 round trip) and fill slippage ($0.02 per
spread) are per spread, so they do NOT shrink with the width. Minimum credit is scaled with
the width. Modeled option prices: this checks the shape, not exact P&L.
Writes docs/data/claudebot-options-halfsize.json. Places no orders."""
import copy, importlib.util, json, os
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("rb", os.path.join(HERE, "options_robustness.py"))
rb = importlib.util.module_from_spec(spec); spec.loader.exec_module(rb)
ob = rb.ob
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-options-halfsize.json")


def run_width(data, width, slip):
    cfg = copy.deepcopy(rb.BASE)
    cfg["entry"]["widthUsd"] = width
    cfg["entry"]["minCreditUsd"] = round(rb.BASE["entry"]["minCreditUsd"] * width / rb.BASE["entry"]["widthUsd"], 3)
    cfg["model"]["slippagePerSpread"] = slip
    ob.CFG = cfg
    out = []
    for sym, (bars, ivs) in data.items():
        for t in ob.run(bars, ivs, True, unlimited=True, keep_trades=True):
            out.append({**t, "symbol": sym})
    ob.CFG = rb.BASE
    return out


def main():
    data = {}
    for s in rb.SYMS:
        bars, _ = ob.daily_bars(s, rb.BASE["backtest"]["start"])
        data[s] = (bars, ob.vol_index(ob.VOL_INDEX[s]) if s in ob.VOL_INDEX else {})
    res = dict(generatedAt=datetime.now(timezone.utc).isoformat(), symbols=rb.SYMS, widths={})
    for w in (1.0, 0.5):
        tr = run_width(data, w, rb.BASE["model"]["slippagePerSpread"])
        need = round(w * 100, 2)
        res["widths"][str(w)] = dict(
            baseline=rb.stats(tr),
            byYear={y: rb.stats([t for t in tr if t["entered"][:4] == y]) for y in sorted({t["entered"][:4] for t in tr})},
            costStress={f"slippage {sl}": rb.stats(run_width(data, w, sl)) for sl in (0.03, 0.04)},
            monteCarloFrom80=rb.monte_carlo([t["pnl"] for t in tr], 80, need, rb.BASE["risk"]["pauseBelowAccountValueUsd"]) if tr else None)
    json.dump(res, open(OUT, "w"), indent=1)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
