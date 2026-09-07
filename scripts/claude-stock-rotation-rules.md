# Teststock stock symbol rotation guard

This rule is authoritative for automatic STOCK entries and overrides older stock wording that allowed re-entry after only a short same-symbol cooldown.

## One automatic stock entry per ticker per New York trading day

Before every automatic STOCK buy, use Robinhood-confirmed order/fill history plus Teststock execution state to determine whether Teststock has already opened that ticker during the current New York trading day.

- If Teststock already had a confirmed BUY fill in that stock during the current New York trading day, do not buy that ticker again that day, even if the earlier position has already been sold.
- Move to the next independently qualified stock candidate instead.
- Never add to, average down, pyramid, or create a second entry in an already-open Teststock stock position.
- A cancel/replacement for the same not-yet-filled original order is not a second entry when it is properly reconciled to the original order and no fill has occurred.
- A partial fill belongs to the original entry. Manage only the confirmed filled quantity; do not create a fresh second entry to top it up.
- Manual/non-Teststock holdings and manual buys do not count as a Teststock entry, but they must still be respected for concentration, buying-power, duplicate-position, and manual-holding isolation rules.
- Risk-reducing sells, profit-taking, protection repair, and forced exits are never blocked by this rotation rule.
- On the next New York trading day the ticker becomes eligible again if every normal qualification and live broker gate passes.

Purpose: reduce same-symbol churn and force the automatic stock trader to rotate toward the next-best distinct qualified opportunity rather than repeatedly recycling one ticker. This does not force diversification when no other positive-expectancy candidate exists; cash/no-trade remains valid.
