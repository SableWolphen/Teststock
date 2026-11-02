#!/usr/bin/env python3
"""Variant research for ClaudeBot. Picks on the older 60% of history, then checks
on the newer 40% the variant never saw. Writes docs/data/claudebot-research.json."""
import copy, importlib.util, json, os, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("sig", os.path.join(HERE, "signal.py"))
sig = importlib.util.module_from_spec(spec); spec.loader.exec_module(sig)
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-research.json")


def agg(rows, n):
    out = []
    for k in range(len(rows) % n, len(rows), n):
        g = rows[k:k + n]
        if len(g) < n:
            break
        out.append(dict(t=g[0]["t"], o=g[0]["o"], h=max(r["h"] for r in g), l=min(r["l"] for r in g), c=g[-1]["c"], v=sum(r["v"] for r in g)))
    return out


def main():
    cfg = sig.load_config()
    hours = int(sys.argv[1]) if len(sys.argv) > 1 else 4200
    raw = {}
    for s in cfg["universe"]:
        try:
            raw[s] = sig.candles(s, hours)[0]
        except Exception as e:  # noqa: BLE001
            print("skip", s, e)
    results = []
    for tf in (1, 4):
        data = {s: agg(r, tf) if tf > 1 else r for s, r in raw.items()}
        inds = {s: sig.indicators(r) for s, r in data.items()}
        b_rows, b = data["BTC"], inds["BTC"]
        bt_idx = {r["t"]: i for i, r in enumerate(b_rows)}
        for regime in (True, False):
            for stop in (1.5, 2.0, 3.0):
                for tgt in (2.0, 3.0, 5.0):
                    for rmax in (70, 80):
                        c = copy.deepcopy(cfg)
                        c["strategy"].update(stopAtr=stop, targetAtr=tgt, rsiMax=rmax, maxHoldHours=48 // tf)
                        split = {"train": [], "test": []}
                        for s, rows in data.items():
                            ind = inds[s]
                            roff = [(b["c"][bt_idx[r["t"]]] < b["e200"][bt_idx[r["t"]]] and b["e50"][bt_idx[r["t"]]] < b["e200"][bt_idx[r["t"]]]) if (regime and r["t"] in bt_idx) else False for r in rows]
                            cut = int(len(rows) * 0.6)
                            split["train"] += sig.backtest(rows[:cut], sig.indicators(rows[:cut]), c, roff[:cut])
                            split["test"] += sig.backtest(rows[cut - 210:], sig.indicators(rows[cut - 210:]), c, roff[cut - 210:])
                        results.append(dict(timeframeHours=tf, btcRegimeFilter=regime, stopAtr=stop, targetAtr=tgt, rsiMax=rmax,
                                            train=sig.summarize(split["train"]), test=sig.summarize(split["test"])))
    ok = [r for r in results if r["train"]["trades"] >= 20]
    ok.sort(key=lambda r: (r["train"]["profitFactor"] or 0), reverse=True)
    out = dict(generatedAt=datetime.now(timezone.utc).isoformat(), hoursOfHistory=hours,
               coins=list(raw), costRoundTripPct=cfg["costs"]["roundTripPct"],
               top=ok[:12], all=results)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    for r in ok[:12]:
        print(r["timeframeHours"], r["btcRegimeFilter"], r["stopAtr"], r["targetAtr"], r["rsiMax"], "train", r["train"], "test", r["test"])


if __name__ == "__main__":
    main()
