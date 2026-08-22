# Teststock Claude Memory

Read this file before analyzing, changing, or operating Teststock. This is durable repository context, not authorization to trade.

## Mission

Teststock is a continuously refreshed trading research, ranking, monitoring, and controlled-execution system. Its objective is positive cost-adjusted expectancy, smaller controlled losses, bounded drawdown, reproducibility, and survival. It cannot guarantee wins, profit, or income. Never describe it as lossless or promise that a user can live from its returns.

## Architecture

- Preserve exactly two tournaments: one stock tournament and one crypto tournament.
- A candidate may be classified `DAY_TRADE`, `SWING_POSITION`, or `LONG_TERM`; this is a horizon inside its existing tournament, not another tournament.
- Stocks use selective intraday/regime-specific validation and require explicit per-order user approval before every purchase.
- Crypto uses the dedicated GitHub Actions Robinhood Crypto API lane. Do not route crypto through Claude's stock-approval or Robinhood-stock execution path.
- The crypto research and executable tournaments use exact `/USD` quote pairs only. Exclude `/USDT`, `/USDC`, and every other quote currency.
- No candidate is required. Holding cash is valid whenever every hard gate does not pass.

## Source roles

- Alpaca: primary stock/crypto universe, bars, quotes, liquidity, historical research, corporate actions, and non-LLM trigger monitoring.
- Robinhood stocks: authoritative runtime source for real cash, positions, orders, fills, and approved stock execution.
- Robinhood Crypto API: authoritative crypto account, order, fill, and protection lane.
- SEC EDGAR: official stock fundamentals and material filings.
- InsiderFinance and Stockcircle: delayed public congressional-disclosure collection when available.
- Capitol Trades and Barchart: disclosure reconciliation/reference unless authorized structured access exists.
- Quiver Quant and Unusual Whales: optional licensed APIs. They remain shadow-only until configured and independently validated.
- Yahoo Finance and Google Finance: secondary manual/reconciliation references, not authoritative execution feeds.
- TradingView: chart, technical, and alert visualization; it does not replace Teststock's Alpaca datafeed.
- Webull: optional authorized OpenAPI/broker reconciliation when credentials and a reviewed adapter exist.
- Finviz: screener/fundamental/liquidity reconciliation through permitted licensed access.
- Confirmed Robinhood fills: the only authority for real-money performance learning and any permitted performance-based scaling.

Never bypass authentication, subscriptions, provider terms, robots restrictions, or rate limits. Never commit secrets, account identifiers, private quantities, or credentials. A missing provider must be marked unavailable/stale and must not silently authorize risk.

## Evidence and admission

- Deduplicate the same fact or disclosure across sources. Agreement increases data confidence, never the number of politicians, trades, or independent signals.
- All new/alternative sources begin with zero live ranking contribution.
- Backtests and historical sample/win-rate statistics are diagnostic only. They cannot create `MICRO_PROBATION`, live eligibility, or live size. Zero or unknown forward evidence is never a pass.
- Six actual independent positive forward-shadow outcomes are required for `MICRO_PROBATION` at no more than 25% of the already-bounded normal size. Twelve independent positive shadow outcomes are required for half-size `PROBATION`; normal eligible size still requires sufficient positive confirmed Robinhood fills. Duplicate same-day symbol/setup/regime observations count once using the most adverse result.
- User-authorized crypto day-trade seed exception: while crypto admission is `SHADOW_ONLY`, one A/A+ candidate may trade through the official Robinhood Crypto API at no more than $5, with one position maximum, an eight-hour time exit and a pause after two stopped seed trades per UTC day. This bypasses only the shadow waiting period; it never applies to `LIVE_SUSPENDED` and never bypasses research, liquidity, spread, freshness, broker, buying-power, no-chase or immediate stop-protection gates. Stocks remain unchanged and require per-order approval.
- Require independent forward samples, positive cost-adjusted expectancy, regime coverage, drawdown/adverse-excursion review, and untouched holdout validation before bounded influence is considered.
- Backtests and shadow results may rerank, reduce, expire, suspend, or block. They cannot create live eligibility, raise maximum risk, loosen a gate, or increase live size.
- Unknown data is not a pass.

## Entry and risk rules

- Never use margin or leverage.
- Never average down, chase beyond the maximum entry, widen a stop, force a trade, or leave an unprotected position.
- Never raise account, trade, position, deployment, concentration, correlation, or loss limits.
- Preserve market-regime gates, liquidity/spread gates, profitability admission, portfolio correlation/heat guards, event-risk checks, freshness/decay, and broker verification.
- Every stock BUY requires the user's explicit approval for that exact order after live Robinhood verification. A trigger is not approval.
- Alpaca discovery never proves Robinhood executability. Before presenting approval and again before submission, confirm the exact stock is currently searchable, buyable and unrestricted in the signed-in Robinhood account and supports the planned order/protection. Failed verification rejects that candidate; use only an already-qualified fallback.
- For crypto, require the official Robinhood Crypto API trading-pair response to mark the exact pair tradable. Missing pair, quote or supported protection means no order.

