# Teststock Intelligence / OpenAI Execution Contract

Teststock is an intelligence and monitoring system only. GitHub gathers and analyzes Alpaca/provider market data, news/catalysts, historical/forward evidence, ranks candidates, monitors triggers, and publishes execution packets. GitHub/Teststock has zero independent brokerage authority and must never submit Robinhood orders.

OpenAI executor is the sole broker execution layer. OpenAI executor reads Teststock as decision support, independently reconciles live Robinhood account/position/order state, obeys every Robinhood tool review/confirmation requirement, submits permitted stock/option buys and sells, verifies fills, and reconciles resulting state. A Teststock packet is never itself a broker order or proof of execution.

## Operating mode

## Automated execution mode

Teststock/GitHub remains intelligence and monitoring only. The live broker executor is OpenAI through the connected Robinhood integration.

GitHub Actions is intelligence and monitoring only. It never invokes a live broker executor, requests OpenAI/Robinhood broker credentials, or submits orders. Live execution uses ChatGPT's connected Robinhood tools through the user-authorized Teststock Autopilot task or an active ChatGPT session. No GitHub API key or OAuth secret is required for that ChatGPT connection.

Scheduled ChatGPT execution is hourly. It does not provide continuous or five-minute broker monitoring. Scheduled entries must have supported broker-resident protection; synthetic-only protection cannot qualify under this schedule. A repository heartbeat proves intelligence monitoring only, never the availability or response time of the ChatGPT broker executor. Options must exit by the last scheduled check before the session cutoff; never rely on an unscheduled future wake.

The OpenAI executor must preserve one logical client-order id per order, claim before submit, never blindly retry an ambiguous submission, trust only confirmed fills, and keep exits/stops ahead of new entries. No margin, averaging down, wider stops, deposits, transfers, naked option selling, option exercise, or overnight Teststock options.


Teststock uses the repository-wide aggressive cash-only contract in `docs/AGGRESSIVE-CASH-ONLY.md`. Treat that contract as additive to every rule below. Aggressive execution may use the largest size already permitted by evidence and live risk capacity, but it never bypasses profitability admission, broker reconciliation, protection, liquidity, freshness, or cash-only limits.

Before every new entry, reconcile Robinhood positions and open orders against Teststock state. Robinhood remains authoritative. A broker position that exists in Robinhood but is missing from Teststock must be adopted into the managed position profile rather than treated as a global trading lock. Adopted positions immediately count toward cash, aggregate risk, correlation/concentration, duplicate-symbol/contract checks, exits, and protection. Ambiguous or conflicting open-order state blocks the conflicting action until reconciled; it does not automatically freeze unrelated entries.

## Sources of truth

Read current `main` only. Before any action, use the newest:
- `docs/data/execution-dispatch.json`
- `docs/data/trigger-board.json`
- `docs/data/execution-watchlist.json`
- `docs/signal.json`

Robinhood is authoritative for live buying power, positions, orders, fills, and cancellations. Never invent broker state.

## OpenAI executor-controlled execution

### Stocks
- Qualified Teststock stock entries are eligible for OpenAI executor execution under the user's standing authorization, but Teststock itself never places them. OpenAI executor must still obey any Robinhood tool-required review or confirmation.
- A high model score is not sufficient qualification. The current profitability-admission file must show `MICRO_PROBATION`, `PROBATION`, or `LIVE_ADMITTED`; `SHADOW_ONLY` cannot use a seed lane to bypass the evidence requirement.
- This includes normal A/B/C candidates and encoded stock seed-lane candidates when their current Teststock rules permit execution.
- Re-check every candidate immediately before submission: freshness, max entry (see bounded momentum entry below), buying power, account floor, portfolio heat, correlation, trade frequency, duplicate orders, sizing, and protection capability.
- Bounded momentum entry: a confirmed setup may be entered up to 1.5% above its technical trigger price if volume and momentum still confirm the move at the live re-check, using a tightened stop and reduced size to offset the smaller margin of safety. Skip the trade instead if price is already beyond that 1.5% band, if volume/momentum no longer confirm at re-check, or if a tightened stop and reduced size cannot both be established. This is a bounded allowance, not open-ended chasing.
- Skip any candidate that fails its live re-check. Never force portfolio capacity to be filled.


