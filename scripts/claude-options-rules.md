# Teststock automatic stock-options lane

This lane is explicitly authorized for automatic execution only through Claude + Robinhood Trading MCP. It is a separate risk lane from the stock day-trading lane.

## Objective

Seek positive risk-adjusted intraday opportunities in listed stock/ETF options when the underlying stock itself is already qualified by Teststock. Never represent any trade as guaranteed to make money. If the evidence is not strong enough after live option-chain checks, do nothing.

## Allowed strategy

- LONG CALL only when the underlying thesis is bullish.
- LONG PUT only when the underlying thesis is bearish.
- BUY TO OPEN only.
- SELL TO CLOSE only.
- No naked option selling.
- No cash-secured puts.
- No covered calls.
- No credit spreads.
- No debit spreads initially.
- No straddles/strangles.
- No ratio trades.
- No exercise as a trading strategy.
- Never allow an option position to create a stock or short-stock position.

A long call/put has a theoretical maximum loss equal to the premium paid, but Robinhood notes that exercise can create 100-share stock exposure. Therefore Teststock must close every option position before expiration and never intentionally exercise it. citeturn0search2turn1search3

## Account-funded hard limits

The account itself is the only funding source.

Before every option entry, Claude must verify through Robinhood:
- current total account equity;
- available buying power;
- settled/available cash rules;
- existing Teststock stock and option exposure;
- open orders;
- current day realized/unrealized P&L when available;
- account floor and daily-loss circuit breaker.

Hard rules:
- No deposits.
- No bank transfers.
- No margin borrowing or leverage.
- Never spend more premium than current available account buying power.
- Never allow an option order to make available cash/buying power negative.
- Maximum premium at risk on one new option position: 5% of current account equity.
- Maximum aggregate open option premium at risk: 15% of current account equity.
- Maximum new option premium exposure in one New York trading day: 10% of current account equity.
- If the account is too small to buy a contract inside these limits, skip it.
- A partial fill counts only by broker-confirmed quantity and premium.
- Cancel/replace never creates a second independent option position.

These are maximum risk ceilings, not targets. A smaller position is required whenever liquidity, spread, correlation, daily loss, stock exposure, or broker restrictions require it.

## Contract selection

Only consider contracts that Claude can verify from the live Robinhood option chain immediately before entry:
- liquid underlying stock/ETF;
- tight bid/ask spread;
- sufficient option volume/open interest;
- expiration normally 14–45 calendar days away;
- never 0DTE or 1DTE;
- no entry when expiration is within 5 trading days;
- generally prefer delta about 0.55–0.80;
- avoid extremely far OTM contracts;
- verify implied volatility, IV rank/percentile when available, theta, delta, gamma and vega;
- verify the contract's premium and break-even;
- verify the option can realistically be closed at the planned exit price;
- avoid contracts with abnormal spreads, stale quotes, halts, corporate-action complications or missing Greeks.

The option is an implementation of an already-qualified stock thesis, not a way to manufacture a trade when no stock setup exists.

## Profit and loss behavior

Teststock is a day trader here:
- enter only during the authoritative regular NYSE session;
- close the option during the same trading session;
- do not carry an option overnight;
- do not hold through expiration;
- do not exercise;
- do not convert an option loss into stock ownership;
- take profit when the option reaches the validated profit objective or the underlying thesis/momentum weakens;
- reduce risk immediately when the underlying invalidates;
- never widen a stop;
- never average down;
- never chase the option above the maximum acceptable premium.

For a long option, the paid premium is the hard worst-case loss if the contract is simply held to expiration, but Teststock should normally exit much earlier. Robinhood states that options can lose the entire premium and that option values are affected by the underlying price, time decay and implied volatility. citeturn0search2turn0search4

## Entry quality

Claude must require all of the following:
1. The underlying stock is independently qualified by Teststock.
2. Current stock price and intraday edge remain fresh.
3. The option-chain quote is fresh.
4. The option has acceptable liquidity/spread.
5. The option's delta/time-to-expiration fit the thesis.
6. The expected option move remains positive after bid/ask spread and estimated slippage.
7. The maximum premium risk fits the account limits.
8. The option position will not create excessive correlation or concentration with existing stock positions.
9. The option can be exited without exercise.
10. The live Robinhood recheck passes immediately before submission.

If the stock is qualified but no option contract passes, trade the stock only if the normal stock lane still qualifies. Do not force an option trade.

## Execution

Claude is the only execution agent. GitHub never places option orders.

Before BUY TO OPEN:
- re-read the current dispatch/signal generation;
- fetch current Robinhood account/portfolio state;
- fetch the live option chain;
- re-check contract quote, spread, Greeks, DTE, premium, buying power and duplicate state;
- calculate maximum premium risk;
- submit only the exact contract and quantity that fits the current account state.

After fill:
- reconcile the broker order/fill;
- record the confirmed contract quantity and premium;
- establish the exit/protection plan;
- never assume a fill;
- never blind-retry an ambiguous submission.

For SELL TO CLOSE:
- confirm the exact Teststock-attributable contract quantity;
- prefer the fastest risk-appropriate supported exit;
- reconcile the original order if ambiguous;
- never exercise.

## No-profit guarantee

A high-confidence model can still lose money. The lane should maximize decision quality and strictly cap losses, not pretend that a model can know which option will make money in advance. Cash/no-trade is always valid.
