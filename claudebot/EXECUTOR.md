# ClaudeBot hourly executor runbook

This is what the hourly scheduled Claude run does. It trades **real money** in the
Robinhood account nicknamed **MCP** (the only agent-enabled account). All trading
rules live in `claudebot/bot.py`; the run gathers facts, asks the planner, carries
out exactly the actions it returns, and records the results. Do not invent trades,
change sizes, or loosen rules. If anything is unclear or a tool errors twice, do
nothing new, log it, and stop. Doing nothing is always safe.

## 0. Get the repo
```
git clone https://github.com/SableWolphen/teststock /home/claude/teststock  (or git -C ... pull --rebase if present)
cd /home/claude/teststock
```
If git can't reach the repo, attach `SableWolphen/teststock` with push access first.

## 1. Gather live facts from Robinhood
Use the agent-enabled account from `get_accounts` (nickname MCP). Then:
- `get_portfolio` -> `accountValue` = total_value, `cryptoBuyingPower` = crypto_buying_power.buying_power
- `get_crypto_positions` -> `positions[CODE]` = quantity (only coins with quantity > 0)
- `get_crypto_orders` with `state_group: "open"` -> `openOrders` entries
  `{id, symbol (currency_code), side, type, stopPrice (stop_price), quantity}`
- `get_crypto_quotes` for: the ledger's open symbol (if any), `bestCandidate` from
  `docs/data/claudebot-signal.json` (if any), and every symbol in `positions`.
  `quotes[CODE] = {bid: bid_price, ask: ask_price}`

Write them to `/tmp/facts.json` with `now` = current UTC time (ISO, ending in Z).
Numbers as numbers.

## 2. Plan and act (loop up to 4 times)
```
python3 claudebot/bot.py plan /tmp/facts.json
```
Do every action in order:

| action | what to do |
|---|---|
| `none` / `wait` | nothing. `bot.py log --action hold --detail "<reason>"` |
| `need_quote` | fetch that quote, add it to facts, re-plan |
| `buy_market` | `preview_crypto_order` (buy, market, `dollar_amount`), then `place_crypto_order` with a fresh UUID `ref_id`. Poll `get_crypto_orders(order_id=...)` until filled (up to ~60s). Then `bot.py entry --symbol S --price <average_price> --dollars <filled notional> --account-value <accountValue> --atr <atr from action>`. If not filled within 60s, cancel it and log. |
| `place_stop` | `place_crypto_order` side sell, type `stop_loss`, `quantity` = given quantity (round **down** to the pair's increment), `stop_price` = stopPrice, `time_in_force: "gtc"`. Then `bot.py set-stop --price <stopPrice>`. If the stop price is rejected for tick size, round it down to the allowed increment and retry once. |
| `cancel` | `cancel_crypto_order` for that id (this is pre-authorized by the bot rules; no need to ask). Confirm it's canceled before any sell that follows. |
| `sell_market` | `place_crypto_order` sell, market, `quantity` (round down to increment). Poll until filled, then `bot.py exit --price <average_price> --reason "<reason>"`. |
| `record_stop_exit` | find the most recent filled sell for that symbol with `get_crypto_orders(symbol, side sell, state filled)`, then `bot.py exit --price <its average_price> --reason "stop"` (use fallbackPrice only if no fill is found). |

After any order, refresh the facts (step 1) and run `plan` again; stop when it
returns `none`/`wait`. Never place a buy when the ledger already has an open position.

## 3. Snapshot, save, push
```
python3 claudebot/bot.py snapshot /tmp/facts.json
git add docs/data/claudebot-ledger.json
git commit -m "ClaudeBot run <UTC time>: <what happened>"
git pull --rebase -X theirs origin main && git push origin HEAD:main
```
(If git push isn't possible, write the file with the GitHub connector instead.)

Never write account numbers, dollar balances, coin quantities or order IDs into
the repo. The ledger only holds prices and percentages.

## 4. Report
Only send a message when something happened (a buy, a sell, a stop moved, or an
error). One or two lines: what, price, why, and running % since start.
