# Teststock

A mobile-first stock + options decision engine for finding small, defined-risk opportunities without forcing a trade every day.

## The experience

The home screen answers one question first: **what should I do today?**

It returns one of:
- **TRADE CANDIDATE** â€” the stock, direction, entry trigger, invalidation, targets, and a qualified option structure passed the filters.
- **WATCH** â€” the underlying may be good, but timing/options or learning confirmations are not good enough yet.
- **WAIT** â€” keep cash; market regime, catalyst risk, trend quality, historical calibration, sector/intraday confirmation, or option pricing failed the protection rules.

## Decision engine

### Market regime
- SPY + QQQ trend scoring
- Risk-on / mixed / risk-off gate
- Bullish and bearish bias detection
- Directional trades are penalized when they conflict with the broad market

### Stock scoring
- ~20-day momentum
- ~60-day momentum
- 20/50/200-day trend
- RSI
- ATR and realized volatility
- Distance from recent highs and lows
- Bullish vs bearish score comparison
- Automatic entry trigger, invalidation, and two target levels

### Historical learning engine
The free GitHub Actions scan also loads roughly the last 1,000 calendar days of daily history and builds a walk-forward-like calibration of the same underlying signal family.

For the stock universe it:
- samples historical setups every ~10 trading days to reduce duplicated observations
- evaluates the next ~20 trading days without looking forward when forming the historical setup
- groups outcomes by bullish/bearish direction and score band
- reports sample count, directional win rate, average forward move and median forward move
- uses the matching historical score band as an additional confirmation/penalty for the current setup

This is an **underlying-signal calibration**, not a reconstruction of historical option fills or an options P/L backtest.

### Market breadth
The GitHub scan measures the percentage of the stock universe above its 20-, 50- and 200-day averages plus the percentage currently producing bullish signals. A directional setup receives an additional confirmation or penalty based on whether broad participation agrees with it.

### Sector confirmation
Each candidate is checked against a free sector/industry proxy such as SMH, XLK, XLF, XLE, XLV, XLY, XLC, XLP, XLI or XLU. A candidate is penalized when the relevant group is moving the other way.

### Intraday confirmation
The scheduled scan also downloads recent 15-minute IEX bars and checks:
- session VWAP
- opening-range high / low
- current 15-minute direction

A trade candidate can be downgraded to WATCH when the daily setup has not confirmed intraday.

### Historical signal validation
The core API still runs per-symbol historical validation and reports:
- historical sample count
- percentage of samples that moved in the expected direction over the next ~20 trading days
- average directional move

### Catalyst check
- Recent Alpaca news is fetched in one batched request for the top candidates
- Flags earnings/guidance, FDA/trial, investigations, offerings, M&A, bankruptcy/recall and similar event-risk language
- Positive-catalyst keywords can modestly improve a setup, while event risk is penalized

### Options engine
- Aggressive mode searches roughly 28â€“90 DTE; Balanced mode roughly 42â€“120 DTE
- Scans both calls and puts based on the underlying direction
- Compares long calls/puts with defined-risk debit spreads
- Evaluates delta, theta, gamma, IV, bid/ask width, break-even, expected move and payoff
- Calculates a model-based probability of finishing beyond breakeven; this is an approximation, not a guarantee
- Hard maximum-loss budget
- Rejects wide spreads, extreme IV, weak payoff, bad breakeven-to-expected-move relationships and over-budget structures
- Paginates the option chain instead of assuming the first page contains the best contract
- Scans the strongest candidates in parallel to reduce serverless latency
- No 0DTE / ultra-short default trades

## Learning score / elite gate
The free static scan adds a second score on top of the core setup score. It considers:
- sector confirmation
- 15-minute confirmation
- market breadth alignment
- matching historical calibration win rate

A core TRADE CANDIDATE is downgraded to WATCH if too few independent learning confirmations agree. Very weak historical calibration can force WAIT.

## Automatic past-pick tracking
When a generated result remains a TRADE CANDIDATE after the learning gates, Teststock stores it in `docs/data/trade-history.json`.

Later scheduled runs check the underlying daily bars and classify the setup as:
- `TARGET1`
- `TARGET2`
- `STOP`
- `MATURED_WIN`
- `MATURED_LOSS`
- `AMBIGUOUS` when the daily bar makes target/stop ordering unknowable

The webpage displays tracked count, resolved count, win rate, stops and recent picks. This measures the underlying trade thesis rather than exact historical option P/L.

## Free scheduled scanner
`.github/workflows/static-scan.yml` runs on a weekday schedule and can also be triggered manually. It uses GitHub Actions plus Alpaca's free data path to write:
- `docs/data/latest-50.json`
- `docs/data/latest-100.json`
- `docs/data/latest-200.json`
- `docs/data/latest-500.json`
- `docs/data/learning.json`
- `docs/data/trade-history.json`
- `docs/data/manifest.json`

The website reads those static files, so no paid server is required for the GitHub Pages version.

## Data quality

The free configuration uses:
- Alpaca IEX stock bars
- Alpaca `indicative` options data
- Alpaca News
- GitHub Actions for scheduled computation
- GitHub Pages for hosting

The core API also supports `opra` if a future Alpaca subscription provides it, but OPRA is not required for the free GitHub build.

## GitHub secrets
The scheduled scanner requires these repository Actions secrets:

```text
ALPACA_API_KEY=...
ALPACA_API_SECRET=...
```

The workflow explicitly uses the free indicative options feed. Never place those secrets in `docs/`, frontend JavaScript, or any committed file.

## Run locally

```bash
npm install
npm run dev
```

## Important

Teststock is a screening, historical-calibration and paper/outcome-tracking tool, not a guarantee of profit. Options can lose the entire amount at risk. Probability estimates, historical hit rates and historical calibration can be wrong, can be affected by survivorship/selection bias, and can change. The design deliberately allows **no trade** to be the best result.

## Claude execution safety and credit use

The trigger monitor publishes a compact execution packet. Invoke Claude only when both `claudeShouldRun` and `pendingAction.isActionable` are true. Unchanged fingerprints, stale boards, expired entries and idle scans are suppressed.

Before any broker submission, the execution runtime must atomically claim `pendingAction.fingerprint` in private state. One fingerprint may create at most one broker order. Ambiguous and partial submissions must be reconciled by client order ID and current broker state rather than retried as new orders. Routine price and order-status polling belongs in deterministic code, not an LLM session.

When multiple fresh buy triggers qualify, the execution packet ranks them once and sends them to a single Claude run. If the first candidate fails a live broker or portfolio guard before submission, Claude may evaluate the next fallback. It must stop after one submitted buy and hold cash when every candidate fails. Stops and other position-protection events exclude all new buys until they are resolved.
