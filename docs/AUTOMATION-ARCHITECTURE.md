# Teststock automation architecture and go-live gates

Teststock is research and monitoring software, not a licensed brokerage. ChatGPT's connected Robinhood tools are not available to GitHub Actions or a Node server as reusable credentials. Never attempt to extract, replay, or circumvent those tool credentials or platform safety checks.

## Components
1. Market-data adapter: timestamped stock/option quotes, bid/ask, exchange hours, source health, freshness limits, historical OHLCV.
2. Research engine: strategy library, historical backtesting, walk-forward validation, conservative estimated fees and slippage.
3. Portfolio and order reconciliation: broker balances, fills, positions, queued/partially-filled orders; durable idempotency keys.
4. Execution adapter: supported official broker API, with user-authorized credentials stored in a secrets manager, never in the repository or client.
5. Risk supervisor: risk budget, exposure caps, order-price limits, broker-resident protection when supported, expiration controls, daily loss circuit breaker, emergency shutdown.
6. Operator dashboard: distinguish verified live orders from simulated research, display data age, connection health, last fill, and open risk.

## Go-live checklist
- [ ] Official supported broker API access and trading authorization confirmed
- [ ] Independent, monitored service deployed with encrypted credentials
- [ ] Market-data freshness and trading-session checks tested
- [ ] Same-session buy AND sell capability tested in sandbox and verified in production
- [ ] Order idempotency and broker reconciliation tested against partial fills and timeouts
- [ ] Stop/exit handling tested during disconnections, volatility, and market closure
- [ ] Account buying power and maximum loss validated before each order
- [ ] Strategy passed out-of-sample evaluation including realistic fees and slippage
- [ ] Alert delivery, kill switch, audit log, and operational recovery verified

Until every gate is checked, `docs/data/executor-capabilities.json` must remain `MANUAL_ONLY_FAIL_CLOSED`. A scheduled ChatGPT task is not a continuous order-monitoring service. Never represent a research signal as an executed trade or guarantee profits.
