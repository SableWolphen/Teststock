# Three-pillar research prototype

Research-only, independent implementation inspired by [Oft3r/agentic-trading-desk](https://github.com/Oft3r/agentic-trading-desk) (MIT license). No upstream code copied.

`scripts/three-pillar-research.mjs` computes EMA20/50/200, Wilder RSI14, MACD histogram, and a simple trend/momentum/macro score from supplied closing prices. It never fetches broker data, publishes execution dispatches, or places orders. It always emits `executionEligible:false` and `decision:WATCH`.

Input: `scoreResearch({symbol, closes, macroScore, asOf})`, with >=205 strictly positive historical closes. The caller must independently verify chronological order, adjustment, market-calendar validity, source provenance and freshness; a supplied timestamp is not proof of freshness. Missing macro context produces an incomplete score.

This is an isolated prototype, **not** integrated into the production signal or trigger pipeline. Do not use its scores to admit trades. Before any production research integration, compare against the existing signal pipeline, implement MACD/TRIX and regime validation as appropriate, perform walk-forward tests with slippage, and keep `scripts/safety-policy.mjs` unchanged.

Run: `node --test tests/three-pillar-research.test.mjs`.