## Saved trade plan

Before entry, preserve the candidate's ticker, horizon, entry range, maximum entry, stop/invalidation, Target 1, Target 2, reward/risk, planned maximum loss, setup expiration, and thesis. Do not invent sell points after entry to avoid recognizing a loss.

Robinhood-confirmed holdings, orders, and fills are authoritative. Public planning files are not proof of a live position or fill.

## Sell and protection policy

Sell/protection events have priority over new buys. Alpaca and GitHub detect price triggers; the authorized broker lane must verify the actual position and fill.

### Day trade

- Holding window: minutes through the same stock session.
- Use protected bracket/OCO behavior when supported.
- Stop: the saved validated stop below support/VWAP only when it remains inside existing Teststock risk limits.
- Profit: validated Target 1/Target 2 or just before confirmed resistance, without weakening the qualifying reward/risk.
- Time exit: close before the regular-session end unless the position is explicitly reclassified and re-approved as a swing trade.
- Exit or reduce a stalled/expired setup according to its validated time window.
- The common 1% rule is a ceiling concept, not a target. Teststock's existing lower risk cap always wins.

### Swing/position trade

- Holding window: days to weeks.
- Use the saved protected stop and validated targets.
- Exit on stop, target, setup expiration, adverse regime change, material event risk, unacceptable liquidity/gap risk, or the maximum validated holding period.
- Review overnight gap exposure; never silently convert it into a long-term holding.

### Long-term stock

- Require strong, sufficiently covered SEC fundamentals and a recorded durable thesis.
- Review quarterly and after material filings/events.
- Sell or trim on thesis invalidation, durable competitive deterioration, repeated negative revenue trend, balance-sheet deterioration, unsupported valuation, the existing concentration cap, or a user-defined life goal.
- Do not default to an unrestricted market stop that can be triggered by a flash crash.
- Long-term does not mean unprotected: use alerts, approved stop-limit/protection, staged exits, or manual review consistent with existing hard maximum-risk rules.

### Crypto

- Crypto trades 24/7; do not apply a stock end-of-day rule.
- Use the Robinhood Crypto API's verified GTC stop and limit-target behavior.
- Exit on stop, targets, trend/BTC-context/liquidity invalidation, signal expiration, or maximum holding window.
- Do not classify crypto as `LONG_TERM` without independently validated network, custody, liquidity, and fundamental evidence.

### Trigger handling

- Read `docs/data/trigger-board.json` first.
- If `executionNeeded=false`, stop before Robinhood and full-signal work.
- `TRIGGER_1_STOP`: verify the live position, execute the strongest permitted protective exit, and verify the fill.
- `TRIGGER_2_TARGET1`: verify and execute the validated first scale-out; update state only after the fill is confirmed.
- `TRIGGER_3_TARGET2`: verify and execute the validated final target/runner decision; update state only after confirmed fills.
- Prevent duplicate and oversell orders. Adjust/cancel the conflicting bracket side after partial or full execution.

## Learning

- Learn only from reconciled, confirmed real fills for real-money outcomes.
- Track entry/exit slippage, fill time, protection latency, realized R, maximum favorable/adverse excursion, setup, regime, horizon, and exit reason.
- Use minimum samples, shrinkage, recency weighting, and regime separation.
- Learning can reduce or block immediately when safety deteriorates. It cannot promote itself above hard limits.

## Required change workflow

1. Pull the latest `main`; scheduled workflows may have published generated state.
2. Inspect current files and preserve unrelated/user changes.
3. Make small, traceable changes and update validators and dashboard visibility.
4. Never place a live order during development or testing.
5. Run the production build and all relevant risk, approval, tournament, execution, provider, horizon, and signal validators.
6. Commit logically, rebase safely across generated workflow commits, and push only validated changes.
7. Watch GitHub Actions through completion. Diagnose the exact failed step and fix the cause.
8. Report commits, behavior changes, tests, production results, unavailable providers, and anything still shadow-only.

## Canonical runtime files

- `docs/signal.json`
- `docs/data/stock-tournament.json`
- `docs/data/crypto-tournament.json`
- `docs/data/market-intelligence.json`
- `docs/data/congressional-intelligence.json`
- `docs/data/trigger-board.json`
- `docs/data/execution-dispatch.json`
- `docs/data/execution-watchlist.json`
- `docs/data/adaptive-performance.json`
- `docs/data/real-trade-journal.json`
- `docs/claude-autopilot.txt`
- `docs/claude-trigger-task.txt`

When this memory conflicts with a current hard validator or a more restrictive safety rule, follow the more restrictive rule.
