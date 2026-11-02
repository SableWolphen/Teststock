#!/usr/bin/env python3
"""ClaudeBot Paper Lab: paper-trades several strategy variants on the SAME live
Robinhood quotes the live bot uses, so we learn faster without risking money.
Places no orders, ever.

  python claudebot/paper_lab.py run /tmp/ofacts.json /tmp/facts.json
      -> applies every paper decision it can, prints {"needs": [...]} for data it is missing.
         Fetch what is listed, add it to the facts files, run again (up to 3 rounds).

Needs it can ask for:
  {"type": "contracts", "symbol", "expiration", "strikes": [...]}   -> options candidates (puts)
  {"type": "leg_quotes", "ids": [...]}                              -> option quotes for open paper spreads
  {"type": "underlying", "symbol"}                                   -> price/closes/expirations
  {"type": "crypto_quotes", "symbols": [...]}                        -> crypto bid/ask
Ledger: docs/data/claudebot-paper-ledger.json (public: prices, $ per 1 spread, % only).
"""
from __future__ import annotations

import copy
import importlib.util
import json
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LEDGER = os.path.join(ROOT, "docs", "data", "claudebot-paper-ledger.json")
SIGNAL = os.path.join(ROOT, "docs", "data", "claudebot-signal.json")


def _load_mod(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


ob = _load_mod("ob", "options_bot.py")
OPT_CFG = os.path.join(HERE, "options_config.json")

# The strategies. Options variants override the live options config; one crypto variant.
STRATEGIES = [
    {"id": "mirror", "name": "Mirror", "desk": "options", "about": "Exactly the live rules, so paper fills can be compared to real ones.", "override": {}},
    {"id": "nopause", "name": "No event pause", "desk": "options", "about": "Live rules but trades through elections, Fed days, CPI and jobs reports.", "override": {"risk": {"noNewEntryDates": {}}}},
    {"id": "safe", "name": "Conservative", "desk": "options", "about": "Further from the money: short delta 0.15, smaller credits, fewer losses?", "override": {"entry": {"maxShortDelta": 0.15, "minCreditUsd": 0.10}}},
    {"id": "aggr", "name": "Aggressive", "desk": "options", "about": "Closer to the money: short delta 0.30, take profit at 50%.", "override": {"entry": {"maxShortDelta": 0.30}, "exit": {"takeProfitPctOfCredit": 50}}},
    {"id": "tight", "name": "Tight stop", "desk": "options", "about": "Cuts losers sooner: stop at 2.0x credit, take profit at 50%.", "override": {"exit": {"stopAtMultipleOfCredit": 2.0, "takeProfitPctOfCredit": 50}}},
    {"id": "cryraw", "name": "Crypto, no filters", "desk": "crypto", "about": "Takes the crypto trend setup even when Bitcoin is risk-off or the cost check fails. $15 paper positions.", "override": {}},
]


def deep_merge(a, b):
    out = copy.deepcopy(a)
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict) and v:
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def now_utc():
    return datetime.now(timezone.utc)


def iso(d):
    return d.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def fresh_ledger():
    return {"schemaVersion": 1, "mode": "paper",
            "note": "PAPER ONLY: strategy variants tested on live Robinhood quotes. No orders are ever placed from this file.",
            "startedAt": None, "strategies": {}, "runs": []}


def strat_ledger(L, s):
    st = L["strategies"].setdefault(s["id"], {})
    st.setdefault("name", s["name"]); st.setdefault("desk", s["desk"]); st.setdefault("about", s["about"])
    st.setdefault("mode", "paper"); st.setdefault("startingAccountUsd", 113)
    st.setdefault("open", None); st.setdefault("trades", []); st.setdefault("runs", [])
    st["name"], st["about"] = s["name"], s["about"]
    return st


def log(st, action, detail, t):
    st["runs"].append({"t": iso(t), "action": action, "detail": detail}); st["runs"] = st["runs"][-30:]


