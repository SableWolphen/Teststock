# Teststock Claude Memory

Read this file before analyzing, changing, or operating Teststock. This is durable repository context, not authorization to trade.

## Mission

Teststock is a continuously refreshed trading research, ranking, monitoring, and controlled-execution system. Its objective is positive cost-adjusted expectancy, smaller controlled losses, bounded drawdown, reproducibility, and survival. It cannot guarantee wins, profit, or income. Never describe it as lossless or promise that a user can live from its returns.

## Architecture

- Preserve exactly two tournaments: one stock tournament and one crypto tournament.
- A candidate may be classified `DAY_TRADE`, `SWING_POSITION`, or `LONG_TERM`; this is a horizon inside its existing tournament, not another tournament.
- Stocks use selective intraday/regime-specific validation and require explicit per-order user approval before every purchase.
- Options are exceptional, not default, and live only inside the stock tournament's `stockPlan.eliteOption` field -- never a third tournament. They require every eliteOption research check (growth quality, learning score, historical samples/win rate, cost-adjusted expectancy, reward/risk, market/sector/intraday confirmation, adaptive performance, defined-risk sizing, DTE), the strongest-regime `allowOptions` gate, a runtime whole-contract sizing check, and a live real-fill evidence gate (minimum 10 resolved option trades, average realized R >= 0.25, win rate >= 50%, confirmed from actual Robinhood option order history) before any order. Options require their own separate per-order user approval, distinct from any stock approval, and are capped at one new position per day. Long calls/puts only -- no naked or undefined-risk option positions.
- Crypto uses the dedicated GitHub Actions Robinhood Crypto API lane. Do not route crypto through Claude's stock-approval or Robinhood-stock execution path.
- Stock and options universe discovery is fully live (Alpaca most-actives screener plus tradability/price/dollar-volume filters); no hardcoded ticker list may gate what can be discovered or traded. The one intentional exception is `scripts/validate-entry-gates.mjs`'s fixed backtest universe and multi-year date range, which exists only to calibrate walk-forward regime profiles and is diagnostic, not a live trading gate.
- The crypto research and executable tournaments use exact `/USD` quote pairs only. Exclude `/USDT`, `/USDC`, and every other quote currency.
- No candidate is required. Holding cash is valid whenever every hard gate does not pass.

## Source roles

