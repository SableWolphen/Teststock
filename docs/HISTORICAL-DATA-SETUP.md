# Historical strategy evaluation
Run `node scripts/strategy-backtester.mjs path/to/bars.json`.

Input is a chronological JSON array of timestamped OHLCV bars with `time` (ISO timestamp), `open`, `high`, `low`, `close`, `volume`, `vwap`, and optional `newsCatalyst` boolean. This is a research backtester, not a broker execution system. It evaluates signals on previously completed bars and fills hypothetically at the next bar open with configurable slippage and costs. Walk-forward uses the earliest 70% for development and the latest 30% for out-of-sample testing. No market data, vendor credentials, or historical profitability are bundled. Do not interpret positive historical returns as a promise of future profits.

Limitations: no corporate-action adjustments, intraday session segmentation, short sales, option Greeks, partial fills, or realistic news feed latency; intrabar stop assumptions remain simplified. Do not use as the sole basis for live orders.
