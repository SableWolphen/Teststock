# Safe trading research bot

This additive runner preserves existing intelligence, admission and execution locks. It has no Robinhood login, TOTP generator, order transport, native stop submission or software sell loop. No flag enables real orders. The user's updated instruction enables an **$80 daily-loss gate** in private planning, superseding the earlier no-limit request for this runner. Legacy strategy/admission policies remain unchanged.

## Workflow

After merging, use Actions → Safe trading research bot → Run workflow on the default branch. Choose scan for one scan, start to persist enabled=true and scan, or stop to persist enabled=false and skip scanning. Default is paused. Control/publication writes require contents-write permission and may be rejected by branch protection; failures are surfaced. Stop affects only this workflow after its queued control job runs. It never closes positions or stops existing monitors. Cancel active runs through Actions as needed. Branch manual runs are deliberately skipped.

The requested `*/5 13-21 * * 1-5` UTC cron is a broad weekday window. A fresh Alpaca clock gates stock/options reads for holidays, daylight saving and early closes. Crypto also runs only in that window. GitHub may delay/drop schedules: this is not reliable five-minute execution or stop monitoring.

Each cycle checks out the latest default branch and reads **.github/trading-bot-strategy.json** plus fixed symbol sources:

- docs/data/execution-watchlist.json
- docs/data/trigger-board.json
- docs/data/broad-stock-universe.json
- docs/data/crypto-universe.json
- docs/data/small-account-options.json

Only validated symbols enter requests. Stale files may nominate symbols but cannot confirm signals. Trigger-board thresholds are informational and need board/row timestamps within 30 minutes. Repository data cannot specify URLs, credentials, commands or orders. Invalid strategy files abort.

## Bulk ingestion and signal checks

Alpaca's read-only asset endpoint discovers active tradable symbols; repository nominations have priority, followed by discovery order. Defaults: up to 2,000 stocks and 500 USD crypto pairs, batches of 100, three concurrent reads, 240 HTTP attempts and a four-minute request deadline. Attempts are paced at least 350ms apart; retries consume budget. Universe ceilings can be configured up to 10,000 per lane, subject to actual provider coverage and request/time limits. No fixed global asset count or scan speed is claimed.

Reports include source freshness, discovery status, discovered/requested/received counts, truncation, batch failures, history coverage, request count and elapsed time. Missing snapshots or failed discovery/history reads degrade the lane and fail the run. A configured cap is explicit truncation, not full-market coverage.

Quotes require positive bid/ask and displayed sizes, no crossed market, age at most two minutes, and spread **at most 1.5% of midpoint** in every lane. Stocks/crypto initially need positive momentum against previous daily close, capped at 15%. Options need valid symbols, expiry 7–90 days away, absolute delta 0.2–0.8 and IV above zero and at most 2. Up to five strongest stock underlyings receive option-chain reads, capped at five pages each. Truncated/repeated-token/malformed chains are rejected. Complete chains may remain diagnostic when another fails; a degraded run does not publish.

Up to 20 candidates per lane receive bulk one-minute bars. A signal needs 21 consecutive completed minutes, excluding the current partial minute. It requires either price AND the latest completed close above the prior 20-minute high, OR last-minute volume at least twice the preceding 20-minute average. Missing, sparse, duplicate, stale or invalid bars cannot qualify. Candidates outside the history shortlist remain unverified/rejected. Options use their own contract bars, never underlying volume as a substitute. Early-session or sparse contracts may not have sufficient data.

IEX is limited stock coverage. Indicative option quotes are modified/delayed and always carry INDICATIVE_RESEARCH_ONLY. Displayed size does not prove fillability/open interest. Alpaca US crypto research remains separate from the unchanged Crypto.com pipeline. Discovery does not prove Robinhood tradability or protection support.

## Earnings and macro gates

A valid fresh SPY snapshot supplies a market-stress proxy. A day move at or below -3% blocks every lane, including crypto; missing/stale/invalid data fails closed. This is a price-stress check, not a complete macro-event calendar. Outside the stock session, missing SPY data can prevent crypto qualification.

Issuer stocks/options need **docs/data/trading-bot-events.json**. SPY and QQQ are explicit ETF exemptions; other ETFs fail closed unless verified classification is added later. Contract:

```json
{
  "source": "verified-calendar-provider-name",
  "generatedAt": "ISO timestamp within 24 hours",
  "coverage": {
    "AAPL": {
      "checkedAt": "ISO timestamp within 24 hours",
      "checkedThrough": "ISO timestamp covering at least the next 48 hours",
      "earningsAt": ["ISO timestamp of the next earnings event"]
    }
  }
}
```

An explicitly verified empty list may represent no event through checkedThrough. Missing/stale/malformed/insufficient coverage gives EARNINGS_UNVERIFIED. An event in the next 48 hours or preceding hour gives EARNINGS_BLACKOUT. This PR does not invent a calendar feed: a verified producer remains required. The file contract cannot authenticate its provider's claims; news absence is never treated as no earnings.

