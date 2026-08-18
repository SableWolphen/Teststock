# Teststock

A mobile-first stock + options decision engine for finding small, defined-risk opportunities without forcing a trade every day.

## The experience

The home screen answers one question first: **what should I do today?**

It returns one of:
- **TRADE CANDIDATE** — the stock, entry trigger, invalidation, targets, and a defined-risk option passed the filters.
- **WATCH** — the underlying may be good, but timing/options are not good enough yet.
- **WAIT** — keep cash; market regime, catalyst risk, trend quality, or option pricing failed the protection rules.

## Decision engine

### Market regime
- SPY + QQQ trend scoring
- Risk-on / mixed / risk-off gate
- Aggressive bullish ideas are penalized or blocked in hostile market conditions

### Stock scoring
- ~20-day momentum
- ~60-day momentum
- 20/50/200-day trend
- RSI
- ATR and realized volatility
- Distance from recent highs
- Automatic entry trigger, invalidation, and two target levels

### Catalyst check
- Recent Alpaca news scan
- Flags earnings/guidance, FDA/trial, investigations, offerings, M&A, upgrades/downgrades and similar event risk
- Positive-catalyst keywords can modestly improve a setup, while event risk is penalized

### Options engine
- Defaults to roughly 28–75 DTE in Aggressive mode and 42–105 DTE in Balanced mode
- Evaluates delta, theta, IV, bid/ask width, break-even and payoff
- Prefers defined-risk call debit spreads
- Hard maximum-loss budget
- Rejects wide spreads, extreme IV, weak payoff, poor liquidity proxies and over-budget structures
- No 0DTE / ultra-short default trades

## Paper Lab

Qualified setups can be saved locally as paper trades. The app tracks:
- number of setups
- closed setups
- win rate
- average result

This is intentionally simple at first so the scanner can be judged on outcomes before real-money automation is considered.

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
```

The app uses Alpaca historical stock bars, option-chain snapshots and news. The option scanner currently requests the free `indicative` feed; switch to OPRA when the account has the required subscription and you want official real-time options data.

## Build safety

GitHub Actions runs `npm install` and `npm run build` on pushes and pull requests.

## Important

Teststock is a screening and paper-tracking tool, not a guarantee of profit. Options can lose the entire amount at risk. The design deliberately allows **no trade** to be the best result.
