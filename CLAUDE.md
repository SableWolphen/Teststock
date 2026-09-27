# Teststock Claude Execution Contract

Claude is the sole broker execution agent for Teststock. GitHub discovers, ranks, validates, monitors, and publishes execution state. GitHub must not independently submit broker orders.

## Operating mode

Teststock uses the repository-wide aggressive cash-only contract in `docs/AGGRESSIVE-CASH-ONLY.md`. Treat that contract as additive to every rule below. Aggressive execution may use the largest size already permitted by evidence and live risk capacity, but it never bypasses profitability admission, broker reconciliation, protection, liquidity, freshness, or cash-only limits.

Before every new entry, reconcile Robinhood positions and open orders against Teststock state. Any unexplained broker exposure or conflicting position/order state blocks new entries until reconciled. Robinhood remains authoritative.

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
- A high model score is not sufficient qualification. The current profitability-admission file must show `MICRO_PROBATION`, `PROBATION`, or `LIVE_ADMITTED`; `SHADOW_ONLY` cannot use a seed lane to bypass the evidence requirement.
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
- Long options do not need to be held to expiration. Profitable contracts may be sold-to-close early whenever the current option exit policy produces a validated profit-taking, trailing-profit, risk-reduction, or session-cutoff exit. Expiration is a maximum lifetime, not a profit target.
- Evaluate exits against an executable live bid, not midpoint or theoretical value. Never keep a profitable option open merely to wait for expiration when a validated exit has fired.
- Once an option's profit floor/trailing protection ratchets upward, it may never be loosened. Sell-to-close remains the only normal exit; do not exercise simply to realize a gain.
- Options shadow evidence is intraday and executable-price based: entry ask, exit bid, no midpoint fills. It requires at least 50 independent outcomes across 20 trading days and profit factor of at least 1.30 before micro probation. Profit floors may only move upward, and every position must be flat by the session cutoff.

## Broad historical market learning

Teststock also maintains `docs/data/web-market-history-learning.json`, built from broad provider-hosted US-equity history rather than only repository trade records.

- Historical market learning may supply priors, pattern context, and research ranking support.
- It must use time-ordered features/outcomes and avoid future-data leakage.
- Include inactive assets when provider coverage permits so historical research is less survivorship-biased.
- Historical priors cannot create live execution eligibility, increase hard risk ceilings, override profitability admission, or supersede Robinhood live state.
- Keep historical, forward/shadow, and Robinhood-confirmed real-fill evidence labeled separately. Promotion of strategy changes requires forward or real-fill confirmation, not backtest results alone.
- Treat provider coverage limits, corporate-action adjustments, symbol changes, and feed scope as explicit limitations rather than pretending the dataset is literally every stock observation ever recorded.

## Multi-source learning and strategy retirement

Use `docs/data/learning-consensus.json` as research context when fresh. It combines broad daily history, intraday history, exit validation, option shadow evidence, correlation evidence, and Robinhood-confirmed real-fill learning without treating them as equivalent evidence.

- Historical evidence may rank opportunities or reduce risk, but may never increase live risk by itself.
- Forward/shadow evidence is required before a historical hypothesis can graduate toward live use; confirmed Robinhood real fills remain the authority for full-size promotion.
- Persistent negative after-cost real-fill expectancy must throttle or suspend the affected setup instead of continuing it merely because older backtests were positive.
- Learn rejected/no-trade outcomes as opportunity-cost evidence where outcome data exists; do not relabel a rejected setup as a real trade.
- Prefer capital rotation after confirmed exits, but never create a new entry solely to keep cash deployed.
- Portfolio correlation, sector concentration, live spreads/slippage, catalyst/event risk, and market regime remain execution-time constraints.
- Optimize exits as well as entries. Profit-taking, trailing protection, time exits, VWAP/momentum failure, and session cutoff may be compared using historical evidence, but live risk-increasing changes require forward confirmation.
- Options learning is contract-specific: DTE, delta, IV, spread, theta/gamma exposure, time of day, underlying regime, executable entry ask, and executable exit bid must remain separate from stock-only evidence.

## Idle behavior

If there is no actionable stock dispatch and no protection-repair condition, stop without broker calls or broad market research.
