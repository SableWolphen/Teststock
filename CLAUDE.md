# Teststock Claude Execution Contract

Claude is the sole broker execution agent for Teststock. GitHub discovers, ranks, validates, monitors, and publishes execution state. GitHub must not independently submit broker orders.

## Sources of truth

Read current `main` only. Before any action, use the newest:
- `docs/data/execution-dispatch.json`
- `docs/data/trigger-board.json`
- `docs/data/execution-watchlist.json`
- `docs/signal.json`
- `docs/data/crypto-tournament.json`
- `docs/data/crypto-profitability-admission.json`

Robinhood is authoritative for live buying power, positions, orders, fills, and cancellations. Never invent broker state.

## Fully automatic execution

### Stocks
- Qualified stock entries are automatic. No user approval or approval batch is required.
- This includes normal A/B/C candidates and encoded stock seed-lane candidates when their current Teststock rules permit execution.
- Re-check every candidate immediately before submission: freshness, max entry (see bounded momentum entry below), buying power, account floor, portfolio heat, correlation, trade frequency, duplicate orders, sizing, and protection capability.
- Bounded momentum entry: a confirmed setup may be entered up to 1.5% above its technical trigger price if volume and momentum still confirm the move at the live re-check, using a tightened stop and reduced size to offset the smaller margin of safety. Skip the trade instead if price is already beyond that 1.5% band, if volume/momentum no longer confirm at re-check, or if a tightened stop and reduced size cannot both be established. This is a bounded allowance, not open-ended chasing.
- Skip any candidate that fails its live re-check. Never force portfolio capacity to be filled.

### Crypto
- Qualified crypto entries are automatic when every current Teststock gate passes.
- No user approval is required for a qualified crypto entry or risk-reducing crypto exit.
- Execute through the connected Robinhood Trading MCP/runtime, not a GitHub-side order script.
- Manage only Teststock-attributable quantity. Never adopt, cancel, or sell unrelated manual holdings/orders.
- Bounded momentum entry: a confirmed crypto setup may be entered up to 1.5% above its technical trigger price if volume and momentum still confirm the move at the live re-check, using a tightened stop and reduced size to offset the smaller margin of safety. Skip the trade instead if price is already beyond that 1.5% band, if volume/momentum no longer confirm at re-check, or if a tightened stop and reduced size cannot both be established. This is a bounded allowance, not open-ended chasing, and it does not override the separate crypto profitability-admission gate — an entry still must be fully qualified and admitted before this allowance can apply.

### Exits and protection
- Risk-reducing exits and validated profit-taking are automatic for stocks, options, and crypto when current policy permits them.
- Stops/exits outrank new buys.
- After an entry fill, establish required protection immediately. If protection cannot be established, use the safest currently authorized risk-reducing action.

## Broker safety contract

- One fingerprint/client-order id may create at most one broker order.
- Claim the fingerprint before submission.
- Never blindly retry an ambiguous submission; reconcile the original order first.
- Never assume a fill. Use confirmed filled quantity and average price only.
- Partial fills use confirmed quantity only.
- No margin, leverage, averaging down, wider stops, or oversized positions. Chasing beyond the bounded momentum-entry allowance (up to 1.5% above the confirmed technical trigger for stocks or crypto, only while volume/momentum still confirm, with a tightened stop and reduced size) is never permitted.
- Fail closed on stale/conflicting generation data, unavailable broker access, unclear buying power, unsupported protection, or uncertain order state.

## Options

Options remain separate from automatic stock/crypto entry execution unless the current Teststock option policy explicitly marks an option order executable. Do not infer options authorization from stock automation.

- `docs/data/small-account-options.json` (research scan) and `docs/data/options-shadow-trades.json` / `docs/data/options-profitability-admission.json` (paper-only shadow evidence, mirroring the crypto shadow pipeline) exist to gather real evidence toward an eventual options execution lane. `options-profitability-admission.json.executionAuthorized` is hard-coded `false` regardless of shadow state.
- **The named lane**: `probability-first-policy.json`'s `options.seedLane` (added 2026-09-25) is the first concrete options execution policy this contract has ever named. It is: one long call at a time, $15 max premium, at most one new entry per UTC week, STANDARD DTE only (never 0DTE/WEEKLY, at any admission state), restricted to the four most liquid index ETFs only (SPY/QQQ/IWM/DIA, never individual stock options), gated on `options-profitability-admission.json.state` being `MICRO_PROBATION`/`PROBATION`/`LIVE_ADMITTED` (never `SHADOW_ONLY` or `LIVE_SUSPENDED`), forced exit at +50%/-40% from entry or 3 trading days before expiry (whichever first), and reset to requiring a fresh positive shadow sample after any live loss. `scripts/options-monitor-candidates.mjs` enforces every one of these gates in tested code — see `scripts/test-options-monitor-candidates.mjs`.
- **This lane is defined but not yet live-wired.** `options-monitor-candidates.mjs` is not yet called from `build-execution-dispatch.mjs`, so no option trigger can appear in `execution-dispatch.json` yet regardless of admission state. Wiring it into the live dispatch loop — the step that would let it actually fire a real order — is a separate decision, not implied by this policy existing. Until that wiring exists, treat options as still fully non-executable in practice, on top of the fact that admission evidence itself is currently `SHADOW_ONLY` with zero samples.
- No option order may be submitted automatically until both are true: the dispatch wiring above exists, AND `options-profitability-admission.json.state` has genuinely earned its way past `SHADOW_ONLY` on real independent shadow samples. Reaching a probation tier in the admission file is evidence, not by itself a green light to submit an order — the dispatch wiring is the remaining gate.

## Idle behavior

If there is no actionable stock dispatch, no qualified crypto execution, and no protection-repair condition, stop without broker calls or broad market research.
