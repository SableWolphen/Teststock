# October 19, 2026 deployment handoff

Status: NO-GO for live entries. This change repairs diagnostics and fail-closed monitoring; it does not enable broker execution.

Observed failures: full scan run 39255841703, fast refresh 39255227615, and trigger monitor 39255853306 all failed at the authoritative paper Alpaca calendar gate with HTTP 401. The runner previously swallowed clock errors and could finish green after skipping its loop. PR #86's original green checks did not run its four Python dispatch tests.

Changes: retain nonzero failure on unavailable calendar, bound calendar requests to eight seconds, validate calendar schema, emit explicit false outputs and sanitized diagnostic artifacts. Reject stale positive exit bids and reserve unknown/in-flight close orders for reconciliation. Report the canonical deployment lock and unverified exit capability in health. Health runs after failed research runs and reads only published generations, avoiding a separate competing recovery publisher. Add dispatch Python checks to validation CI; allow risk-reducing exit dispatches under the entry lock.

Local verification: 220 JavaScript tests; four Python dispatch checks; three executor usage tests; dependency install from package-lock.json; Vite production build; paper executor returned NO_ACTION and broker_write=false. Mocked tests cover authorization failures, unavailable/malformed calendars, holiday/early close, duplicate exits, stale quotes, and a green runner with the deployment lock. These are not live fill tests.

Deployment procedure:
1. Review and merge the draft PR only after CI on its exact head passes. Recheck changes against current main; generated data continues to advance.
2. Keep scripts/safety-policy.mjs liveExecutionEnabled=false and bootstrapAllowed=false.
3. Verify/replace Actions ALPACA_API_KEY and ALPACA_API_SECRET with a matching paper-account key pair. No credentials belong in source or chat. Documentation: https://docs.alpaca.markets/us/docs/authentication
4. Rerun trigger monitor, full scan, and fast refresh. Require authoritative session data, successful data refresh, coherent fresh signal/board/dispatch, and diagnostic artifact showing the actual gate result. A premarket MARKET_CLOSED result is not an intraday refresh test.
5. Confirm the separate connected broker executor can reconcile all position/order pages, partial fills, cancelled remainders, ambiguous submissions, and broker-only holdings. Repository monitoring cannot certify broker execution; its managed-position profile may be stale.
6. Require current broker-supported entry and exit checks, required order confirmation, protection, exact-lane earned evidence, sufficient cash, duplicate prevention and a qualifying fresh signal. Do not flip the live lock merely to meet today's trading goal.
7. Verify same-session exit submission and confirmed fill on an independently authorized qualifying action. Never place a demonstration trade to prove capability. Hourly scheduled checks cannot establish continuous synthetic protection.

Rollback: revert this PR's code/workflow commit while retaining the canonical live lock. Do not roll back a broker fill or reconstruct quantities from repository files. Reconcile Robinhood again after any deployment or restart.

