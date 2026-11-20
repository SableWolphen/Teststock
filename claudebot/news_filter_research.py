#!/usr/bin/env python3
"""Does the news improve the Dip rule? (board 2026-11-20, after the TradingAgents video:
"Sure this needs to improve everything").

TradingAgents-style systems read news and sentiment before trading. Nova (news_watch.py) already
blocks buys on SEVERE headlines (halt, fraud, bankruptcy). This test asks whether ORDINARY news tone
helps: for every past Dip signal, it scores the Benzinga headlines (Alpaca news archive) about the fund
and its biggest holdings in the 2 days before the buy, plus the whole-market mood, with Nova's own
keyword model, and compares how the trade turned out.

Variants (each judged on 2019-22 = pick, and 2023-now = unseen test):
  all            take every signal (today's rule)
  skipBadFund    skip when the fund's own headlines are clearly negative (score <= -2)
  onlyBadFund    take ONLY those (contrarian: the dip has a reason and over-reacts)
  skipBadMarket  skip when the market-wide mood is clearly negative
  skipSevere     skip on severe words (what Nova already does live)
A filter is only worth adding if it beats "all" in BOTH periods after costs (0.05% per side) on a
meaningful number of trades. Places no orders. Writes docs/data/claudebot-news-filter.json.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-news-filter.json")


def mod(name, file):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, file)); m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m); return m


nw, ob = mod("nw", "news_watch.py"), mod("ob", "options_backtest.py")
CFG = json.load(open(os.path.join(HERE, "dip_config.json")))
SYMS = CFG["symbols"] + ["XLF", "XLI", "XLY"]
COST = 0.0005          # per side
START, SPLIT = "2018-01-01", "2023-01-01"


def rsi2(c, i):
    g = l = 0.0
    for j in range(i - 1, i + 1):
        d = c[j] - c[j - 1]
        g += max(d, 0); l += max(-d, 0)
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def signals(bars):
    d = [x[0] for x in bars]; c = [x[1] for x in bars]; e, x = CFG["entry"], CFG["exit"]
    out, i = [], 201
    while i < len(c) - 1:
        if d[i] >= "2019-01-01" and c[i] > sum(c[i - 200:i]) / 200 and rsi2(c, i) < e["rsi2Below"]:
            ent, j = c[i], i + 1
            while j < len(c):
                sma = sum(c[j - x["smaBounce"] + 1:j + 1]) / x["smaBounce"]
                if c[j] <= ent * (1 - x["stopPct"] / 100) or c[j] > sma or rsi2(c, j) > x["rsi2Above"] or j - i >= x["maxHoldDays"]:
                    break
                j += 1
            j = min(j, len(c) - 1)
            out.append({"day": d[i], "exitDay": d[j], "ret": c[j] / ent - 1 - 2 * COST})
            i = j + 1
        else:
            i += 1
    return out


def news(symbols, day):
    end = datetime.fromisoformat(day + "T21:00:00+00:00"); start = end - timedelta(days=2)
    q = ",".join(symbols)
    url = (f"https://data.alpaca.markets/v1beta1/news?symbols={q}&start={start.strftime('%Y-%m-%dT%H:%M:%SZ')}"
           f"&end={end.strftime('%Y-%m-%dT%H:%M:%SZ')}&limit=50&include_content=false")
    for k in range(3):
        try:
            return nw.get(url).get("news") or []
        except Exception as ex:  # noqa: BLE001
            time.sleep(2 + 3 * k); err = ex
    print("news failed", q, day, err, file=sys.stderr); return None


def tone(items):
    tot, sev = 0, set()
    for n in items or []:
        s, v = nw.score((n.get("headline") or "") + " " + (n.get("summary") or ""))
        tot += s; sev |= v
    return tot, sorted(sev)


def stats(rs):
    if not rs:
        return {"trades": 0}
    w = [r for r in rs if r > 0]; l = [r for r in rs if r <= 0]
    return {"trades": len(rs), "winPct": round(100 * len(w) / len(rs), 1), "avgPct": round(100 * sum(rs) / len(rs), 3),
            "totalPct": round(100 * sum(rs), 2), "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None}


def main():
    nw.H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    rows, missing = [], 0
    mood_cache = {}
    for s in SYMS:
        bars, src = ob.daily_bars(s, START)
        for t in signals(bars):
            fund = news([s] + nw.HOLDINGS.get(s, [])[:4], t["day"])
            if t["day"] not in mood_cache:
                mood_cache[t["day"]] = news(["SPY", "QQQ", "DIA"], t["day"])
            mkt = mood_cache[t["day"]]
            if fund is None or mkt is None:
                missing += 1; continue
            ft, fsev = tone(fund); mt, _ = tone(mkt)
            rows.append({**t, "symbol": s, "fundTone": ft, "fundHeadlines": len(fund), "severe": fsev, "marketTone": mt, "marketHeadlines": len(mkt)})
        print(s, src, len([r for r in rows if r["symbol"] == s]), "signals", file=sys.stderr)
    variants = {
        "all": lambda r: True,
        "skipBadFund": lambda r: r["fundTone"] > -2,
        "onlyBadFund": lambda r: r["fundTone"] <= -2,
        "skipBadMarket": lambda r: r["marketTone"] > -2,
        "skipSevere": lambda r: not r["severe"],
    }
    res = {"generatedAt": datetime.now(timezone.utc).isoformat(), "symbols": SYMS, "costPerSidePct": 100 * COST,
           "pickPeriod": f"2019-01-01 to {SPLIT}", "testPeriod": f"{SPLIT} to now", "signalsScored": len(rows), "signalsWithoutNews": missing,
           "variants": {}}
    for name, f in variants.items():
        tr = [r["ret"] for r in rows if r["day"] < SPLIT and f(r)]; te = [r["ret"] for r in rows if r["day"] >= SPLIT and f(r)]
        res["variants"][name] = {"pick": stats(tr), "test": stats(te)}
    base = res["variants"]["all"]
    def beats(v):
        return all((v[p].get("trades", 0) >= 15 and (v[p].get("avgPct") or -9) > (base[p].get("avgPct") or 9)) for p in ("pick", "test"))
    winners = [k for k, v in res["variants"].items() if k != "all" and beats(v)]
    res["verdict"] = ("A news filter beat taking every signal in BOTH periods: " + ", ".join(winners) + ". Candidate for paper testing.") if winners else \
                     "No news filter beat simply taking every Dip signal in both periods. Keep Nova's severe-news veto as a safety rule only."
    res["trades"] = rows
    json.dump(res, open(OUT, "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "trades"}, indent=1))


if __name__ == "__main__":
    main()
