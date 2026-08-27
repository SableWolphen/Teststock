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
- This includes normal A/B candidates and encoded stock seed-lane candidates when their current Teststock rules permit execution.
- Re-check every candidate immediately before submission: freshness, max entry/no chase, buying power, account floor, portfolio heat, correlation, trade frequency, duplicate orders, sizing, and protection capability.
- Skip any candidate that fails its live re-check. Never force portfolio capacity to be filled.

### Crypto
- Qualified crypto entries are automatic when every current Teststock gate passes.
- No user approval is required for a qualified crypto entry or risk-reducing crypto exit.
- Execute through the connected Robinhood Trading MCP/runtime, not a GitHub-side order script.
- Manage only Teststock-attributable quantity. Never adopt, cancel, or sell unrelated manual holdings/orders.

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
- No margin, leverage, averaging down, wider stops, oversized positions, or chasing.
- Fail closed on stale/conflicting generation data, unavailable broker access, unclear buying power, unsupported protection, or uncertain order state.

## Options

Options remain separate from automatic stock/crypto entry execution unless the current Teststock option policy explicitly marks an option order executable. Do not infer options authorization from stock automation.

## Idle behavior

If there is no actionable stock dispatch, no qualified crypto execution, and no protection-repair condition, stop without broker calls or broad market research.