# ------------------------------------------------------------------ options
def run_options(s, st, facts, base_cfg, t, needs):
    cfg = deep_merge(base_cfg, s["override"])
    for _ in range(4):
        res = ob.plan(facts, cfg, st)
        a = res["actions"][0]
        do = a["do"]
        if do == "need_contracts":
            needs.append({"type": "contracts", "symbol": a["symbol"], "expiration": a["expiration"], "strikes": a["strikes"]}); return
        if do == "need_leg_quotes":
            needs.append({"type": "leg_quotes", "ids": a["ids"]}); return
        if do == "need_underlying":
            needs.append({"type": "underlying", "symbol": a["symbol"]}); return
        if do == "open_spread":
            keep = ("underlying", "expiration", "width", "shortStrike", "longStrike", "shortId", "longId", "credit", "maxLossUsd", "shortDelta", "underlyingPrice", "label")
            st["open"] = {k: a[k] for k in keep}; st["open"]["enteredAt"] = iso(t)
            log(st, "open", f"sold {a['label']} for {a['credit']} (max loss ${a['maxLossUsd']})", t); return
        if do == "close_spread":
            p = st["open"]; fee = cfg["model"]["feesPerRoundTrip"]
            pnl = round((p["credit"] - a["debit"]) * 100 - fee, 2)
            st["trades"].append({"label": p["label"], "underlying": p["underlying"], "enteredAt": p["enteredAt"], "exitedAt": iso(t),
                                 "credit": p["credit"], "debit": a["debit"], "pnlUsd": pnl, "reason": a["reason"]})
            st["open"] = None
            log(st, "close", f"bought back {p['label']} at {a['debit']} ({pnl:+.2f} USD, {a['reason']})", t); continue
        if do in ("place_tp", "cancel_order", "record_broker_close"):
            return  # live-only mechanics; paper takes profit from quotes
        if do == "none":
            last = st["runs"][-1]["detail"] if st["runs"] else None
            if a["reason"] != last and a["reason"] != "market closed":
                log(st, "hold", a["reason"], t)
            return
        return


# ------------------------------------------------------------------ crypto (no filters)
def raw_setups(signal):
    out = []
    for c in signal.get("coins", []):
        bl = c.get("blockers") or []
        rest = [b for b in bl if not (b.startswith("market risk-off") or b.startswith("this rule lost money"))]
        if (c.get("setup") or not rest) and not c.get("exitSignal"):
            out.append(c)
    return sorted(out, key=lambda c: -c.get("score", 0))


def run_crypto(s, st, cfacts, signal, t, needs):
    q = (cfacts or {}).get("quotes", {})
    p = st["open"]
    if p:
        if p["symbol"] not in q:
            needs.append({"type": "crypto_quotes", "symbols": [p["symbol"]]}); return
        bid = float(q[p["symbol"]]["bid"])
        coin = next((c for c in signal.get("coins", []) if c["symbol"] == p["symbol"]), {})
        held = (t - datetime.fromisoformat(p["enteredAt"].replace("Z", "+00:00"))).total_seconds() / 3600
        why, px = None, bid
        if bid <= p["stop"]:
            why, px = "stop", min(bid, p["stop"])
        elif bid >= p["target"]:
            why, px = "target", p["target"]
        elif held >= 48:
            why = "time (48h)"
        elif coin.get("exitSignal") and coin.get("barTime", "") > p["enteredAt"]:
            why = "trend break"
        if why:
            ret = round(100 * (px / p["entry"] - 1), 3)
            st["trades"].append({"label": p["symbol"], "underlying": p["symbol"], "enteredAt": p["enteredAt"], "exitedAt": iso(t),
                                 "entry": p["entry"], "exit": px, "returnPct": ret, "pnlUsd": round(p["usd"] * ret / 100, 2), "reason": why})
            st["open"] = None; log(st, "close", f"sold {p['symbol']} at {px} ({ret:+.2f}%, {why})", t)
        return
    cands = raw_setups(signal)
    if not cands:
        top = (signal.get("coins") or [{}])[0]
        msg = f"no raw setup (closest {top.get('symbol')}: {', '.join(b for b in top.get('blockers', []) if not b.startswith('market risk-off'))[:80] or 'n/a'})"
        if not st["runs"] or st["runs"][-1]["detail"] != msg:
            log(st, "hold", msg, t)
        return
    c = cands[0]
    if c["symbol"] not in q:
        needs.append({"type": "crypto_quotes", "symbols": [c["symbol"]]}); return
    bid, ask = float(q[c["symbol"]]["bid"]), float(q[c["symbol"]]["ask"])
    if (ask - bid) / ((ask + bid) / 2) * 100 > 2.2:
        log(st, "hold", f"{c['symbol']} spread too wide", t); return
    atr = c["atr"]
    st["open"] = {"symbol": c["symbol"], "entry": ask, "stop": round(ask - 2 * atr, 6), "target": round(ask + 3 * atr, 6), "usd": 15, "enteredAt": iso(t)}
    log(st, "open", f"bought {c['symbol']} at {ask} (stop {st['open']['stop']}, target {st['open']['target']})", t)


