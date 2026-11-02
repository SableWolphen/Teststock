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
# (run Parts B, C and D below first, then:)
git add docs/data/claudebot-ledger.json docs/data/claudebot-options-ledger.json docs/data/claudebot-paper-ledger.json docs/data/claudebot-audit.json
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

# Part B: options (put credit spreads), LIVE

`docs/data/claudebot-options-ledger.json` `"mode"` decides: `"live"` = real orders in
account MCP (user-approved 2026-11-02, including holding a defined-risk spread for
several days); `"paper"` = record only, place nothing. Tickers and rules live in
`claudebot/options_config.json` (`underlyings`, in priority order).

## B1. Facts -> /tmp/ofacts.json
- `now` (UTC, Z). `marketOpen` = weekday, 8:30-15:00 Central, and the SPY quote's
  venue_last_trade_time is within 15 minutes. If closed: write `{"now":..., "marketOpen": false}`,
  run plan (it returns none), skip to B3.
- `accountValue` = get_portfolio total_value, `buyingPower` = buying_power.buying_power.
- Reconcile: `get_option_positions(nonzero=true)` and open `get_option_orders` (state queued/confirmed).
  - `spreadOnBroker` = true if both the ledger spread's legs are held (short shortId, long longId), false if neither is.
  - `tpOrder` = `{id, price}` of an open debit order that closes exactly those two legs, else null.
  - If Robinhood holds option positions or open option orders the ledger doesn't explain (anything else, or only one
    leg), do NOT trade: log an error and stop Part B.
- `underlyings[SYM]` for the open spread's ticker, or (when flat) for each ticker the planner
  asks for via `need_underlying`: `price` from get_equity_quotes (most recent of
  last_trade_price / last_non_reg_trade_price), `closes` = last 21 daily closes from
  `get_equity_historicals([SYM], start_time = 40 days ago, interval "day")`,
  `expirations` = get_option_chains(SYM).expiration_dates. (You can fetch all tickers
  in `underlyings` up front in one go.)
- Open spread: `legs[shortId]`, `legs[longId]` = {bid, ask} from get_option_quotes.

## B2. Plan and act (loop up to 8 times)
`python3 claudebot/options_bot.py plan /tmp/ofacts.json`

| action | what to do |
|---|---|
| `none` | `options_bot.py log --action hold --detail "<reason>"` (no log when "market closed") |
| `need_underlying` | add that ticker to `underlyings`, re-plan |
| `need_contracts` | for each strike: `get_option_instruments(chain_symbol SYM, expiration_dates, type put, strike_price "<k>.0000")` (in parallel); one `get_option_quotes` for all ids found; append `{symbol, id, strike, expiration, bid, ask, delta}` to `candidates`; re-plan |
| `need_leg_quotes` | fetch into `legs`, re-plan |
| `place_tp` | LIVE: resting take-profit. `review_option_order` then `place_option_order`: legs [{shortId, buy, close}, {longId, sell, close}], direction debit, limit `limitPrice`, quantity "1", **time_in_force gtc**. Log it. (Placed from the day after entry so a same-day round trip can't count as a day trade.) |
| `cancel_order` | `cancel_option_order(orderId)` (pre-authorized for the bot's own orders); confirm it's cancelled before the next action |
| `record_broker_close` | the spread is gone from Robinhood: find the filled closing order for those legs in `get_option_orders(state filled)` and run `options_bot.py close --debit <its net price> --reason "take profit (resting order)"` (or "closed at broker" if it wasn't the TP order) |
| `open_spread` | LIVE: `review_option_order` with legs [{option_id: shortId, side sell, position_effect open}, {option_id: longId, side buy, position_effect open}], direction credit, type limit, price = `limitPrice`, quantity "1", time_in_force gfd, chain_symbol + underlying_type equity. If review shows a blocking alert, log it and stop. Otherwise `place_option_order` with the same params and a fresh UUID ref_id. Poll `get_option_orders(order_id)` ~every 30s for up to 3 minutes. Not filled: replace isn't needed; cancel it, then place once more at `minAcceptableCredit` and wait 3 more minutes; still not filled: cancel and log "no fill". Filled: `options_bot.py open --json '<action JSON>' --credit <actual net credit per share>`. PAPER: just `open --json`. |
| `close_spread` | LIVE: legs [{shortId, side buy, position_effect close}, {longId, side sell, position_effect close}], direction debit, type limit, price = `limitPrice`, quantity "1", gfd. Poll up to 3 minutes; if not filled, cancel and re-place at limitPrice + 0.03 (never above the spread width); repeat up to 3 times. Filled: `options_bot.py close --debit <actual net debit> --reason "<reason>"`. If still not filled, log an error so the next run retries. PAPER: just `close --debit <debit>`. |

Cancelling the bot's own unfilled option orders is pre-authorized. Never open a second
spread, never change quantity from 1, never trade a ticker not in `underlyings`.

## B3. Snapshot
`python3 claudebot/options_bot.py snapshot /tmp/ofacts.json`, then add
`docs/data/claudebot-options-ledger.json` to the same commit as the crypto ledger.

Note: ClaudeBot is separate from the older Teststock execution contract in AGENTS.md,
which forbids spreads and overnight options for Teststock's own lanes. The user
explicitly approved this exception for ClaudeBot on 2026-11-02.

---

# Part C: Paper Lab (PAPER ONLY, never places orders)

After Parts A and B (live always comes first), run the paper strategies on the same
live data. They test variants of the rules so we learn faster without risking money.

```
python3 claudebot/paper_lab.py run /tmp/ofacts.json /tmp/facts.json
```
It records every paper decision itself and prints `needs`. For each need, fetch the data,
add it to the facts files, and run it again (at most 3 rounds; skip anything slow):
- `contracts`: like B2 `need_contracts`; append to `candidates` in /tmp/ofacts.json
- `leg_quotes`: `get_option_quotes(ids)` into `legs` in /tmp/ofacts.json
- `underlying`: add that ticker to `underlyings` in /tmp/ofacts.json (price, closes, expirations)
- `crypto_quotes`: `get_crypto_quotes` into `quotes` in /tmp/facts.json

Then add `docs/data/claudebot-paper-ledger.json` to the same commit. Never place, cancel
or change any real order because of the Paper Lab. A strategy marked `promotionCandidate`
is only a suggestion: tell the user, and change live rules only if they approve.

---

# Part D: management audit (every run, last)

```
python3 claudebot/audit.py
```
The managers (Guard, Analyst, Atlas) check their teams' real work and report to the CEO:
rules not loosened, stops in place, books reconcile, no private data published, scans and
runs fresh. Add `docs/data/claudebot-audit.json` to the same commit. If the CEO status is
`fail`, message the user with the failing checks (one line each). The audit only reads
files; it never trades or changes rules.
