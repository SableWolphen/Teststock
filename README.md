# Teststock

A mobile-first stock + options opportunity scanner focused on small, defined-risk setups.

## What it does

- Ranks a liquid US-stock universe by recent momentum and trend quality.
- Searches the top-ranked names for call debit spreads roughly 35–90 days to expiration.
- Rejects trades that exceed the user's risk budget, have ugly spreads, excessive IV, or poor payoff.
- Shows one featured setup plus alternates instead of a giant raw-data table.
- Falls back to clearly labeled demo data if the live backend is not configured.

## Important

This is a screening tool, not a promise of profit. Options can lose 100% of the premium paid. The app deliberately favors defined-risk structures and rejects many high-leverage setups.

## Run locally

```bash
npm install
npm run dev
```

The frontend runs in Vite. The `/api/picks` route is designed for a serverless deployment such as Vercel.

## Live Alpaca data

Configure these environment variables on the server/deployment platform (never in client-side React):

```text
ALPACA_API_KEY=...
ALPACA_API_SECRET=...
```

The backend uses Alpaca's stock historical-bars endpoint plus option-chain snapshots. The free `indicative` options feed can be used by the scanner; a paid OPRA feed can be substituted if available.

## Current scoring model

Stock score combines:
- ~20-trading-day momentum
- ~60-trading-day momentum
- Price vs. 20-day trend
- Price vs. 50-day trend
- Distance from recent highs

Option candidate filters include:
- 35–90 DTE
- Long-call delta roughly 0.32–0.68 when Greeks are available
- Bid/ask spread cap
- IV cap
- Defined maximum loss
- Maximum loss under the user's chosen dollar budget
- Minimum reward-to-risk threshold

The model is intentionally conservative about presenting a trade: if an option chain fails the filters, the UI says to skip options rather than forcing a recommendation.
