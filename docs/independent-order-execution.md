# Independent Teststock order execution — release checklist

Current status: **PREFLIGHT ONLY / LIVE ORDERS DISABLED**.

## Architecture
1. Existing market data jobs publish versioned dispatch packets to `docs/data/execution-dispatch.json`.
2. `scripts/unattended-execution-service.mjs` performs freshness, dispatch, health and capability checks without any broker writes. The new scheduled GitHub workflow publishes its decision as a short-lived artifact.
3. A future separately deployed, authenticated executor (not GitHub Actions and not a ChatGPT conversation) must authenticate independently to an approved Robinhood broker interface; permissions for this chat DO NOT transfer to that process.
4. That executor needs durable storage for idempotency keys, broker order IDs, partial fills, positions, and protective orders, and a broker state reconciliation loop.
5. A separately reliable exit monitor must handle disconnections, failed stops, partial fills, time-based forced exits and on-call escalation.

## Required acceptance tests before any live-entry enablement
- Supported noninteractive broker authentication with consent and token refresh, stored outside the public repo; never copy tokens to GitHub files or logs.
- Broker confirms the designated account, options permissions when applicable, equity and option order review/submission endpoints, cancel and exit abilities.
- Paper test: open, partial fill, protective stop, target, cancellation, stop-replace and forced exit with stable unique client order keys.
- Crash/retry test: repeated same dispatch never duplicates an order; uncertain submit state always reconciles against broker before retry.
- Stale quotes, closed market, cash shortfall, margin leverage, restricted stocks, expired dispatch, excessive spread, and daily loss breach all block new entries.
- Position-monitor test: when signal generation is down, existing positions still trigger broker reconciliation and exit escalation.
- Stop execution tests: protective exit is confirmed by broker; cancel failure must never lead to a second conflicting order.
- Order-size policy reviewed and risk budget specified, using **unleveraged** buying power; avoid rolling/overnight positions when the strategy requires same-day exit.
- Measured full-cycle reliability in paper mode over multiple market sessions, with alerts and manual emergency stop tested.
- A separately reviewed pull request must explicitly enable live trading after all independent attestations; do not auto-switch based on environment flags or the existence of secrets.

## Currently verified
- GitHub monitoring/CI runs; repository contains paper-mode runner.
- ChatGPT's connected Robinhood tools can read the dedicated trading account **in this conversation**.
- Neither a historical sell-to-close nor this chat's connection proves noninteractive unattended entry and exit.
- `scripts/safety-policy.mjs` has `liveExecutionEnabled:false` and `maxOrderUsd:0`.
- `scripts/chatgpt-executor.mjs` currently throws `LIVE_DISABLED` on its live execution path.

## Operator use
- Run `node --test scripts/test-unattended-execution-service.mjs` to check release-lock invariants.
- Run `node scripts/unattended-execution-service.mjs` to print a no-write readiness snapshot.
- Only on a separately secured machine with intentionally configured API/OAuth secrets, optionally run `node scripts/unattended-execution-service.mjs --mcp-probe` to perform a **read-only** broker connectivity probe.

No script in this phase should place real orders. No secret material belongs in this public repository.
