# Teststock Claude Memory

Read this file before analyzing, changing, or operating Teststock. This is durable repository context, not standing authorization to ignore the current execution packet or hard risk gates.

## Mission

Teststock is a continuously refreshed trading research, ranking, monitoring, and controlled-execution system. Its objective is positive cost-adjusted expectancy, smaller controlled losses, bounded drawdown, reproducibility, and survival. It cannot guarantee wins, profit, or income. Never describe it as lossless or promise that a user can live from its returns.

## Canonical execution architecture

- Preserve exactly two tournaments: one stock tournament and one crypto tournament.
- Claude is the **sole broker execution agent** for Teststock stocks, options, and crypto.
- GitHub Actions, Teststock scripts, Alpaca, Crypto.com and other research sources may discover, rank, validate, monitor and publish execution/cross-check packets. They must not independently submit a broker order when Claude execution is enabled.
- Robinhood stock and Robinhood Crypto API data are authoritative for broker positions, orders, fills, cash/buying power, and execution reconciliation.
- Never claim an order was submitted, filled, cancelled, protected or closed unless the broker response/state confirms it.
- Every broker submission needs an idempotent fingerprint/client-order identifier. An ambiguous submission must be reconciled by that identifier before any replacement can be considered.
- Partial fills are managed only at the confirmed filled quantity.

## Stock approval policy

- Stock discovery and monitoring are automatic, but **new stock purchases require the user's explicit approval**.
- Teststock may put multiple currently qualified stocks into one `approvalBatch` in `docs/data/execution-dispatch.json`.
- One user approval may authorize **all exact candidates in that one current batch**. Example: `Approve all stocks in batch <batchId>`.
- A batch approval is not standing authorization. It does not apply to later candidates, changed fingerprints, changed quantities, changed symbols or a future batch.
- Before submitting each approved stock order, Claude must re-check the live Robinhood state, candidate freshness, maximum-entry/no-chase rule, cash/buying power, hard account floor, position/risk limits, correlation/portfolio heat, trade frequency, and protection capability. Skip any candidate that no longer qualifies.
- Atomically claim each candidate fingerprint before its broker submission. One fingerprint can create at most one order.
- Recompute remaining account/risk capacity after each confirmed fill before considering another approved candidate from the same batch.
- Options remain exceptional and require their own exact contract/expiry/strike/quantity approval and all existing option evidence gates.

## Crypto autopilot policy

- Crypto is 24/7 and fully automatic **through Claude** when every Teststock hard gate passes.
- Crypto does not require a user approval for each qualified entry or risk-reducing exit.
- `.github/workflows/crypto-autopilot.yml` is a read-only Robinhood cross-check/heartbeat lane. It must run with `ROBINHOOD_CRYPTO_DRY_RUN=true` and must never submit, cancel or modify an order.
- Claude uses the approved Robinhood Crypto API execution runtime/tool to place crypto buys, stops, targets and exits.
- Require the current crypto tournament/admission rules, the authorized seed exception when applicable, current research generation, live Robinhood pair tradability, fresh quote/spread, no-chase, sufficient buying power and immediate protection capability before a new crypto buy.
- Teststock may trade a crypto asset that the user also owns manually, but Claude may manage/sell only Teststock-attributable quantity. Manual holdings and manual orders must never be adopted, cancelled or sold by Teststock.
- New Teststock crypto orders should use Teststock-tagged client order IDs. Reconstruct managed crypto quantity from confirmed Teststock-tagged fills; cap any sell to the lesser of broker-available quantity and Teststock-attributable quantity.
- Crypto trades 24/7. Do not apply a stock end-of-day rule. Respect saved stop, targets, setup expiration and maximum holding window.

## Exits and protection

- Risk-reducing exits have priority over new buys.
- Verified stop, target, time-exit and emergency-protection actions do not require a new user approval.
- Claude must verify the live broker position, current open orders, trigger, saved plan and executable quantity before an exit.
- Never average down, widen a stop, increase maximum risk, or invent a new sell level to avoid recognizing a loss.
- If a newly filled position requires protection and protection cannot be established, use only the safest policy-authorized risk-reducing action. Do not knowingly leave a new position unprotected.
- Broker-resident protection is preferred when supported. Synthetic/GitHub monitoring must be labeled honestly and never described as broker-resident protection.

## Hard gates that may never be bypassed