## Private cash and loss planning

`planSettledCash(candidates, account, now, config)` is offline; the public workflow receives no account data. Account inputs need source=robinhood, reconciled=true, uncertainOrders=false, asOf within 60 seconds; nonnegative safe integer cents for equityCents, settledCashCents, cashBuyingPowerCents, pendingBuyCommitmentsCents and openRiskCents; and exposureSymbols for every position/order.

Cash is max(0, min(settledCash, cashBuyingPower) - pendingBuyCommitments). Pending commitments include remaining notional and fees, even if conservatively reserved twice. Proposals share decreasing cash/risk budgets, reserve a 1% cost buffer, avoid existing/duplicate symbols and use whole units. Long options risk the full standard 100-share premium. Stocks/crypto assume a 3% stop distance for planning; gaps/slippage can exceed it. Planned risk is capped at 1% of equity per trade and 5% aggregate including supplied open risk. Cash use is never forced. Fractional sizing, native stops, entries and sells are not implemented.

The updated $80 rule additionally needs these private fields:

```json
{
  "dailyLoss": {
    "asOf": "fresh ISO timestamp",
    "sessionDate": "YYYY-MM-DD in America/New_York",
    "grossRealizedLossCents": 0,
    "unrealizedLossCents": 0
  },
  "dailyLossState": {
    "version": 1, "sessionDate": "same New York date",
    "halted": false, "peakLossCents": 0,
    "grossRealizedLossCents": 0, "updatedAt": "fresh ISO timestamp"
  }
}
```

Loss means gross realized losing-trade amounts including fees PLUS current unrealized losses on losing positions. Gains do not offset losses. At **8,000 cents or more**, new proposals halt. The latch survives recovery and resets only on the next New York calendar date, never UTC midnight. Protective exits must not be suppressed; this runner implements no exits. Periodic observation cannot guarantee losses remain below $80.

`scripts/daily-loss-guard.mjs` provides pure evaluation and `updateDailyLossGuard(absolutePrivateFile, account, 8000, now)`. The latter locks and atomically persists a pre-existing private state file before returning. Missing/corrupt state, a competing lock, stale account/loss data, cumulative realized-loss rewind or same-day state older than six minutes blocks planning. Missing state is never silently initialized. Future broker integration must initialize/reconcile verified daily loss history and prove monitoring continuity. Persist the latch before consuming allowed planning results. The pure planner cannot authenticate broker provenance or persistence. Never commit account, P/L, loss state or fill records to this public repository.

## Publication and secrets

Successful scans produce market-only Actions artifacts retained three days, then a separate contents-write job publishes an allowlisted top-20 packet to **docs/data/safe-trading-research.json**. It expires no later than five minutes after scan start, or earlier when any included quote/bar reaches two minutes old. It remains action=NO_ACTION and liveOrdersEnabled=false and contains no account/fill claims. Candidates are rechecked after all reads and again at publication; stale ones are excluded. Stale or out-of-order publication is rejected/skipped. A failed/degraded run cannot refresh the previous packet, which expires; consumers must enforce expiry. This path is not wired into legacy execution-dispatch/admission. No fake executed-trade ledger is written.

Only ALPACA_API_KEY and ALPACA_API_SECRET are injected at the read step. Endpoints are fixed/GET-only, with redirect rejection, bounded transient retries and ten-second per-attempt timeouts within the overall deadline. Provider error bodies and credentials are never logged. Actions are pinned, scan has contents-read and no persisted checkout token, and only control/publication may write fixed repository paths. No dependency installation is needed. Temporary scan/publication files are removed after upload/publication. No Robinhood session exists to disconnect. Existing secrets are untouched.

## Validation and live prerequisites

Run `node --test scripts/test-safe-trading-bot.mjs scripts/test-trading-research-policy.mjs`, `npm test`, and `npm run build`. Tests use fixtures/mocked transport, not live credentials. Coverage includes spread boundaries, intraday/volume checks, discovery/truncation, source freshness, earnings/macro failures, cash/risk budgets, option premium risk, daily-loss equality/latching/date reset/persistence, HTTP budgets, pagination, redaction and packet expiry.

Live work remains blocked pending secure broker authentication, authoritative cash/position/order/loss normalization, exact instrument permissions, native protection/exits, idempotent claims, ambiguous/partial-fill reconciliation, fees/slippage, restart recovery and existing profitability-admission evidence. GitHub's five-minute schedule cannot replace broker-resident protection. No broker capability/security verification or profitability is claimed.

Sources: [Alpaca snapshots](https://docs.alpaca.markets/us/reference/stocksnapshots-1), [option chains](https://docs.alpaca.markets/us/reference/optionchain), [crypto bars](https://docs.alpaca.markets/us/reference/cryptobars-1), [option bars](https://docs.alpaca.markets/us/reference/optionbars), [GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
