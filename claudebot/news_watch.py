#!/usr/bin/env python3
"""Nova, the news watcher (board, 2026-11-06: "always watch the news to see what you can buy or
sell... have GitHub watch it"). Runs every 5 minutes inside the market loop, free. Never trades.

Reads Alpaca's news feed (Benzinga headlines) for the funds we trade plus the big names inside them,
and scores each headline with a plain keyword model (negative: crash, plunge, halt, downgrade,
investigation, recession...; positive: beats, raises, upgrade, record...).
Uses:
  * VETO: a fund gets a news flag only for SEVERE, specific danger in its own headlines (halt, fraud,
    bankruptcy, delisting, default). Ordinary bad news is only shown as "watch": the Dip rule is built
    to buy after bad news, so tone alone never blocks it (same rule as EXECUTOR.md's news check). The live desks treat a flag as "no NEW buy in that
    fund today" (exits always run). News never creates a buy on its own: headline-chasing loses money
    in every study we know of, so it can only block risk.
  * MARKET MOOD: the overall tone of the last 6 hours, shown in the office and logged with the next
    day's SPY move so the Historian can test later whether mood actually predicts anything.
Writes docs/data/claudebot-news.json.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "docs", "data", "claudebot-news.json")
FUNDS = ["SPY", "QQQ", "IWM", "DIA", "XLK", "SMH", "KRE", "XLF", "XLI", "XLY"]
HOLDINGS = {"XLK": ["AAPL", "MSFT", "NVDA", "AVGO"], "SMH": ["NVDA", "TSM", "AVGO", "AMD", "MU"], "QQQ": ["AAPL", "MSFT", "NVDA", "AMZN", "META"],
            "KRE": ["ZION", "CFG", "KEY", "RF"], "XLF": ["JPM", "BRK.B", "V", "BAC"], "SPY": [], "DIA": ["UNH", "GS", "MSFT"], "IWM": []}
NEG = {"crash": 3, "plunge": 3, "plunges": 3, "tumble": 2, "tumbles": 2, "selloff": 2, "sell-off": 2, "slump": 2, "sinks": 2, "falls": 1, "drop": 1,
       "drops": 1, "downgrade": 2, "downgrades": 2, "cut": 1, "cuts": 1, "misses": 2, "miss": 1, "warning": 2, "warns": 2, "probe": 2,
       "investigation": 2, "lawsuit": 1, "recession": 3, "layoffs": 2, "default": 3, "halt": 3, "halted": 3, "fraud": 4, "bankruptcy": 4,
       "delisting": 4, "correction": 2, "fear": 1, "fears": 1, "worst": 2, "war": 2, "tariff": 1, "tariffs": 1, "hike": 1}
POS = {"beats": 2, "beat": 1, "raises": 2, "upgrade": 2, "upgrades": 2, "record": 2, "rally": 2, "rallies": 2, "surge": 2, "surges": 2,
       "jumps": 2, "rebound": 2, "rebounds": 2, "gains": 1, "rises": 1, "strong": 1, "approval": 1, "deal": 1, "buyback": 1}
SEVERE = {"halt", "halted", "fraud", "bankruptcy", "delisting", "default"}
H = None


def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30).read())


def score(text):
    words = re.findall(r"[a-z][a-z\-]+", text.lower())
    return sum(POS.get(w, 0) for w in words) - sum(NEG.get(w, 0) for w in words), {w for w in words if w in SEVERE}


def main():
    global H
    H = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"], "APCA-API-SECRET-KEY": os.environ["ALPACA_API_SECRET"], "User-Agent": "teststock"}
    now = datetime.now(timezone.utc); start = (now - timedelta(hours=6)).isoformat().replace("+00:00", "Z")
    syms = sorted(set(FUNDS) | {s for v in HOLDINGS.values() for s in v})
    items = []
    for chunk in (syms[:20], syms[20:], None):
        if chunk == []:
            continue
        q = f"&symbols={','.join(chunk)}" if chunk else ""
        try:
            items += get(f"https://data.alpaca.markets/v1beta1/news?start={start}&limit=50&sort=desc&include_content=false{q}").get("news") or []
        except Exception as e:  # noqa: BLE001
            print("news fetch failed", e)
    seen, heads = set(), []
    for n in items:
        if n.get("id") in seen:
            continue
        seen.add(n.get("id"))
        sc, sev = score(f"{n.get('headline', '')} {n.get('summary', '')}")
        heads.append({"t": n.get("created_at"), "headline": n.get("headline", "")[:200], "symbols": n.get("symbols", [])[:8], "score": sc,
                      "severe": sorted(sev), "source": n.get("source"), "url": n.get("url")})
    heads.sort(key=lambda h: h["t"] or "", reverse=True)
    flags, watch = {}, {}
    for f in FUNDS:
        names = {f, *HOLDINGS.get(f, [])}
        mine = [h for h in heads if names & set(h["symbols"])]
        tot = sum(h["score"] for h in mine); sev = sorted({w for h in mine if f in h["symbols"] for w in h["severe"]})
        if sev:
            flags[f] = f"severe headline about {f}: {', '.join(sev)}"
        elif len(mine) >= 4 and tot <= -8:
            # ordinary bad news is NOT a veto: the Dip rule is built to buy after bad news
            watch[f] = f"negative tone on {f} or its biggest holdings ({len(mine)} headlines, score {tot}): information only"
    mood_score = sum(h["score"] for h in heads[:60])
    mood = "very negative" if mood_score <= -25 else "negative" if mood_score <= -8 else "positive" if mood_score >= 8 else "mixed"
    prev = {}
    try:
        prev = json.load(open(OUT))
    except Exception:  # noqa: BLE001
        pass
    log = prev.get("moodLog", [])
    day = now.date().isoformat()
    if not log or log[-1]["day"] != day:
        log.append({"day": day, "mood": mood, "score": mood_score})
    else:
        log[-1].update({"mood": mood, "score": mood_score})
    out = {"generatedAt": now.isoformat().replace("+00:00", "Z"), "marketMood": mood, "moodScore": mood_score, "headlinesLast6h": len(heads),
           "flags": flags, "watch": watch, "headlines": heads[:25], "moodLog": log[-120:],
           "rule": "News can only BLOCK a new buy (flags). It never creates a buy or sell by itself. Exits always run."}
    json.dump(out, open(OUT, "w"), indent=1)
    print(json.dumps({"mood": mood, "score": mood_score, "headlines": len(heads), "flags": flags}))


if __name__ == "__main__":
    main()
