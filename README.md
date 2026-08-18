# Teststock

A mobile-first stock + options decision engine for finding small, defined-risk opportunities without forcing a trade every day.

## The experience

The home screen answers one question first: **what should I do today?**

It returns one of:
- **TRADE CANDIDATE** — the stock, direction, entry trigger, invalidation, targets, and a qualified option structure passed the filters.
- **WATCH** — the underlying may be good, but timing/options are not good enough yet.
- **WAIT** — keep cash; market regime, catalyst risk, trend quality, historical validation, or option pricing failed the protection rules.

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

### Historical signal validation
For each top-ranked stock, Teststock looks back through recent daily history for similar directional stock signals and reports:
- historical sample count
- percentage of samples that moved in the expected direction over the next ~20 trading days
- average directional move

This is validation of the **underlying stock signal**, not a historical options-P&L guarantee.

### Catalyst check
- Recent Alpaca news is fetched in one batched request for the top candidates
- Flags earnings/guidance, FDA/trial, investigations, offerings, M&A, bankruptcy/recall and similar event-risk language
- Positive-catalyst keywords can modestly improve a setup, while event risk is penalized

### Options engine
- Aggressive mode searches roughly 28–90 DTE; Balanced mode roughly 42–120 DTE
- Scans both calls and puts based on the underlying direction
- Compares long calls/puts with defined-risk debit spreads
- Evaluates delta, theta, gamma, IV, bid/ask width, break-even, expected move and payoff
- Calculates a model-based probability of finishing beyond breakeven; this is an approximation, not a guarantee
- Hard maximum-loss budget
- Rejects wide spreads, extreme IV, weak payoff, bad breakeven-to-expected-move relationships and over-budget structures
- Paginates the option chain instead of assuming the first page contains the best contract
- Scans the strongest candidates in parallel to reduce serverless latency
- No 0DTE / ultra-short default trades

## Data quality

The UI tells you which options feed is being used.

Alpaca supports:
- `indicative` — free indicative options data; trades are delayed and quotes are modified
- `opra` — official consolidated OPRA options data when your Alpaca subscription supports it

Set the server environment variable below to opt into OPRA:

```text
ALPACA_OPTIONS_FEED=opra
```

If it is omitted, Teststock defaults to `indicative`.

## Paper Lab

Qualified setups can be saved locally as paper trades. The app tracks:
- number of setups
- closed setups
- win rate
- average result
- direction and exact option structure

The purpose is to build evidence before increasing real-money risk.

## Road to $1M

The wealth tab stores:
- current investable amount
- monthly contribution
- $1M goal
- perfect-doubling math
- timeline scenarios at several annualized return assumptions

It does **not** promise that a small account can reliably become $1M quickly. The purpose is to keep the goal visible while protecting the compounding engine from account-ending trades.

## Run locally

```bash
npm install
npm run dev
```

## Deploy

The project is designed for Vercel because the frontend is Vite and `/api/picks.js` is a serverless function. `vercel.json` gives the scanner additional execution time for market-data requests.

Set these environment variables on the server/deployment platform — never in client-side code:

```text
ALPACA_API_KEY=...
ALPACA_API_SECRET=...
ALPACA_OPTIONS_FEED=indicative
```

Change the last value to `opra` if your Alpaca market-data subscription includes OPRA.

## Build safety

GitHub Actions runs `npm install` and `npm run build` on pushes and pull requests.

## Important

Teststock is a screening and paper-tracking tool, not a guarantee of profit. Options can lose the entire amount at risk. Probability estimates and historical signal hit rates can be wrong and can change. The design deliberately allows **no trade** to be the best result.
