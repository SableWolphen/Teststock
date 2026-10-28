# Option stop ladder (two stops)

User-authorized 2026-10-27. Applies to every open **long option** in the MCP Robinhood account. The executor runs this at every in-hours check-in (8:30 AM–3:00 PM CT), after its normal dispatch work.

Options aren't tracked in `execution-watchlist.json` (STOCK | CRYPTO only), so this file is the source of truth for option exits.

## 1. Gather (every run, no memory)
- `get_option_positions` with `nonzero=true`.
- For each long option: cost per contract (`average_price / 100`), live quote, and the **highest price since entry** = max `high` from `get_option_historicals` since `opened_at`. Recompute the high every run.

## 2. Active stop — only ever moves up
| Condition | Active stop |
|---|---|
| Always (loss limit) | cost × 0.72 (≈ −28%) |
| High since entry ≥ cost × 1.20 | cost × 1.08 (small win locked after fees) |
| High since entry ≥ cost × 1.35 | cost × 1.20 |
| Above that | 85% of the high since entry |

Use the highest level that applies. Never lower a stop.

**Profit target:** sell to close when bid ≥ cost × 1.40.
**Time exit:** sell to close within 5 trading days of expiration.

### Current position
BB $10 call, exp 2026-11-20, cost $0.39:
floor $0.28 · lock $0.42 once high ≥ $0.47 · lock $0.47 once high ≥ $0.53 · target $0.55 · time exit on/after 2026-11-13.

## 3. One resting order per contract
Robinhood allows only one sell order against a 1-contract position, so keep exactly **one** live protective order:
- A `stop_market` sell-to-close, GFD, `regular_hours`, at the active stop.
- Option stop orders expire daily, so place it at the first in-hours check-in each day.
- If an open sell order on that contract is at a different level or type (including the GTC $0.55 limit, order `6ae14dc9-497f-45f2-8e1d-00937cdc8b9f`), cancel it and replace it with the stop at the active level.
- Never have two open sell orders on the same contract.
- If the stop is rejected because it isn't below the ask, the level is already breached: sell to close with a limit at the bid.

## 4. Exit now when
Bid ≥ profit target, **or** bid ≤ active stop, **or** time exit applies → cancel any open sell order on the contract and sell to close with a limit at the bid. Message the user with fill price and P&L.

## 5. Messaging
Message the user when a stop is raised (e.g. "BB call stop raised to $0.42 — a win is now locked in") or an exit fills. Otherwise stay quiet.
