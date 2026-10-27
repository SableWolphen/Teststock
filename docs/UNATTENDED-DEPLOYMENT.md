# Unattended Teststock deployment checklist

The repository is **not** an unattended live broker until the items below are independently verified. The default is paper. No claim of guaranteed returns or $100 million outcome is made.

## Existing-money-only mandate
- Use only broker-reported available **unleveraged** buying power from the dedicated MCP account. No margin, loans, deposits, transfers, naked options, or exercise.
- Reconcile positions, orders, partial fills, cancellations, and buying power before **every** order; manage exits first.
- If the broker or feed is stale, credentials expire, a confirmation is required, a scheduled run is missed, or exit submission cannot be verified: do not open new risk. Alert the operator.

## Operator deployment
1. Merge the PR after tests and code review. GitHub schedules operate on the default branch and are best-effort; they are **not** an adequate sole exit-monitoring system.
2. Provision a durable always-on runtime with persistent encrypted claim storage, supervised process restarts, market-hours scheduling, and independent alerting. Do not store OAuth tokens or API keys in Git.
3. Configure `OPENAI_API_KEY`, `ROBINHOOD_MCP_OAUTH_TOKEN`, and the authenticated broker MCP endpoint using the runtime secret manager. Verify token renewal and broker permissions.
4. Run `npm ci && npm test && npm run build`. Then `TESTSTOCK_EXECUTION_MODE=paper node scripts/chatgpt-executor.mjs` and `node scripts/chatgpt-executor.mjs --mcp-probe` with read-only access.
5. Verify the actual broker **entry and exit** path, account scoping, fill detection, duplicate recovery, partial fills, and reconnect behavior using separately authorized small tests. A simulated order or account eligibility is insufficient.
6. Issue a short-lived independent runtime attestation based on those observed facts; never set capability flags true without proof. Verify scheduler heartbeat, risk controls, position/order reconciliation, and alert delivery.
7. Only after successful evidence-backed verification may the operator explicitly configure live mode. Retain fail-closed gates, unique order references, and an emergency stop. Never claim a run placed an order without a broker-confirmed order ID and fill status.

## Research feeds
`docs/external-data-sources.json` is a **registry**, not an active ingestion pipeline. `scripts/external-signal-fusion.mjs` is research-only and cannot authorize an order. Data ingestion must comply with provider terms, record provenance and timestamps, and avoid look-ahead bias. Paper and out-of-sample results must be measured after spreads and fees.

## Current blockers
- Live stock and options entry/exit attestations are not verified.
- Hosted unattended broker executor, heartbeat, and independent alerts are not deployed.
- The PR is not merged; tests and production runtime have not been verified here.

## Always-on service (`npm run service`)
`scripts/trading-service.mjs` runs the existing executor every `TESTSTOCK_TICK_SECONDS` (default 300) during New York regular hours, Mon-Fri. It places no orders itself and cannot bypass executor gates; the repo's current options lock (`SHADOW_ONLY`) and capability attestation still block live entries.

- **Kill switch:** create the file `~/.teststock-runtime/KILL` (or set `TESTSTOCK_KILL=1`). All ticks stop and an alert is sent. Remove the file to resume.
- **Fail-closed:** a failed `git pull`, a dispatch older than 15 minutes, or 3 consecutive failures halt ticks and alert. A halted service also stops handling exits.
- **Alerts:** set `TESTSTOCK_ALERT_WEBHOOK_URL` (Slack/Discord-compatible `{text}` POST). Without it, alerts go to stderr only.
- **Holidays:** no built-in calendar; set `TESTSTOCK_HOLIDAYS=YYYY-MM-DD,...`.
- **Heartbeat:** `~/.teststock-runtime/service-heartbeat.json`; monitor its `at` timestamp from a separate system.
- **Mode:** paper unless `TESTSTOCK_EXECUTION_MODE=live` and `TESTSTOCK_LIVE_TRADING=I_UNDERSTAND_REAL_ORDERS` are both set by you on the host.
- Run under a supervisor (systemd, Docker restart policy, Fly/Railway) so it restarts after crashes.