### Exits and protection
- Risk-reducing exits and validated profit-taking are handled by OpenAI executor for stocks/options when current policy permits them; Teststock only supplies the trigger/evidence packet.
- Stops/exits outrank new buys.
- After an entry fill, establish required protection immediately. If protection cannot be established, use the safest currently authorized risk-reducing action.

## Broker safety contract

- One fingerprint/client-order id may create at most one broker order.
- Claim the fingerprint before submission.
- Never blindly retry an ambiguous submission; reconcile the original order first.
- Never assume a fill. Use confirmed filled quantity and average price only.
- Partial fills use confirmed quantity only.
- No margin, leverage, averaging down, wider stops, or oversized positions. Chasing beyond the bounded momentum-entry allowance (up to 1.5% above the confirmed technical trigger for stocks or only while volume/momentum still confirm, with a tightened stop and reduced size) is never permitted.
- Fail closed on stale/conflicting generation data, unavailable broker access, unclear buying power, unsupported protection, or uncertain order state.

## Options

Options remain separate from stock automation. Stock/ETF options are evidence-gated. XND/DJX additionally support the explicit user-authorized `LIVE_MICRO_BOOTSTRAP` state; it permits real-money learning only under the dedicated $5/one-new-position-per-NY-day/one-concurrent-position caps and live Robinhood contract checks.

- `docs/data/small-account-options.json` is the research scan; `docs/data/options-shadow-trades.json` and `docs/data/options-profitability-admission.json` provide evidence before live capital is allowed.
- The live lane is now wired into `build-execution-dispatch.mjs` as `OPTION_SEED_LANE_BUY_TRIGGER`. It remains blocked while admission is `SHADOW_ONLY` or `LIVE_SUSPENDED`.
- When admission reaches `MICRO_PROBATION`, `PROBATION`, or `LIVE_ADMITTED`, the lane may automatically submit a whole long stock call/put contract that passes every live OpenAI executor/Robinhood check, within the current per-trade premium ceiling and aggregate cash/premium-risk limits. Existing broker options are adopted into the managed profile and counted against those limits instead of causing a mismatch-wide freeze. Duplicate exposure or insufficient remaining risk capacity still blocks that specific new entry.
- Options use existing dedicated Robinhood Agentic account funds only: no deposits, bank transfers, margin, naked selling, exercise, or overnight holding. A live loss resets the options lane until fresh positive independent shadow evidence is earned.
- The live option lane never promises profit. If the contract does not have sufficient positive evidence, liquidity, price/Greeks, or account capacity, OpenAI executor must return `NO_ACTION`. Reaching a probation tier in the admission file is evidence, not by itself a green light to submit an order — the dispatch wiring is the remaining gate.
- Long options do not need to be held to expiration. Profitable contracts may be sold-to-close early whenever the current option exit policy produces a validated profit-taking, trailing-profit, risk-reduction, or session-cutoff exit. Expiration is a maximum lifetime, not a profit target.
- Evaluate exits against an executable live bid, not midpoint or theoretical value. Never keep a profitable option open merely to wait for expiration when a validated exit has fired.
- Once an option's profit floor/trailing protection ratchets upward, it may never be loosened. Sell-to-close remains the only normal exit; do not exercise simply to realize a gain.
- Options shadow evidence is intraday and executable-price based: entry ask, exit bid, no midpoint fills. It requires at least 50 independent outcomes across 20 trading days and profit factor of at least 1.30 before micro probation. Profit floors may only move upward, and every position must be flat by the session cutoff.

### XND / DJX index options