- Alpaca: primary stock universe, bars, quotes, liquidity, historical research, corporate actions, and non-LLM trigger monitoring (stocks). Also used for the crypto side of the non-LLM live-position trigger monitor's latest-trade price checks.
- Crypto.com public API: primary crypto universe discovery, daily/4-hour bars, historical calibration, and 24-hour liquidity for crypto research. Alpaca's crypto bars/volume feed was found unreliable (roughly 1,000x-5,000x volume error; unreliable native 4-hour candles) and is no longer used for crypto research data. The scanned universe is the top 200 USD spot pairs by 24-hour volume (raised from 80 on 2026-08-23). The 4-hour setup's volume-confirmation check (`fourHourSetup` in `scripts/generate-crypto-picks.mjs`) compares only fully-closed 4-hour candles at a 0.9x-of-average threshold (loosened from comparing the still-forming latest candle at 1.05x on 2026-08-23) -- the still-forming candle's partial volume was making the check fail almost every scan regardless of real market activity. Price/RSI/momentum still read the live last candle; only the volume comparison changed. On 2026-08-23, at the user's explicit request to make crypto qualify more often, `fourHourSetup`'s overall `confirmed` result was also relaxed from requiring ALL FOUR of {RSI 50-70, pullback to VWAP/support, momentum turning up, volume confirming} to requiring only 3 of those 4 (any 3) -- live data showed strong, liquid majors (BTC/USD, SOL/USD, ADA/USD, etc.) routinely had 3 align while noise kept exactly one from lining up at the same instant. The separate price-vs-ma20 trend check (`last>=ma20*.995`) remains mandatory and is not counted among the "4". `grade()`'s duplicate `intradayOk` check, which previously re-derived its own stricter all-4 AND independent of `fourHourSetup`'s result (a latent bug that would have made this relaxation a no-op), was fixed to simply follow `fourHourSetup`'s `confirmed` field (`x.confirm4h`) instead. Verified via `node --check` and a 500-trial randomized synthetic-candle invariant test (this sandbox cannot reach `api.crypto.com` for a live dry run) confirming `confirmed === trendOk && confirmationsMet>=3` held in every trial, including cases that actually hit the 3-of-4 boundary. The liquidity floor (`dollarVolume24hReal` minimums in `grade()`) and the crypto profitability-admission ladder (`crypto-profitability-admission.json`, still `SHADOW_ONLY`/`sizeMultiplier:0` as of this change) were both explicitly left untouched -- this only affects which candidates can reach A/A+ `setupGrade`, never how much real money an admitted candidate risks.
- Robinhood stocks: authoritative runtime source for real cash, positions, orders, fills, and approved stock execution.
- Robinhood Crypto API: authoritative crypto account, order, fill, and protection lane. The crypto autopilot also publishes two independent read-only checks together inside `docs/data/crypto-robinhood-cross-check.json` -- `perCandidateCrossCheck` (pair-tradability and live best-bid/ask for the current research/qualified champion and fallbacks) and `fullTradableUniverse` (every USD pair Robinhood's API can trade, one bulk trading-pairs call, refreshed every autopilot run). Both live in this one file, not separate files, because `.github/workflows/*.yml` cannot be edited through any available tool and this path is the one already on the autopilot's git-add allowlist. `scripts/generate-crypto-picks.mjs` reads `fullTradableUniverse` to prefer, among candidates that already qualify on Crypto.com data, ones Robinhood can actually execute -- never to admit an otherwise-disqualified candidate or change a growthQuality/score number. Both checks are diagnostic/preference-only, contribute zero live ranking weight of their own, and never place, cancel, or modify an order; Crypto.com remains the primary crypto research/bars/liquidity source, and the real-money buy path always independently re-verifies the exact chosen pair live before any order regardless of what this file says. Stocks are unaffected -- Robinhood stock verification already happens at approval/submission time through the existing per-order Claude-mediated path. Crypto buy/sell decisions themselves are fully automatic through this deterministic, no-LLM lane (subject to every gate in this file) -- stocks and options are the only asset classes that require per-order Claude-mediated approval; this split is intentional, not a gap. `.github/workflows/crypto-autopilot.yml`'s `schedule.cron` is documented in code as `'4,9,14,19,24,29,34,39,44,49,54,59 * * * *'` (offset off round 5-minute marks, matching the other three scheduled workflows, fixed 2026-08-23 after live runs were observed landing roughly once an hour instead of every 5 minutes) -- but this repository's GitHub integration returns `403 Resource not accessible by integration` on any write under `.github/workflows/`, so that specific file could not actually be pushed; if the live file on GitHub still reads `'*/5 * * * *'`, the user needs to make that one-line edit themselves (GitHub web UI, or any tool with `workflow` scope) for the fix to take effect. Fixed 2026-08-24: `scripts/robinhood_crypto_autopilot.py`'s `RobinhoodCryptoV2.accounts()/holdings()/pairs()/orders()` calls only ever read `response['results']` and silently dropped any pagination `next` page, so `fullTradableUniverse` was really just page 1 of Robinhood's real tradable-pairs list -- confirmed live when a no-filter `pairs()` call returned only 20 total/13 tradable pairs (mostly obscure coins) while the user's own Robinhood app showed LTC directly buyable with a live quote, and that same day's crypto tournament had picked LTC/USD as its top (grade A) candidate only to have the live buy path reject it as "not API tradable" for exactly this reason. Added a `_get_all()` helper that walks Robinhood's standard `next`-cursor pagination (bounded by a 50-page safety cap and a seen-page cycle guard) and switched all four calls to use it; verified offline against a mocked multi-page response (3 pages correctly aggregated, LTC recovered, single-page/no-`next` behavior unchanged, and a cycle-guard case that would otherwise loop forever) since this sandbox has no Robinhood API credentials for a live call. This is a bugfix only -- no grade, admission, liquidity, or risk rule changed; it only corrects how much of Robinhood's real tradable universe the autopilot could see.
- SEC EDGAR: official stock fundamentals and material filings.
- InsiderFinance and Stockcircle: delayed public congressional-disclosure collection when available.
- Capitol Trades and Barchart: disclosure reconciliation/reference unless authorized structured access exists.
- Quiver Quant and Unusual Whales: optional licensed APIs. They remain shadow-only until configured and independently validated.
- Yahoo Finance and Google Finance: secondary manual/reconciliation references, not authoritative execution feeds.
- TradingView: chart, technical, and alert visualization; it does not replace Teststock's Alpaca datafeed.
- Webull: optional authorized OpenAPI/broker reconciliation when credentials and a reviewed adapter exist.
- Finviz: screener/fundamental/liquidity reconciliation through permitted licensed access.
- Confirmed Robinhood fills: the only authority for real-money performance learning and any permitted performance-based scaling. `docs/data/real-trade-journal.json` is the single place this is recorded for stocks. Fixed 2026-08-23: no automated step had ever written an OPEN entry here at buy time (only the exit side, inside the "Teststock execution-check" scheduled Routine, was ever instructed to write here), so despite two live positions (RPRX since 2026-08-20, EQX since 2026-08-21) this journal stayed empty the whole time -- permanently blocking stocks from ever leaving `SHADOW_ONLY` no matter how well real trades did, the same cold-start deadlock crypto had before its own 2026-08-23 shadow-ledger fix. Backfilled both positions from live Robinhood data and updated the scheduled Routine so every future buy writes an OPEN entry immediately and every run reconciles any OPEN entry against live Robinhood data (independent of whether that run's own trigger-board shows an exit event). Both backfilled positions are fractional shares, so Robinhood cannot place a broker-resident stop on them -- `protectionMode` is honestly recorded as `SYNTHETIC` (GitHub/Claude-monitored), not `BROKER`; this was already true before the fix, just not previously visible anywhere.

Never bypass authentication, subscriptions, provider terms, robots restrictions, or rate limits. Never commit secrets, account identifiers, private quantities, or credentials. A missing provider must be marked unavailable/stale and must not silently authorize risk.

## Evidence and admission

- Deduplicate the same fact or disclosure across sources. Agreement increases data confidence, never the number of politicians, trades, or independent signals.
- All new/alternative sources begin with zero live ranking contribution.
- Backtests and historical sample/win-rate statistics are diagnostic only. They cannot create `MICRO_PROBATION`, live eligibility, or live size. Zero or unknown forward evidence is never a pass.
- Six actual independent positive outcomes are required for `MICRO_PROBATION` at no more than 25% of the already-bounded normal size. Twelve independent positive outcomes are required for half-size `PROBATION`; normal eligible size still requires sufficient positive confirmed Robinhood fills on their own, in a separate real-only tier. Duplicate same-day symbol/setup/regime observations count once using the most adverse result. `scripts/update-crypto-shadow-ledger.mjs` resolves each tracked crypto candidate against Crypto.com 4-hour candles (not daily bars) within a 30-bar/5-day window, matching the day-trade/short-swing horizon the setup was generated for -- a candidate whose entry zone is never reached in that window is marked `EXPIRED` rather than left `OPEN` indefinitely. This was fixed 2026-08-23 after 500+ tracked candidates produced zero resolved outcomes under the previous once-a-day/20-day resolution, which meant crypto could never earn evidence to leave `SHADOW_ONLY` regardless of setup quality. Stocks: `scripts/update-shadow-ledger.mjs` resolves each tracked candidate only when the stock's daily price actually revisits its recorded entry price within a 20-trading-day window, which is a genuinely slow, real cold start (as of 2026-08-24, 0 of 120 tracked candidates had been open long enough to resolve either way) -- not itself a bug, but worth remembering before assuming a stale-looking `SHADOW_ONLY` state means something is broken. Fixed 2026-08-26 (parity with the crypto `EXPIRED` fix from 2026-08-23, which this stock side had never received): a candidate whose entry zone is never revisited within that 20-trading-day window now resolves to `EXPIRED` instead of sitting `OPEN` forever with no terminal state. `EXPIRED` rows are excluded from the resolved-evidence pool exactly like `OPEN` rows always were -- this does not add evidence or accelerate admission, it only stops stale never-entered rows from silently accumulating. Fixed 2026-08-24 at the user's explicit direction ("real trade should also count toward shadow-equivalent evidence"): the MICRO_PROBATION/PROBATION 6/12-sample pool for stocks now also includes resolved real Robinhood-confirmed fills from `docs/data/real-trade-journal.json` (outcome WIN/LOSS/FLAT, finite `realizedR`), pooled with shadow-ledger outcomes under the same independence-dedup key, since a confirmed real fill is at least as strong evidence as a hypothetical shadow outcome. This does not loosen the 6/12 sample counts or the win-rate/average-R bars -- it only widens which resolved outcomes may fill that pool. The separate real-only `LIVE_ADMITTED`/`LIVE_SUSPENDED` tier (8/15 real samples) is unchanged and still requires real fills exclusively; crypto's admission ladder is unaffected by this stock-only change.
- Options require their own live real-fill evidence gate: at least 10 resolved option trades, average realized R >= 0.25, and win rate >= 50%, confirmed from actual Robinhood option order history. Passing every research/eliteOption check without this evidence still means no order -- expect this to keep options shadow-only for a while, by design.
- User-authorized crypto day-trade seed exception: while crypto admission is `SHADOW_ONLY`, one A/A+ candidate may trade through the official Robinhood Crypto API at no more than $5, with one position maximum, an eight-hour time exit and a pause after two stopped seed trades per UTC day. This bypasses only the shadow waiting period; it never applies to `LIVE_SUSPENDED` and never bypasses research, liquidity, spread, freshness, broker, buying-power, no-chase or immediate stop-protection gates.
- User-authorized stock seed lane, added 2026-08-26, expanded 2026-08-26 (`docs/data/probability-first-policy.json` `stocks.seedLane`): while every stock candidate is `SHADOW_ONLY`, `apply-profitability-admission.mjs` may flag up to `maxConcurrentPositions` (currently 5) distinct top-ranked entryTier A/ELITE candidates with no active red flag as `seedLane.eligible`, each at a fixed $5 order ceiling -- five concurrent slots at $5 total the same $25 maximum combined exposure as the original single-slot $25 design, just diversified across candidates instead of concentrated in one. At the user's explicit request, this no longer pauses after stopped trades: a ticker that closes a seed position on a `STOP` is excluded from re-selection for the rest of that UTC day so the pipeline rotates to the next distinct eligible candidate instead, and a fresh slot opens automatically once a position closes. `update-trigger-board.mjs`/`build-execution-dispatch.mjs` surface this separately as `SEED_LANE_BUY_TRIGGER`/`seedLaneCandidates` (an array, one entry per eligible ticker), entirely apart from the normal `BUY_TRIGGER`/`approvalCandidates` batch so seed sizing can never be blended with normal multi-stock sizing. Unlike the crypto seed exception, this one is **never** auto-submitted -- every single seed position still requires the user's own explicit per-order approval for that exact order, exactly like every other stock buy (see Entry and risk rules), and exit events still block all of them exactly like a normal buy. It bypasses only the `SHADOW_ONLY` wait; it never bypasses research, liquidity, spread, freshness, broker, buying-power, no-chase, correlation, market-regime, or protection gates, and it never touches the `MIN_SHADOW_MICRO`/`MIN_SHADOW` (6/12) sample thresholds or the win-rate/average-R bars that gate `MICRO_PROBATION`/`PROBATION` -- those are completely unchanged. A resulting real-trade-journal entry is marked `seedLane: true`; the execution-check must read that field live to recompute occupied slots (OPEN entries) and today's excluded tickers (`STOP`-closed today) before presenting any new seed-lane candidate, and must never exceed `maxConcurrentPositions` concurrently open seed positions.
- Require independent forward samples, positive cost-adjusted expectancy, regime coverage, drawdown/adverse-excursion review, and untouched holdout validation before bounded influence is considered.
- Backtests and shadow results may rerank, reduce, expire, suspend, or block. They cannot create live eligibility, raise maximum risk, loosen a gate, or increase live size.
- Unknown data is not a pass.

## Entry and risk rules

- Never use margin or leverage.
- Never average down, chase beyond the maximum entry, widen a stop, force a trade, or leave an unprotected position.
- Never raise account, trade, position, deployment, concentration, correlation, or loss limits.
- Preserve market-regime gates, liquidity/spread gates, profitability admission, portfolio correlation/heat guards, event-risk checks, freshness/decay, and broker verification.
- Every stock BUY requires the user's explicit approval for that exact order after live Robinhood verification. A trigger is not approval. This applies equally to every position in the stock seed lane above -- a `SEED_LANE_BUY_TRIGGER`/`seedLaneCandidates` entry is not approval either, no matter how small.
- Every option BUY requires the user's own separate explicit approval for that exact contract, expiry, strike and quantity, after live Robinhood whole-contract verification and independent confirmation of the real-fill evidence gate above. A trigger, an eliteOption research pass, or a prior stock approval is never option approval.
- Alpaca discovery never proves Robinhood executability. Before presenting approval and again before submission, confirm the exact stock is currently searchable, buyable and unrestricted in the signed-in Robinhood account and supports the planned order/protection. Failed verification rejects that candidate; use only an already-qualified fallback.
- For crypto, require the official Robinhood Crypto API trading-pair response to mark the exact pair tradable. Missing pair, quote or supported protection means no order.
- Before any new stock, option, or crypto entry, compute the remaining risk budget live from Robinhood account data only (`financialRiskGate`): equity, cash and buying power from a fresh Robinhood read this run, never external bank, checking, savings, credit-card, or other-brokerage data. A $0-or-missing-data result is a valid, expected outcome that forces no new trade in any asset class.

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
- `docs/data/broad-stock-universe.json`
- `docs/data/small-account-options.json`
- `docs/data/trigger-board.json`
- `docs/data/execution-dispatch.json`
- `docs/data/execution-watchlist.json`
- `docs/data/adaptive-performance.json`
- `docs/data/real-trade-journal.json`
- `docs/claude-autopilot.txt`
- `docs/claude-trigger-task.txt`

When this memory conflicts with a current hard validator or a more restrictive safety rule, follow the more restrictive rule.
