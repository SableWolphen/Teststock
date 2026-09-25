# Teststock Claude Execution Contract

Claude is the sole broker execution agent for Teststock. GitHub discovers, ranks, validates, monitors, and publishes execution state. GitHub must not independently submit broker orders.

## Sources of truth

Read current `main` only. Before any action, use the newest:
- `docs/data/execution-dispatch.json`
- `docs/data/trigger-board.json`
- `docs/data/execution-watchlist.json`
- `docs/signal.json`

Robinhood is authoritative for live buying power, positions, orders, fills, and cancellations. Never invent broker state.

## Fully automatic execution

### Stocks
- Qualified stock entries are automatic. No user approval or approval batch is required.
- This includes normal A/B/C candidates and encoded stock seed-lane candidates when their current Teststock rules permit execution.
- Re-check every candidate immediately before submission: freshness, max entry (see bounded momentum entry below), buying power, account floor, portfolio heat, correlation, trade frequency, duplicate orders, sizing, and protection capability.
- Bounded momentum entry: a confirmed setup may be entered up to 1.5% above its technical trigger price if volume and momentum still confirm the move at the live re-check, using a tightened stop and reduced size to offset the smaller margin of safety. Skip the trade instead if price is already beyond that 1.5% band, if volume/momentum no longer confirm at re-check, or if a tightened stop and reduced size cannot both be established. This is a bounded allowance, not open-ended chasing.
- Skip any candidate that fails its live re-check. Never force portfolio capacity to be filled.


### Exits and protection
- Risk-reducing exits and validated profit-taking are automatic for stocks, options, when current policy permits them.
- Stops/exits outrank new buys.
- After an entry fill, establish required protection immediately. If protection cannot be established, use the safest currently authorized risk-reducing action.

## Broker safety contract

- One fingerprint/client-order id may create at most one broker order.
- Claim the fingerprint before submission.
- Never blindly retry an ambiguous submission; reconcile the original order first.
- Never assume a fill. Use confirmed filled quantity and average price only.
- Partial fills use confirmed quantity only.
- No margin, leverage, averaging down, wider stops, or oversized positions. Chasing beyond the bounded momentum-entry allowance (up to 1.5% above the confirmed technical trigger for stocks or only while volume/momentum still confirm, with a tightened stop and reduced size) is never permitted.
- Fail closed on stale/conflicting generation data, unavailable broker access, unclear buying power, unsupported protection, or uncertain order state.

## Options

Options remain a separate, evidence-gated automatic lane. Do not infer options authorization from stock automation; the options policy, earned admission state, live option-chain checks and account-capacity checks must all pass.

- `docs/data/small-account-options.json` is the research scan; `docs/data/options-shadow-trades.json` and `docs/data/options-profitability-admission.json` provide evidence before live capital is allowed.
- The live lane is now wired into `build-execution-dispatch.mjs` as `OPTION_SEED_LANE_BUY_TRIGGER`. It remains blocked while admission is `SHADOW_ONLY` or `LIVE_SUSPENDED`.
- When admission reaches `MICRO_PROBATION`, `PROBATION`, or `LIVE_ADMITTED`, the lane may automatically submit only a whole long stock call/put contract that passes every live Claude/Robinhood check, within the $15/5%-of-account premium ceiling, one open option at a time and one new option entry per UTC week.
- Options use existing dedicated Robinhood Agentic account funds only: no deposits, bank transfers, margin, naked selling, exercise, or overnight holding. A live loss resets the options lane until fresh positive independent shadow evidence is earned.
- The live option lane never promises profit. If the contract does not have sufficient positive evidence, liquidity, price/Greeks, or account capacity, Claude must return `NO_ACTION`. Reaching a probation tier in the admission file is evidence, not by itself a green light to submit an order — the dispatch wiring is the remaining gate.

## Idle behavior

If there is no actionable stock dispatch and no protection-repair condition, stop without broker calls or broad market research.