- XND and DJX are a distinct index-options lane with their own files: `docs/data/index-options-research.json`, `docs/data/index-options-shadow-trades.json`, `docs/data/index-options-profitability-admission.json`, and `docs/data/index-options-real-trade-journal.json`.
- QQQ and DIA may provide research direction/regime context for XND and DJX respectively, but ETF option results never count as index-option evidence.
- Live XND/DJX risk is allowed in `LIVE_MICRO_BOOTSTRAP` under the explicit maximum $5 total premium, one new position per New York trading day, and one concurrent position caps; it remains forbidden in `SHADOW_ONLY` or `LIVE_SUSPENDED`. Stock-option admission never substitutes for index-option admission.
- Resolve the exact XND/DJX chain and contract through Robinhood immediately before any index-option action. Broker tradability, bid/ask, liquidity, DTE, premium and whole-contract affordability are mandatory.
- XND and DJX are encoded as cash-settled European-style products with no early assignment risk. XND is treated as PM-settled (`settleOnOpen=false`); DJX is treated as AM-settled (`settleOnOpen=true`). Teststock still closes every option the same session and never intentionally holds into settlement or expiration.
- Long call / long put only, buy to open / sell to close only. No spreads, naked selling, exercise, margin, deposits, transfers, or overnight holding.
- Potential Section 1256 60/40 treatment is informational only. Tax treatment may never create eligibility, increase size, or justify holding longer.
- Evidence-earned index-option micro probation still requires at least 50 independent exact-contract outcomes across 20 trading days with positive expectancy and profit factor >= 1.30. `LIVE_MICRO_BOOTSTRAP` does not satisfy or fake that evidence threshold.

## Broad historical market learning

Teststock also maintains `docs/data/web-market-history-learning.json`, built from broad provider-hosted US-equity history rather than only repository trade records.

- Historical market learning may supply priors, pattern context, and research ranking support.
- It must use time-ordered features/outcomes and avoid future-data leakage.
- Include inactive assets when provider coverage permits so historical research is less survivorship-biased.
- Historical priors cannot create live execution eligibility, increase hard risk ceilings, override profitability admission, or supersede Robinhood live state.
- Keep historical, forward/shadow, and Robinhood-confirmed real-fill evidence labeled separately. Promotion of strategy changes requires forward or real-fill confirmation, not backtest results alone.
- Treat provider coverage limits, corporate-action adjustments, symbol changes, and feed scope as explicit limitations rather than pretending the dataset is literally every stock observation ever recorded.

## Multi-source learning and strategy retirement

Use `docs/data/learning-consensus.json` as research context when fresh. It combines broad daily history, intraday history, exit validation, option shadow evidence, correlation evidence, and Robinhood-confirmed real-fill learning without treating them as equivalent evidence.

- Historical evidence may rank opportunities or reduce risk, but may never increase live risk by itself.
- Forward/shadow evidence is required before a historical hypothesis can graduate toward live use; confirmed Robinhood real fills remain the authority for full-size promotion.
- Persistent negative after-cost real-fill expectancy must throttle or suspend the affected setup instead of continuing it merely because older backtests were positive.
- Learn rejected/no-trade outcomes as opportunity-cost evidence where outcome data exists; do not relabel a rejected setup as a real trade.
- Prefer capital rotation after confirmed exits, but never create a new entry solely to keep cash deployed.
- Portfolio correlation, sector concentration, live spreads/slippage, catalyst/event risk, and market regime remain execution-time constraints.
- Optimize exits as well as entries. Profit-taking, trailing protection, time exits, VWAP/momentum failure, and session cutoff may be compared using historical evidence, but live risk-increasing changes require forward confirmation.
- Options learning is contract-specific: DTE, delta, IV, spread, theta/gamma exposure, time of day, underlying regime, executable entry ask, and executable exit bid must remain separate from stock-only evidence.

## Idle behavior

If there is no actionable stock dispatch and no protection-repair condition, stop without broker calls or broad market research.
