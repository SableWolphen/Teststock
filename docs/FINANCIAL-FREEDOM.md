# Financial Freedom planner

The React app and GitHub Pages desk share `freedom-dashboard.mjs` and `freedom-model.mjs`. The app replaces its former $100M screen; Pages exposes `financial-freedom.html` from the overview and research navigation. No provider key or brokerage session is needed to use the planner.

The default is $10,000/month in today's dollars, 24 months, $76.21 example capital, no contributions, 5% hypothetical net nominal effective annual return, 4% annual withdrawal assumption and 2.5% inflation. The capital example comes from the former app default, not a verified current account. Inputs persist under `teststock-freedom-v1` in this browser only; reset restores the example. They have no path to execution, budgets, evidence admission or broker tools.

## Arithmetic and interpretation

- Today's required capital = monthly spending × 12 / annual withdrawal rate. At 4%, $10,000/month implies $3 million before personal taxes.
- Deadline spending = today's spending × (1 + inflation)^(months/12). Required capital at the deadline uses that spending.
- Monthly investment return = (1 + annual return)^(1/12) − 1. End-of-month contributions compound for their remaining months. The zero-return branch uses capital + contribution × months.
- Required monthly contribution solves the same annuity formula for the selected deadline, floored at zero. It is total monthly savings needed, not an extra contribution on top of the entered amount.
- Monthly withdrawal capacity = modeled balance × annual withdrawal rate / 12. It describes portfolio withdrawals, not guaranteed yield, dividends or trading income.
- Zero-return runway divides the modeled balance by deadline monthly spending, rounded down to full months. This separate depletion illustration assumes no future growth, contributions or spending inflation.
- Alternative −20%, 0%, 4% and 7% annual scenarios show both 12 and 24 months. These are hypothetical smooth paths, not forecasts, probability estimates or a worst-case bound.

The example projects $84.02 at 24 months, compared with $3,151,875 needed under its inflation/withdrawal assumptions. With $500/month it projects $12,663.41. These numbers expose the funding gap; they cannot justify increased trading risk. Withdrawal rate, inflation, fees, taxes, longevity and the sequence of future returns can materially change sustainability. A selected withdrawal rate is not certified safe.

## Trading evidence

The dashboard fetches the existing published real-trade journal. It reports reconciliation time, stale/future timestamps, uniquely identified broker-reconciled records, closes, outcome classification and dollar-P&L coverage. Duplicate journal IDs, paper/unreconciled rows and synthetic replay data are excluded. A partial known subset is labeled as such; aggregate P&L stays unknown unless every closed record has a classified outcome and finite dollar P&L. Null is never converted to zero. The public journal lacks complete quantities and costs and cannot establish total account returns, net income or monthly profitability. No journal result is extrapolated into projections.

Live execution remains disabled in `scripts/safety-policy.mjs`. The option request UI also checks that canonical lock. The Windows reader remains read-only; tests and a monitor heartbeat do not establish broker execution, protection or alert delivery.

## Validation

Run `npm ci`, `npm test`, `npm run build` and `npm run build -- --mode github-pages`. Model tests exercise withdrawal math, inflation, effective compounding, end-of-month contributions, zero/negative returns, required savings, invalid inputs, milestones and incomplete/duplicate journal evidence. Browser checks cover recalculation, persisted inputs, invalid empty input and reset. Operational verification of scheduled tasks, credential expiry, real outages and user alert receipt remains separate.