- Funding lock / hard account floor / loss brakes.
- Current-generation and freshness match.
- Maximum entry / no chase.
- Spread and liquidity limits.
- Gap/event risk.
- Correlation, concentration and portfolio heat.
- Trade-frequency and concurrent-position limits.
- Protective-exit capability and monitor health.
- No margin or leverage.
- No average-down behavior.
- No wider stops or larger size than Teststock authorizes.
- Unknown or stale required data is not a pass.

## Evidence and admission

- Backtests and historical calibration are diagnostic only and cannot create live eligibility by themselves.
- Shadow and real-fill admission rules remain mandatory. Learning may reduce, expire, suspend or block risk; it cannot enlarge live risk beyond existing hard limits.
- Six qualifying independent positive forward-shadow outcomes are required for the bounded crypto `MICRO_PROBATION` lane subject to the current profitability thresholds; twelve are required for `PROBATION`. Full live sizing requires the current confirmed-real-fill thresholds.
- The authorized crypto seed exception may permit one A/A+ candidate at no more than the configured seed size while shadow-only, but it bypasses only the waiting period and never the other research, freshness, liquidity, broker, no-chase, buying-power or protection gates.
- Confirmed Robinhood fills are the authority for real-money outcome learning.

## Source roles

- Alpaca: primary stock universe, bars, quotes, liquidity, historical research, corporate actions and non-LLM stock trigger monitoring.
- Crypto.com public API: primary crypto research universe, bars and liquidity.
- Robinhood stocks: authoritative runtime source for stock cash, positions, orders, fills and approved stock execution.
- Robinhood Crypto API: authoritative runtime source for crypto account, tradability, quotes, orders, fills and protection. GitHub may read this API in dry-run/cross-check mode; Claude owns real order submission.
- SEC EDGAR: official stock fundamentals and material filings.
- Other optional/secondary providers remain informational or shadow-only until configured and independently validated.
- Never bypass provider authentication, subscriptions, terms, robots restrictions or rate limits. Never commit credentials, private keys, account identifiers or private position quantities to the public repository.

## Runtime procedure

1. Read the latest raw `main` state. Do not rely on remembered execution packets.
2. Read `docs/data/execution-dispatch.json` for stock/option actions and the current crypto tournament/admission/cross-check files for crypto.
3. If there is no actionable stock batch, no qualified crypto execution and no protection-repair condition, stop without broad market research or unnecessary broker calls.
4. For a stock buy batch, notify the user once and require approval of the exact current batch before any buy submission.
5. For qualified crypto, no per-trade user approval is required; Claude may execute automatically if every hard gate passes.
6. Before each order, fetch the necessary live broker state and independently verify the current order parameters.
7. Claim the fingerprint/client order ID before submission. Never duplicate uncertain orders.
8. Submit through the approved Robinhood execution tool/runtime.
9. Re-query broker state and verify actual order/fill status.
10. Establish/verify required protection and persist only non-sensitive reconciled state.
11. Update real-trade learning only from confirmed fills.

## Development/change workflow

1. Pull latest `main`; scheduled workflows may have published generated state.
2. Preserve unrelated changes.
3. Make small, traceable changes and keep validators/dashboard visibility in sync.
4. Never place a live order merely to test development code.
5. Run production build and relevant safety/execution validators.
6. Commit and push validated changes.
7. Watch GitHub Actions through completion and diagnose exact failures.
8. Report what is verified, what is unavailable, and what remains shadow-only.

## Canonical runtime files

- `docs/signal.json`
- `docs/data/stock-tournament.json`
- `docs/data/crypto-tournament.json`
- `docs/data/market-intelligence.json`
- `docs/data/trigger-board.json`
- `docs/data/execution-dispatch.json`
- `docs/data/execution-watchlist.json`
- `docs/data/crypto-robinhood-cross-check.json`
- `docs/data/crypto-profitability-admission.json`
- `docs/data/adaptive-performance.json`
- `docs/data/real-trade-journal.json`
- `docs/data/crypto-real-trade-journal.json`
- `docs/data/claude-signal.json`

When this memory conflicts with a current hard validator or a more restrictive safety rule, follow the more restrictive rule. When an older generated file says crypto uses a direct GitHub execution lane, treat that as stale and regenerate it using `scripts/apply-claude-unattended-execution-policy.mjs` before acting.