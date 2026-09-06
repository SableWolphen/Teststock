
# Trade quality, resilience and post-trade learning

Also read `docs/data/trade-quality-intelligence.json` before creating any new risk. It is a risk-reducing/reordering layer only and can never create eligibility, increase hard risk ceilings, or override broker checks.

Apply these rules on every live run:
- If `dataWatchdog.state=STOP_NEW_RISK`, create no new positions until fresh required data returns; continue reconciliation, protection and exits.
- If `drawdownRisk.state=REDUCE_NEW_RISK`, reduce size/selectivity within existing caps. If it is `STOP_NEW_RISK`, manage/exits only.
- Treat `brokerWatchdog` requirements as mandatory live checks. Any mismatch between repository state and Robinhood positions/orders/buying power/protection blocks new risk until reconciled.
- Use `executionScorecard`, setup governance and time-of-day evidence only when their sample sizes are sufficient and Robinhood-confirmed. Missing evidence is not negative evidence and must never be fabricated.
- A setup marked `RETIRE_LIVE_TO_SHADOW` must not receive new live entries. A retired setup may return only after fresh forward-shadow/out-of-sample evidence and current safety validation support resurrection.
- The paper twin, replay engine, rejected-opportunity tracking, missed-fill analysis and best-alternative analysis are research-only. Never count hypothetical trades as fills or PnL.
- Capture, when broker/tooling exposes them, entry/exit spread, slippage, fill latency, protection latency, exit reason, setup, regime and session bucket for later attribution. Do not invent unavailable fields.
- Prefer setups with positive after-cost expectancy and stable parameters. Reject a strategy whose apparent edge depends on one fragile threshold or only on the period used to design it.
- Treat sudden spread expansion, liquidity loss, a halt/resumption uncertainty, feed failure, MCP failure, ambiguous submission, partial fill, duplicate order, early-close mismatch or position mismatch as a chaos condition. New risk fails closed; exits/protection/reconciliation take priority.
- Do not publish or act on a precise risk-of-ruin estimate until `riskOfRuin.state=ESTIMABLE`; insufficient samples must remain explicitly insufficient.
- Optimize for after-cost expectancy and drawdown-adjusted execution quality, not number of trades. Cash/no-action remains valid.
