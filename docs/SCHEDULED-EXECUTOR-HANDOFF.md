# Teststock scheduled executor handoff contract

## Strict separation
GitHub Actions and repository scripts perform **research and signal publication only**. They must not store Robinhood credentials, call brokerage order endpoints, invoke a trading webhook, or represent a published signal as a fill.

The separately authorized OpenAI executor may evaluate published signals during an active session or supported scheduled run. Scheduling is not continuous execution and does not guarantee that an order can be submitted without interactive broker review.

## Every executor run
1. Read current main branch dispatch, board, watchlist and signal. Reject stale or invalid snapshots.
2. Query Robinhood's current account permissions, unleveraged cash, holdings and **all** relevant pending, partially filled, filled, rejected and cancelled orders.
3. Reconcile broker state first. Exit/protection issues take precedence over new entries. Adopt broker-only holdings into the risk picture; never invent a fill from a signal.
4. For each candidate, enforce canonical safety-policy lock, evidence admission, market session, quote freshness, spreads, buying power, position concentration, duplicate idempotency key and available protective-exit capability. Any failed check = NO_ACTION.
5. Broker-required review and confirmation are mandatory. If unattended submission is not supported, stop and report manual action needed; do not bypass.
6. After a confirmed entry fill, establish and verify risk-reducing broker-resident protection for the **confirmed filled quantity**. If this cannot be done, perform only an authorized risk-reducing response and alert the user.
7. On each run, verify fills and open protective orders at Robinhood. Never blindly resubmit on timeout or ambiguous order state. Record sanitized outcomes separately from credentials and private account identifiers.
8. On missed run, stale broker access, failed order reconciliation, unsupported stops, or unknown position state: fail closed for new risk. Do not claim continuous protection.

## Current operational status
- GitHub market research: separate from broker.
- Scheduled broker execution: **not established by this document**.
- Automatic new entries: disabled by scripts/safety-policy.mjs.
- Live unattended exits: not verified.
- Broker credentials: never placed in GitHub.

## Acceptance tests before any live enablement
- Simulated filled/partial/unfilled/rejected buy and sell orders.
- Duplicate signals and retry after ambiguous broker response.
- Missing stop, rejected stop, cancelled stop, and missed scheduled check.
- Cash-only sizing and stale quote rejection.
- A complete authorized end-to-end broker entry and protective-exit verification using supported execution tools.
- Confirmed scheduler permissions and any broker review requirements.

Do not flip liveExecutionEnabled or capability booleans based on a successful manual sell-to-close alone.
