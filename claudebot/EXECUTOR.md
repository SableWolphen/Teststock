# ClaudeBot hourly executor runbook

This is what the hourly scheduled Claude run does. It trades **real money** in the
Robinhood account nicknamed **MCP** (the only agent-enabled account). All trading
rules live in `claudebot/bot.py`; the run gathers facts, asks the planner, carries
out exactly the actions it returns, and records the results. Do not invent trades,
change sizes, or loosen rules. If anything is unclear or a tool errors twice, do
nothing new, log it, and stop. Doing nothing is always safe.

## 0. Get the repo
```
git clone https://github.com/SableWolphen/Teststock /home/claude/teststock  (or git -C ... pull --rebase if present)
cd /home/claude/teststock
```
If git can't reach the repo, attach `SableWolphen/Teststock` with push access first.

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
# (run Part B below first, then:)
git add docs/data/claudebot-ledger.json docs/data/claudebot-options-ledger.json
git commit -m "ClaudeBot run <UTC time>: <what happened>"
git pull --rebase -X theirs origin main && git push origin HEAD:main
```
(If git push isn't possible, write the file with the GitHub connector instead.)

Never write account numbers, dollar balances, coin quantities or order IDs into
the repo. The ledger only holds prices and percentages.

## 4. Report
Only send a message when something happened (a buy, a sell, a stop moved, a paper
spread opened or closed, or an error). One or two lines: what, price, why, and running % since start.

---

# Part B: options (IWM put credit spreads), PAPER MODE

Runs in the same hourly session, after the crypto part and before the push.
`docs/data/claudebot-options-ledger.json` has `"mode": "paper"`: **place no option
orders**. Record what the bot would have done at the planner's pessimistic prices.

## B1. Facts -> /tmp/ofacts.json
- `get_equity_quotes(["IWM"])`: `underlying.price` = the more recent of last_trade_price /
  last_non_reg_trade_price. `marketOpen` = true only if it's a weekday, 8:30-15:00
  Central, and venue_last_trade_time is within the last 15 minutes. If the market is
  closed, write `{"now": ..., "marketOpen": false}`, run plan, and skip to B3.
- `underlying.sma20` = average of the last 20 daily closes from
  `get_equity_historicals(["IWM"], start_time = 40 days ago, interval "day")`.
- `expirations` = `get_option_chains("IWM").expiration_dates`.
- If the ledger has an open spread: `legs[<shortId>]` / `legs[<longId>]` = {bid, ask}
  from `get_option_quotes([shortId, longId])`.

## B2. Plan and record (loop up to 3 times)
`python3 claudebot/options_bot.py plan /tmp/ofacts.json`

| action | what to do |
|---|---|
| `none` | `options_bot.py log --action hold --detail "<reason>"` (skip the log when the reason is "market closed") |
| `need_contracts` | for each strike, `get_option_instruments(chain_symbol IWM, expiration_dates, type put, strike_price "<k>.0000")`, then one `get_option_quotes` for all found ids. Add each as `candidates[] = {id, strike, expiration, bid, ask, delta}` and re-plan. |
| `need_leg_quotes` | fetch them into `legs`, re-plan |
| `open_spread` | PAPER: `options_bot.py open --json '<the action JSON>'` |
| `close_spread` | PAPER: `options_bot.py close --debit <debit> --reason "<reason>"` |

## B3. Snapshot
`python3 claudebot/options_bot.py snapshot /tmp/ofacts.json`, then add
`docs/data/claudebot-options-ledger.json` to the same commit as the crypto ledger.

## Going live later (only when the user says so)
The user flips `"mode"` to `"live"` in the options ledger. Then `open_spread` =
`review_option_order` + `place_option_order` for account MCP with two legs (sell
shortId to open, buy longId to open), direction credit, limit `limitPrice`, quantity 1,
gfd; if it doesn't fill within ~5 minutes, cancel it and log. Record with the actual
fill price. `close_spread` = the same legs with position_effect close (buy short,
sell long), direction debit, limit = `debit` + 0.02.

Note: ClaudeBot is separate from the older Teststock execution contract in AGENTS.md.
That contract forbids spreads and overnight options for Teststock's own lanes. Holding
a defined-risk IWM put spread for several days is an exception the user must approve
explicitly before options go live; paper mode needs no approval.
