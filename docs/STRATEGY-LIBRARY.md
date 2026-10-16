# Teststock external-research strategy library

Original, independent strategy implementations in `scripts/strategy-library.mjs`; no vendor code copied.

Sources: QuantConnect algorithm research https://www.quantconnect.com/docs/v2/writing-algorithms ; TradingView Pine documentation https://www.tradingview.com/pine-script-docs/ ; Alpaca learning https://alpaca.markets/learn ; Options Industry Council https://www.optionseducation.org/ .

Five research concepts: opening range breakout, VWAP pullback, news momentum, mean reversion, liquid long options.

## Validation and operating rules
- Use actual timestamped OHLCV data, independently verified news timestamps, and bid/ask option quotes.
- Historical tests must avoid lookahead and survivorship bias and model spread, fees, slippage, order rejection, and fill uncertainty.
- Report net expectancy, sample size, maximum drawdown and out-of-sample performance; 30 trades is only a minimum filter, not proof of profitability.
- Do not convert research signals into broker orders. A separate verified broker adapter must reconcile existing orders and exits before admitting any new risk.
- No leverage, naked options, or profit guarantees. Never copy closed-source vendor scripts or performance claims as evidence.
