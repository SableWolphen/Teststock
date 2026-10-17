# Safe trading research bot

This additive runner preserves existing intelligence pipelines and the canonical live-execution lock. It has no broker/order transport or environment override for real orders. There is **no daily loss limit** in this runner. Other existing strategy/admission policies are unchanged.

## Workflow operation

After merging, open Actions → Safe trading research bot → Run workflow on the default branch. Choose `scan` for one scan, `start` to persist enabled=true and scan, or `stop` to persist enabled=false and skip scanning. The committed default is paused. Control writes require contents-write permission and may be rejected by branch protection; failures are surfaced. Stop controls this workflow only, takes effect when its queued control job runs, and does not close positions or stop existing monitors. Use Actions cancellation for an active run. Branch manual runs are deliberately skipped.

The requested `*/5 13-21 * * 1-5` UTC schedule is a broad weekday window. A fresh Alpaca market clock gates stocks/options for holidays, daylight saving and early closes. Crypto research runs during that window only. GitHub scheduling may be delayed or dropped and must never serve as stop-loss monitoring.

Only ALPACA_API_KEY and ALPACA_API_SECRET are injected at the read step. Use dedicated paper/data credentials with minimum permissions. No Robinhood/OpenAI credentials or private account snapshots are requested. Market-only reports are Actions artifacts with three-day retention, not Pages data. Provider error bodies and credentials are never logged. Existing secrets are neither read nor changed. Actions are pinned; only control has write permission, scan has read permission and no persisted checkout token. No dependency installation is needed.

## Scanner scope

`node scripts/safe-trading-bot.mjs` scans SPY, QQQ, AAPL, MSFT, NVDA, their option chains, and BTC/USD, ETH/USD, SOL/USD. Fixed GET endpoints, ten-second timeouts, bounded transient retries, five pages per option underlying, repeated-token detection and independent lane diagnostics bound the work. Incomplete chains are discarded; degraded data fails the run with a market-only diagnostic report when available.

Stocks/crypto rank positive price momentum against previous daily close, rejecting moves above 15%. Quotes require positive bid/ask and sizes, no crossed market, age at most two minutes, and spread at most 1% (5% options). Options require expiry 7–90 days away, absolute delta 0.2–0.8, and IV above zero and at most 2. WATCH never grants trade authority; filters are not a validated profitable strategy.

Stocks use limited IEX coverage; options use modified indicative quotes and always carry INDICATIVE_RESEARCH_ONLY. Displayed size does not prove fillability. Crypto uses labeled Alpaca US snapshots separately from the unchanged Crypto.com pipeline. Missing open interest, fees, broker tradability, protection and admission remain live blockers.

## Private settled-cash planning

Exported `planSettledCash(candidates, account, now)` is an offline dry-run function, deliberately not fed account data by the public workflow. Its private account contract is:

```json
{"source":"robinhood","reconciled":true,"uncertainOrders":false,"asOf":"fresh ISO timestamp","equityCents":1000000,"settledCashCents":100000,"cashBuyingPowerCents":80000,"pendingBuyCommitmentsCents":20000,"openRiskCents":0,"exposureSymbols":[]}
```

Money must be nonnegative safe integer cents, time within 60 seconds and never future. Available cash is max(0, min(settledCash, cashBuyingPower) - pendingBuyCommitments). Caller must supply authoritative broker data, all exposures and open risk, plus remaining pending-buy notional and fees. The function cannot authenticate provenance; hand-written snapshots must never support live decisions. Conservative double reservation is intentional when broker cash already excludes commitments.

Batch proposals share a decreasing cash/risk budget, reserve a 1% cost buffer, skip existing/duplicate symbols and use whole units. Options reserve the entire standard 100-share premium as maximum loss. Stocks/crypto assume a 3% stop distance for planning; gaps/slippage can exceed that estimate. Planned risk is at most 1% of equity per trade and 5% aggregate including supplied open risk. Cash may be fully used only when these constraints permit; deployment is never forced. Fractional sizing, sell/exit execution, shorting, naked options, exercise, transfers and actual orders are not implemented.

## Verification and live blockers

Run `node --test scripts/test-safe-trading-bot.mjs`, `npm test`, and `npm run build`. Tests use synthetic fixtures and mocked transport; no broker credentials or account access are used. They cover quote validation, cash/risk boundaries, duplicate exposures, full option premium, sessions, pagination, redacted errors and workflow invariants.

Live execution remains disabled pending independent authentication/token-storage tests, authoritative account normalization, exact instrument permissions, broker-resident protection and exits, idempotent claims, ambiguous/partial fill reconciliation, fees/slippage, restart recovery, and existing evidence/admission gates. No broker capability/security verification or profitability is claimed.

Sources: [Alpaca option chains](https://docs.alpaca.markets/us/reference/optionchain), [crypto snapshots](https://docs.alpaca.markets/us/reference/cryptosnapshots-1), [GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