# ------------------------------------------------------------------ summary
def summarize(st):
    tr = st["trades"]
    w = [x["pnlUsd"] for x in tr if x["pnlUsd"] > 0]; l = [x["pnlUsd"] for x in tr if x["pnlUsd"] <= 0]
    return {"trades": len(tr), "wins": len(w), "winRatePct": round(100 * len(w) / len(tr), 1) if tr else None,
            "pnlUsd": round(sum(w) + sum(l), 2), "avgPnlUsd": round((sum(w) + sum(l)) / len(tr), 2) if tr else None,
            "profitFactor": round(sum(w) / -sum(l), 2) if l and sum(l) < 0 else None, "open": st["open"] is not None}


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    if not argv or argv[0] != "run":
        print(__doc__); return 2
    ofacts = json.load(open(argv[1])) if len(argv) > 1 and os.path.exists(argv[1]) else {}
    cfacts = json.load(open(argv[2])) if len(argv) > 2 and os.path.exists(argv[2]) else {}
    t = datetime.fromisoformat(ofacts["now"].replace("Z", "+00:00")) if ofacts.get("now") else now_utc()
    L = json.load(open(LEDGER)) if os.path.exists(LEDGER) else fresh_ledger()
    L["startedAt"] = L.get("startedAt") or iso(t)
    base = json.load(open(OPT_CFG))
    signal = json.load(open(SIGNAL)) if os.path.exists(SIGNAL) else {}
    needs = []
    for s in STRATEGIES:
        st = strat_ledger(L, s)
        try:
            if s["desk"] == "options":
                if ofacts.get("marketOpen"):
                    run_options(s, st, ofacts, base, t, needs)
            else:
                run_crypto(s, st, cfacts, signal, t, needs)
        except Exception as e:  # never let one paper strategy break the run
            log(st, "error", f"{type(e).__name__}: {e}", t)
        st["summary"] = summarize(st)
    # leaderboard + promotion hints (a human decides; nothing is promoted automatically)
    board = sorted(({"id": k, "name": v["name"], "desk": v["desk"], **v["summary"]} for k, v in L["strategies"].items()),
                   key=lambda r: -(r["pnlUsd"] or 0))
    for r in board:
        r["promotionCandidate"] = bool(r["trades"] >= 20 and (r["profitFactor"] or 0) >= 1.3 and r["id"] != "mirror")
    L["leaderboard"] = board
    L["updatedAt"] = iso(t)
    # de-duplicate needs
    seen, uniq = set(), []
    for n in needs:
        key = json.dumps(n, sort_keys=True)
        if key not in seen:
            seen.add(key); uniq.append(n)
    json.dump(L, open(LEDGER, "w"), indent=1); open(LEDGER, "a").write("\n")
    print(json.dumps({"needs": uniq, "leaderboard": [(r["name"], r["trades"], r["pnlUsd"], r["open"]) for r in board]}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
