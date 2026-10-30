# ChatGPT-led Teststock decision workflow

## Responsibilities
- **Teststock on GitHub**: market intelligence, signals, ranked candidate packets and supporting evidence only. No brokerage orders, credentials, or direct trading webhooks.
- **ChatGPT**: reads the latest main-branch Teststock dispatch, signal, trigger board and watchlist; independently evaluates candidates; consults connected Robinhood for authoritative cash, orders, positions and fresh quotes; decides whether any trade qualifies.
- **Robinhood**: broker of record for authorized order submission, status, fills and broker-resident protective exits.

## Per-session decision cycle
1. Retrieve the newest main-branch `docs/data/execution-dispatch.json`, `docs/signal.json`, `docs/data/trigger-board.json`, and `docs/data/execution-watchlist.json`. Reject missing, stale or conflicting data.
2. Independently inspect Robinhood buying power, holdings, pending orders, fills, market hours and executable quotes. Never infer fills from Teststock signals.
3. Reconcile positions and existing protective exits **before** looking for new purchases. Treat unknown order state as blocking the conflicting action.
4. Rank candidates using evidence, liquidity, spread, catalyst risk, sizing, portfolio overlap and available unleveraged cash. No requirement to place any trade.
5. Enforce `scripts/safety-policy.mjs` and the existing profitability-admission floor. If live execution is disabled, return `NO_ACTION`; a ranked candidate is not an order.
6. For permitted trades, use only supported Robinhood tools and comply with any required user review or confirmation. Do not assume ChatGPT scheduling creates unattended brokerage permissions.
7. After confirmed fills, verify the filled quantity and broker-resident protective orders. If protection is unsupported, fail closed for new entries and prioritize permitted risk reduction.
8. Record decision, reasons, sanitized evidence and verified broker outcomes without storing account credentials in GitHub.

## Scheduled operation
An automation can request a new evaluation at its supported cadence, but a scheduled ChatGPT run is **not** a continuously available broker executor and cannot bypass Robinhood confirmation requirements. Do not claim an unattended trade was placed without broker confirmation.

## Live readiness
As of this change, canonical live execution remains disabled. This document specifies the intended workflow; it does not grant trading permissions, deploy a broker executor, or activate automatic buys/sells.
