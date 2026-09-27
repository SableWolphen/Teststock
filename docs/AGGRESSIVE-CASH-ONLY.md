# Aggressive Cash-Only Trading Contract

Teststock may pursue aggressive account growth, but **never by creating liability beyond the dedicated Robinhood Agentic account**.

## Hard invariants

1. Robinhood is authoritative for equity, cash/buying power, positions, open orders, fills, cancellations, and option positions.
2. Reconcile Robinhood immediately before every entry and exit decision. If Teststock state conflicts with Robinhood, broker state wins and new entries fail closed until reconciliation completes.
3. Never use margin, borrowed funds, deposits, bank transfers, naked/short options, short stock, exercise, or any undefined-risk structure.
4. Options are limited to cash-funded long calls/puts, buy-to-open and sell-to-close. Premium paid is the position-level maximum loss.
5. Aggregate worst-case loss of all open positions plus the proposed position may never exceed live dedicated-account equity or available non-margin buying power.
6. Never average down or widen a stop to rescue a losing trade.
7. No forced trades. Cash is valid when no setup passes the evidence, liquidity, freshness, execution-quality, protection, and broker gates.
8. A missing/stale broker read, ambiguous order state, duplicate order, or unverified protection capability blocks new entries.
9. Risk-reducing exits outrank new entries.
10. Every real fill and resolved shadow trade feeds the performance/admission evidence. Negative after-cost expectancy throttles or suspends the strategy; positive evidence may earn more allocation only within hard account caps.

## Aggression semantics

"Aggressive" means scanning broadly, reacting quickly to qualified opportunities, rotating capital after confirmed exits, and using the largest **permitted** size supported by current evidence and live risk capacity. It does not mean bypassing profitability admission, liquidity checks, account restrictions, or broker reconciliation.

Options remain evidence-gated. SHADOW_ONLY and LIVE_SUSPENDED cannot create live option risk. The system must earn MICRO_PROBATION/PROBATION/LIVE_ADMITTED through independent forward evidence before live option entries.

## Position reconciliation

Before considering any new option entry, compare Teststock's option ledger with Robinhood open option positions and orders. Any broker position absent from Teststock is an unreconciled exposure and blocks new option entries until recorded/managed. The same principle applies to stocks and pending orders.

## Objective

Optimize long-run, after-cost account growth while accepting that the dedicated account can lose money, including potentially all capital committed to defined-risk positions. Never intentionally create a loss obligation beyond the dedicated account's available capital.
