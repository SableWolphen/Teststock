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

**Stale price scan:** GitHub often skips scheduled workflows on this busy repo. If
`docs/data/claudebot-signal.json` `generatedAt` is more than 75 minutes old, run
`gh api -X POST repos/SableWolphen/Teststock/actions/workflows/claudebot-signal.yml/dispatches -f ref=main` (REST; `gh workflow run` needs GraphQL, which is blocked), wait about 60 seconds
(poll `gh run list --workflow claudebot-signal.yml -L1` until completed, max ~2 min), then
`git pull --rebase`. If `gh` isn't available or it fails, carry on: the crypto planner
already refuses new entries on a stale signal.

## Gate first (board order 2026-11-02: everything runs on GitHub until a trade is ready)

Right after cloning, read `docs/data/claudebot-gate.json` (written every 5 min in market hours by the all-day loop
`.github/workflows/claudebot-market-loop.yml`, which replays the Dip desk's exact rules on fresh prices).
- If `needed` is false AND `freshUntil` is later than now: STOP. No Robinhood calls, no other
  parts, no commit, no message. (GitHub already ran the paper desks, audit inputs and research.)
- Otherwise (`needed` true, or the file is missing/stale): do the full run below. Robinhood is the
  authority: re-check everything live; the gate only decides whether to look.
- If the file is stale (`freshUntil` passed) during market hours (8:30-15:00 CT, weekdays), GitHub's
  timer slipped: restart the all-day loop first with
  `gh api -X POST repos/SableWolphen/Teststock/actions/workflows/claudebot-market-loop.yml/dispatches -f ref=main`
  (a second copy just queues and exits, so this is always safe), then do the full run.

## RISK GOVERNOR (board order 2026-11-03): no live order without an ALLOW

Right before EVERY live `review_*_order`/`place_*_order` that opens or closes a position (Dip buy/sell,
option buy/sell/take-profit, crypto sell), run:
`python3 claudebot/governor.py check '{"desk": "dip|optbuy|crypto|spread", "side": "buy|sell", "symbol": "...", "usd": <dollars or premium x 100 for buys>, "quantity": "<sells>", "accountNickname": "MCP", "accountValue": <get_portfolio total>, "buyingPower": <buying power>, "quoteAgeSec": <seconds since the quote you used>}'`
Exit code 0 = ALLOW: proceed. Exit code 1 = DENY: place NOTHING for that action, log it with the desk's
`log --action governor-deny --detail "<reasons>"`, and move on (exits of other positions still run).
The governor reads the configs and ledgers itself and has hard ceilings of its own; never edit it,
never skip it, never retry a denied order with different numbers to get around it. Cancelling the
bot's own resting orders does not need it.

## Run budget (board order 2026-11-02: keep the company running within the usage limit)

Each run costs usage, and a run that hits the limit trades nothing. Do only the parts that can
matter on THIS run (Chicago time), then commit and stop. Exits are never skipped.
| Part | When to do it |
|---|---|
| A crypto | only if `docs/data/claudebot-ledger.json` has an `open` position (live crypto entries are off) |
| B options spreads (paper) | never: Sim was fired 2026-11-03 (spreads can't trade live; research stays in the free weekly backtests) |
| E Dip desk | every run: buys at the first run of the day where a fund qualifies (hourly: 8:44, 9:44, 10:14, 11:14, 12:14, 1:14, 2:14, 2:44; board 2026-11-06), stops, bounce and time exits at every run too |
| E7 options-buying | every run while an option is held (the exit follows the stock); when flat and `claudebot/optbuy_config.json` has `"enabled": true`, every run 8:40-14:59 CT (board 2026-11-11: buys and sells all day) |
| C Paper Lab | never: Sim was fired 2026-11-03 |
| C3 day-trade paper | never: GitHub Actions replays each day for free after the close |
| C2 promote + D audit | every run (local scripts, cheap) |
Skipped parts need no facts, no tool calls and no log line. Load only the tools the run needs
in one ToolSearch call, make independent calls in parallel, and keep notes short.

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
# (run Parts B, E, C, C3, C2 and D below first, then:)
git add docs/data/claudebot-ledger.json docs/data/claudebot-options-ledger.json docs/data/claudebot-paper-ledger.json docs/data/claudebot-audit.json docs/data/claudebot-dip-ledger.json docs/data/claudebot-daytrade-paper.json docs/data/claudebot-optbuy-ledger.json claudebot/options_config.json
git commit -m "ClaudeBot run <UTC time>: <what happened>"
git pull --rebase -X theirs origin main && git push origin HEAD:main
```
(If git push isn't possible, write the file with the GitHub connector instead.)

Never write account numbers, dollar balances, coin quantities or order IDs into
the repo. The ledger only holds prices and percentages.

## 4. Report
**An order the rules called for that could not be placed is always reported (board order 2026-11-11).**
If a planner returned a buy or sell and it did not go through (the order tool was blocked or denied,
Robinhood rejected it, or it never filled), log it with the desk's `log --action error`, then tell the
user in one or two plain lines: which order, why it failed, that nothing was placed, and that they can
place it themselves in the Robinhood app if they want it. A blocked SELL or STOP is urgent: say so.
(2026-11-06: a planned buy was blocked by the run's own permission layer and nobody was told.)

Only send a message when something happened (a buy, a sell, a stop moved, a paper
spread opened or closed, or an error). One or two lines: what, price, why, and running % since start.

---

# Part B: options (put credit spreads), PAPER ONLY

> Robinhood rejects multi-leg orders from agents (verified 2026-11-02), so spreads are paper-only.
> Never submit a real multi-leg order. The audit FAILS if the options ledger mode is ever "live".

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

# Part C3: Day-trade desk (PAPER ONLY), once per market day

Only on market days when the local Chicago time is between 2:41 PM and 4:30 PM (normally
the 2:44 PM run). Skip it at any other time. It replays today on real 5-minute bars.
1. `get_equity_historicals(symbols = SPY, QQQ, DIA, IWM, SMH, XLK, KRE, interval "5minute",
   start_time = today 13:00Z)` and `get_equity_quotes` for the same symbols (use each
   quote's `adjusted_previous_close`).
2. Write `/tmp/dtbars.json` = the historicals result as-is (keep its `data.results`), plus
   `"date": "<today, YYYY-MM-DD>"` and `"prevClose": {"SPY": ..., ...}`. If the result is too
   big for one read, extract it with python/jq into that same shape.
3. `python3 claudebot/daytrade_paper.py run /tmp/dtbars.json`. It records the day once
   (`skip` if done, `wait` if the bars don't reach 15:40 ET yet; then do nothing).
4. Add `docs/data/claudebot-daytrade-paper.json` to the same commit. Never place, cancel or
   change any real order because of this desk. Going live needs the board's approval.

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

---

# Part C2: CEO auto-approval (after the Paper Lab, before the audit)

```
python3 claudebot/promote.py
```
Board policy (2026-11-02): the CEO approves proven Paper Lab research automatically.
- `promote`: a parameter variant (delta, min credit, take profit, stop) had 20+ paper
  trades, profit factor ≥ 1.3 and beat the live rules on paper, so it has been written into
  `claudebot/options_config.json`. Commit that file with the ledgers and tell the user in one line.
- `rollback`: the promoted rules lost money live (profit factor < 1.0 after 10 trades), so the
  previous rules have been restored. Commit and tell the user in one line.
- `board`: a strategy that removes a safety rule qualified. Do NOT change anything;
  tell the user it's waiting for their approval.
- `none`: nothing to do.
Never edit the rules by hand: only promote.py may change them, and only within its hard limits.

---

# Part E: Dip desk (LIVE, stocks): after Part B, before the Paper Lab

Buys an ETF from dip_config.json `symbols` after a sharp dip in an uptrend, sells on the bounce.
Up to `maxOpenPositions` at once, one per ETF. Board order: with `deployAllCash`, the planner splits
all free cash (minus $1) across the day's signals; always buy exactly the `dollarAmount` it returns. Rules: `claudebot/dip_bot.py` + `claudebot/dip_config.json`. Ledger:
`docs/data/claudebot-dip-ledger.json`.

1. Write `/tmp/dfacts.json` with `now`, `marketOpen` (same rule as Part B),
   `accountValue`, `buyingPower` (from get_portfolio) and `"symbols": {}`, then run
   `python3 claudebot/dip_bot.py plan /tmp/dfacts.json`. Only fetch symbol data when it asks.
2. `need_symbol`: add `symbols[SYM] = {price, closes, heldQty}`: price from get_equity_quotes;
   closes = the last 260 COMPLETED daily closes from get_equity_historicals (interval "day",
   start about 400 days ago; drop today's unfinished bar); heldQty = that symbol's
   `shares_available_for_sells` from get_equity_positions (0 if not held). Re-plan.
   **News check before every buy (board order 2026-11-02; veto only, never adds a trade).**
   First read `docs/data/claudebot-news.json` (Nova, refreshed every 5 min by GitHub): any fund in its
   `flags` is skipped for new buys (severe news only); `watch` is information, not a veto. Then,
   before placing a `buy` (here or in E7), run at most 2 WebSearch calls: "<SYMBOL> news today"
   and "stock market news today". Skip that buy ONLY for a fresh (last ~24h), specific danger:
   the fund or stock is halted, delisting, under fraud/accounting investigation, or hit by a
   company/sector shock still unfolding (e.g. a bank failure for KRE/XLF, a chip export ban for
   SMH); a market-wide circuit breaker or crash in progress; or a major scheduled event before the
   next session that the event calendar misses. Ordinary bad headlines are NOT a veto: the dip
   rule is designed to buy after bad news. If skipped, run
   `dip_bot.py log --action news-skip --detail "<SYM>: <one-line reason + source>"` (or
   `optbuy_bot.py log ...`), add the symbol to a `"skip": [...]` list in the facts file, and re-plan
   (the planners ignore skipped symbols for new buys this run; exits are never skipped). Never change
   size because of news. If search fails, proceed (the tested rule stands on its own).
3. `buy`: governor check (desk dip, side buy, usd dollarAmount) must ALLOW; then review_equity_order(side buy, type market, dollar_amount = dollarAmount,
   market_hours regular_hours) then place_equity_order with the same params and a fresh UUID
   ref_id. Poll get_equity_orders(order_id) until filled (~1 min). Then
   `dip_bot.py open --symbol S --price <average fill price> --usd <filled notional> --pct <pctOfAccount from the buy action> --rule <rule from the buy action>`.
4. `sell`: governor check (desk dip, side sell, quantity) must ALLOW; then review_equity_order(side sell, type market, quantity = quantity) then place it.
   Poll until filled, then `dip_bot.py close --symbol S --price <average fill price> --reason <reason>`.
   Never sell more than the quantity given (the account holds other shares, e.g. KO).
5. `record_broker_close`: find the filled sell of that symbol in get_equity_orders and record it with `close --symbol S`.
   After any buy, sell or record_broker_close, refresh buyingPower and re-plan (up to 6 rounds):
   the planner returns one action at a time and several positions may need work in one run.
6. `none`: `dip_bot.py log --action hold --detail "<reason>"` (skip when the reason is "market closed").
7. `mark`: after the loop, while anything is held, run `python3 claudebot/dip_bot.py mark /tmp/dfacts.json` (needs `symbols[SYM].price` for held symbols) so the site can show what was made today.
Add `docs/data/claudebot-dip-ledger.json` to the same commit.

## E7. Options-buying desk (LIVE, single-leg calls), right after the Dip desk

**Board order 2026-11-11** ("Live: cheap-stock + index", chosen when asked whether to skip the 30-paper-trade
rule): the desk trades two rules with real money, one option at a time, inside the governor's caps ($50 and
43% of the account). (1) cheap-stock call: a scan-list name at $25 or less, the call within 3% of the price
about 30 days out; (2) index call: SPY, QQQ or IWM, the closest-to-the-price call about 45 days out. Buys only
at any run 8:40-14:59 CT (board 2026-11-11). The exit follows the STOCK at any run (5% below where it was at entry;
back above its 5-day average; day 10; 5 days before expiry). There is NO resting take-profit
order and no premium stop: the most a trade can lose is what was paid. The evidence is thin and there are no
paper trades (optbuy_config.json `rules.*.evidence`); never widen a rule, a cap or the budget.

Rules: `claudebot/optbuy_bot.py` + `claudebot/optbuy_config.json`. Ledger:
`docs/data/claudebot-optbuy-ledger.json`. Reuse `/tmp/dfacts.json` (same `symbols` data), then
`python3 claudebot/optbuy_bot.py plan /tmp/dfacts.json` and loop (up to 10 rounds):
| action | what to do |
|---|---|
| `need_scan` | load `docs/data/claudebot-optbuy-scan.json` into `scan` in /tmp/dfacts.json (once per run). If it is more than ~30 hours old on a weekday, first dispatch `claudebot-optbuy-scan.yml` the same way as the stale crypto scan (step 0) and pull; if it's still stale the planner skips the cheap stocks by itself. Re-plan |
| `need_symbol` | same as the Dip desk: add `symbols[SYM] = {price, closes, heldQty}`; re-plan. Also asked for the stock under a HELD option: its price and closes decide the exit |
| `need_scan_prices` | `scanPrices[SYM]` = live price from get_equity_quotes (up to 20 symbols per call) for every symbol listed; re-plan |
| `need_quality` | `quality[SYM]` = {`pe`: pe_ratio from get_equity_fundamentals (null if missing), `buy`, `hold`, `sell`: num_*_ratings from get_equity_analyst_ratings (0 each if no coverage)}; re-plan |
| `need_earnings` | `earnings[SYM]` = that stock's next report date (YYYY-MM-DD) from get_earnings_calendar (days 31; look for the symbol), or null if none in the window; re-plan |
| `need_expirations` | `expirations[SYM]` = get_option_chains(SYM).expiration_dates; re-plan |
| `need_calls` | get_option_instruments(chain_symbol SYM, expiration_dates, type call), keep strikes between strikeMin and strikeMax, one get_option_quotes for those ids; append `{symbol, id, strike, expiration, bid, ask, delta}` to `calls` and add `"SYM|expiration"` to `callsFetched` (even if nothing was in range); re-plan |
| `need_position` | for EVERY id in `ids`: `optHeldById[id]` = its quantity in get_option_positions(nonzero=true) (0 if absent); `optQuotes[id]` = {bid, ask} from one get_option_quotes call; `tpOrders[id]` = {id, price} of any open sell-to-close order on it (get_option_orders state queued/confirmed), omit if none; re-plan |
| `buy` | Profitability Gatekeeper first, with the numbers FROM THE BUY ACTION: `python3 claudebot/gatekeeper.py '{"candidate": {"ask": <ask>, "bid": <bid>, "forecastUsd": <forecastUsd>}, "accountValue": <V>, "strategyId": "<strategyId>", "holdMinutes": <holdMinutes>, "live": true}'`; pass its JSON verdict as `gatekeeper` in the governor check (desk optbuy, side buy, usd = limitPrice x 100), which must ALLOW; then review_option_order (one leg: option_id id, side buy, position_effect open; type limit, price limitPrice, quantity "1", gfd), then place_option_order with a fresh UUID ref_id. Poll ~every 30s up to 3 min; if unfilled, cancel and place once more at maxPrice, wait 3 min; still unfilled: cancel and log "no fill". Filled: `optbuy_bot.py open --json '<the whole buy action JSON>' --price <average fill price>`, then re-plan. |
| `cancel_order` | cancel_option_order(orderId) (a leftover resting order of the bot's own; pre-authorized); confirm cancelled; re-plan |
| `sell` | governor check (desk optbuy, side sell) must ALLOW; then one leg (id, side sell, position_effect close), type limit, price limitPrice, quantity "1", gfd. Poll up to 2 min; if unfilled, cancel and re-place $0.01 lower, up to 3 times (never below $0.01). Filled: `optbuy_bot.py close --id <id from the sell action> --price <fill> --reason "<reason>"`. If it could not be sold, follow section 4 (tell the board; a blocked sell is urgent). |
| `record_broker_close` | find the filled sell-to-close for that id in get_option_orders(state filled) and run `close --id <id> --price <its price> --reason "closed at broker"` |
| `none` | `optbuy_bot.py log --action hold --detail "<reason>"` (skip when "market closed") |
Board 2026-11-11: up to 3 options at once (each at most $25, all together at most 65% of the account, never two on the same stock; the planner and governor enforce it). Never buy more than quantity 1, never sell options you didn't buy, never place a resting take-profit. Universe = the planner's two rules only: SPY, QQQ, IWM, and `scanUniverse` names priced $25 or less; never buy an option the planner did not return.
While options are held, finish with `python3 claudebot/optbuy_bot.py mark /tmp/dfacts.json` (uses `optQuotes`) so the site can show what was made today.
Add `docs/data/claudebot-optbuy-ledger.json` to the same commit.
