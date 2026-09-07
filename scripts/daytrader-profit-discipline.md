# Teststock intraday profit discipline

These rules refine execution quality. They may only reduce, delay, reorder, or exit risk. They never create eligibility, increase an existing risk ceiling, bypass Robinhood checks, or guarantee profit.

## Core objective

Optimize for positive realized expectancy after spread, slippage, and failed fills — not trade count, time-in-market, or being continuously invested. Cash is a valid position.

## Time-of-day routing for stocks

Use authoritative New York time from broker/session context.

- `OPEN_DRIVE` = 09:30–10:30 ET. This is the primary stock opportunity window. Prefer fresh opening-range breakouts, VWAP reclaim/hold, strong relative volume, clean catalyst-backed momentum, and clear SPY/QQQ relative strength. Do not chase vertical extensions beyond the encoded maximum entry.
- `MIDDAY` = 10:30–15:00 ET. Treat this as a lower-quality window by default. New stock entries require materially stronger evidence than during the opening hour: fresh positive cost-adjusted edge, clear VWAP structure, relative strength, acceptable spread, and relVol >= 1.1 when available. Mixed/choppy setups should wait. Existing positions may still be managed or exited normally.
- `POWER_HOUR` = 15:00 ET until the stock entry cutoff. Prefer continuation/reclaim setups with fresh volume expansion and clear relative strength. Never relax the same-session flattening rule or entry cutoff.

If the session is an early close, derive these phases relative to the actual broker session and preserve the existing no-new-entry cutoff and forced-exit window.

## Setup quality

For automatic stock entries, prefer in this order when all upstream eligibility is equal:
1. catalyst-backed opening-range breakout with strong relative volume and positive relative strength;
2. VWAP reclaim / momentum continuation with increasing 1m and 5m momentum;
3. clean trend continuation above VWAP with positive cost-adjusted edge;
4. mixed setups only when real-fill evidence for that setup/time bucket is positive and live execution quality remains favorable.

Reject or delay new risk when any of these are true:
- weak or falling relative volume;
- widening spread or expected slippage erases positive edge;
- price is extended beyond the encoded no-chase entry;
- stock is moving only because SPY/QQQ is moving and has no relative strength;
- binary/event risk is elevated or data is contradictory;
- market regime is weak/choppy and the stock does not show exceptional relative strength;
- the setup is a repeat of a losing real-fill pattern that is currently suspended or negative expectancy.

## Distinct-symbol rotation

For stocks, preserve the hard one-entry-per-ticker-per-New-York-trading-day rule. After a Teststock stock exits, prefer the next qualified different ticker rather than recycling the same symbol. Never force a replacement trade merely to maintain activity.

## Winner and loser management

- Stops and invalidations outrank entries.
- Never widen a stop, average down, or convert an intraday loser into an overnight position.
- If a trade reaches meaningful unrealized profit and then loses short-horizon momentum, protect the gain using the existing validated stop/target policy rather than waiting mechanically for a distant target.
- A stalled stock that fails to progress after the existing soft-review window should be reassessed against VWAP, relative volume, relative strength, spread, and catalyst persistence. Exit when the original short-horizon thesis is no longer intact.
- After any broker-confirmed exit, recompute cash, buying power, stop risk, heat, correlation, open orders, cooldowns, distinct-symbol eligibility, and broker restrictions before considering another trade.

## Learning discipline

Only Robinhood-confirmed fills and exits count as live evidence. Track results by setup type and time-of-day bucket. A time/setup bucket with negative reconciled expectancy may reduce size or block new risk; a positive bucket may reorder already-qualified trades but may not increase the hard risk ceiling.

Do not promote a rule because of a small winning streak. Prefer forward or out-of-sample evidence and enough real fills to avoid overfitting.
