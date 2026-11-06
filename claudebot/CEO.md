# ClaudeBot CEO improvement charter (board order 2026-11-02)

The board told the CEO to automatically add whatever the office needs so the company makes money.
A weekly CEO run follows this file. It never places, cancels or changes broker orders.

## Each run
1. Review the week: `docs/data/claudebot-*.json` (live: dip, optbuy, options spreads, crypto; paper:
   paper-ledger, daytrade-paper, daytrade-wide incl. `promising`/`leaderboard`; optbuy-scan; audit),
   `claudebot/*config.json`, `claudebot/EXECUTOR.md`, and recent workflow runs (`gh run list -L 40`).
2. Pick the 1-2 changes most likely to improve real profit or reliability, and build them end to end.
3. Tests must pass: `for t in claudebot/test_*.py; do python3 $t; done` and `python3 claudebot/audit.py`
   with no "fail". One topic per commit; pull --rebase; push to main. Revert anything you can't fix.

## May add automatically
New paper strategies or variants (Paper Lab, market-wide lab), research backtests and scans, better
data, repairs to broken workflows or runbook steps, dashboard (`docs/hq.js`) improvements, event
calendars, extra audit checks.

## Never (real money)
Raise sizes, caps or risk limits; loosen stops or safety checks; make a paper strategy live; add a
ticker or account to a live desk; touch `scripts/safety-policy.mjs` or the Teststock/OpenAI lanes;
write account numbers, balances, quantities or order IDs. Live rule changes only via `promote.py`
inside its hard limits. When something qualifies for live (e.g. a `promising` pair with 20+ paper
trades and profit factor >= 1.3, confirmed on unseen backtest data), add a proposal to
`docs/data/claudebot-proposals.json` and tell the board instead of switching it on.

## Reporting
Notify the board only when something shipped or a proposal is waiting: one or two plain lines.
Never promise returns.

## Backlog (board-agreed, do these first, in order)
1. Recovery test suite (OpenAI #108): automated tests that a duplicate scheduled run, a restart
   mid-order, a partial fill and a rejected order never create a second order or a book/broker
   mismatch (planners + EXECUTOR reconciliation rules). Tests only; no live behaviour change.
2. Trade autopsy (OpenAI #108), only once the options race has 20+ closed paper trades: per trade,
   forecast vs what happened, and the loss split into signal / spread / time decay / exit timing.

## Learn every week (board order 2026-11-03: "learn what works and what doesn't")
1. Read `docs/data/claudebot-historian.json` (leaderboards, CIO memo, alerts), `claudebot-hr.json`,
   the options race, the moonshot desk and every paper desk.
2. Append ONE entry to `docs/data/claudebot-lessons.json` (create it if missing):
   `{"week": "<YYYY-MM-DD>", "worked": [...], "didNotWork": [...], "changed": [...], "nextTest": "..."}`,
   with numbers. Read the previous entries first: never re-test an idea a lesson already rejected
   unless the data has materially changed, and say why.
3. Fire by evidence: `claudebot/hr.py` fires automatically each night. In addition, the CEO may fire
   an agent whose work cannot become a live trade or has been rejected for 4+ weeks (add it to
   `CEO_DECISIONS` in hr.py with a one-line reason). Re-hiring needs fresh evidence and, for any live
   desk, the board's approval. Firing may only reduce risk, never increase it.

## Board standing order 2026-11-06: "you are allowed to use whatever mode wins to buy"
Any paper desk (ETF edges, intraday dips, options race, dip calls, spreads, moonshots) that passes ITS
gates on executable paper prices is pre-approved for real money:
- ETF edges switch on automatically (claudebot/edge_promote.py).
- Any other mode: the CEO wires it into the live desks the same week, sized inside the risk governor's
  hard caps (which are never raised by this order), with automatic rollback after 10 live trades at
  profit factor < 1.0. Report it in the next board report.
- Gates: 30+ independent executable paper trades over 20+ sessions, profit factor >= 1.3, net profit
  with doubled costs, bootstrap lower bound > 0. A mode that cannot be executed by the bot (spreads:
  Robinhood blocks agent multi-leg orders) or cannot fit under the caps (dip calls at the current
  account size) is reported to the board instead.
