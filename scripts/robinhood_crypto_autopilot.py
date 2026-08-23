import base64
import datetime as dt
import json
import math
import os
import time
import uuid
from decimal import Decimal, ROUND_DOWN
from pathlib import Path
from urllib.parse import urlencode

import requests
from nacl.signing import SigningKey

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'docs' / 'data'
WATCH = DATA / 'execution-watchlist.json'
STATUS = DATA / 'crypto-api-status.json'
CROSS_CHECK = DATA / 'crypto-robinhood-cross-check.json'
TRADABLE_UNIVERSE = DATA / 'robinhood-crypto-tradable-pairs.json'
SIGNAL = ROOT / 'docs' / 'signal.json'
PLAN = DATA / 'crypto-plan-100.json'
TOURNAMENT = DATA / 'crypto-tournament.json'
CRYPTO_ADMISSION = DATA / 'crypto-profitability-admission.json'
PROBABILITY_POLICY = DATA / 'probability-first-policy.json'
BASE = 'https://trading.robinhood.com'

# Diagnostic-only: safe, coarse fields from the accounts this API key can see, captured so an
# uncaught error anywhere after account discovery can report them. "all_accounts" lists every
# account Robinhood's /accounts/ response returned, labeled only by list position (never an
# account number), each with its "status", "account_type", and "is_api_tradable" -- coarse
# classification/eligibility flags, never an account number, balance, or other private quantity.
# "fields"/"status"/"account_type"/"is_api_tradable" (top-level) mirror the one account selected
# by ROBINHOOD_CRYPTO_ACCOUNT_NUMBER once resolution succeeds. Captured because is_api_tradable
# may explain why order placement rejects an account_number that reads just succeeded with.
_last_account_diag = {}


def read_json(path, fallback=None):
    try:
        return json.loads(path.read_text())
    except Exception:
        return fallback


def write_json(path, obj):
    path.write_text(json.dumps(obj, indent=2) + '\n')


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def parse_time(value):
    try:
        return dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except Exception:
        return None


def age_minutes(value):
    t = parse_time(value)
    if not t:
        return math.inf
    return (dt.datetime.now(dt.timezone.utc) - t).total_seconds() / 60


def floor_increment(value, increment):
    v = Decimal(str(value))
    inc = Decimal(str(increment))
    if inc <= 0:
        return v
    units = (v / inc).to_integral_value(rounding=ROUND_DOWN)
    return units * inc


def decstr(value):
    return format(Decimal(str(value)).normalize(), 'f')


class RobinhoodCryptoV2:
    def __init__(self, api_key, private_key_b64):
        self.api_key = api_key
        self.private_key = SigningKey(base64.b64decode(private_key_b64))
        self.session = requests.Session()

    def _headers(self, method, path, body=''):
        ts = str(int(time.time()))
        message = f'{self.api_key}{ts}{path}{method}{body}'
        sig = self.private_key.sign(message.encode()).signature
        return {
            'x-api-key': self.api_key,
            'x-signature': base64.b64encode(sig).decode(),
            'x-timestamp': ts,
            'Content-Type': 'application/json; charset=utf-8',
        }

    def request(self, method, path, body=None):
        body_text = '' if body is None else json.dumps(body, separators=(',', ':'))
        r = self.session.request(method, BASE + path, headers=self._headers(method, path, body_text), data=body_text or None, timeout=15)
        if r.status_code >= 400:
            raise RuntimeError(f'Robinhood Crypto API {r.status_code}: {r.text[:300]}')
        if not r.text.strip():
            return {}
        return r.json()

    @staticmethod
    def q(params):
        pairs = []
        for k, v in params.items():
            if isinstance(v, (list, tuple)):
                pairs += [(k, x) for x in v]
            elif v is not None:
                pairs.append((k, v))
        return '?' + urlencode(pairs) if pairs else ''

    def accounts(self):
        return self.request('GET', '/api/v2/crypto/trading/accounts/').get('results', [])

    def holdings(self, account_number, *asset_codes):
        path = '/api/v2/crypto/trading/holdings/' + self.q({'account_number': account_number, 'asset_code': list(asset_codes) if asset_codes else None})
        return self.request('GET', path).get('results', [])

    def pairs(self, *symbols):
        path = '/api/v2/crypto/trading/trading_pairs/' + self.q({'symbol': list(symbols) if symbols else None})
        return self.request('GET', path).get('results', [])

    def quote(self, symbol):
        path = '/api/v2/crypto/marketdata/best_bid_ask/' + self.q({'symbol': symbol})
        rows = self.request('GET', path).get('results', [])
        return rows[0] if rows else None

    def orders(self, account_number, symbol=None):
        params = {'account_number': account_number, 'created_at_start': (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)).isoformat().replace('+00:00','Z')}
        if symbol:
            params['symbol'] = symbol
        path = '/api/v2/crypto/trading/orders/' + self.q(params)
        return self.request('GET', path).get('results', [])

    def order(self, account_number, order_id):
        path = f'/api/v2/crypto/trading/orders/{order_id}/' + self.q({'account_number': account_number})
        return self.request('GET', path)

    def place(self, account_number, side, order_type, symbol, config):
        body = {
            'symbol': symbol,
            'client_order_id': str(uuid.uuid4()),
            'side': side,
            'type': order_type,
            f'{order_type}_order_config': config,
        }
        path = '/api/v2/crypto/trading/orders/' + self.q({'account_number': account_number})
        return self.request('POST', path, body)

    def cancel(self, order_id):
        return self.request('POST', f'/api/v2/crypto/trading/orders/{order_id}/cancel/')


def cross_check_candidates(tournament, limit=6):
    seen = {}
    for row in [tournament.get('researchChampion'), tournament.get('qualifiedChampion'), *(tournament.get('fallbacks') or [])]:
        if not row:
            continue
        ticker = str(row.get('ticker') or '').strip()
        if ticker and ticker not in seen:
            seen[ticker] = row
        if len(seen) >= limit:
            break
    return list(seen.keys())


def publish_robinhood_cross_check(api, tournament):
    # User-requested (2026-08-23): crypto research should look at Robinhood as well as Crypto.com,
    # not only Crypto.com alone. This is a read-only Robinhood Crypto API cross-check (trading-pair
    # status plus live best bid/ask) for the current Teststock research champion, qualified champion
    # and fallbacks, published alongside -- never in place of -- Crypto.com's research data. It never
    # places, cancels or otherwise affects an order, never requires the account-resolution step below
    # to have succeeded, and contributes zero live ranking weight (Evidence and admission: alternative
    # sources start at zero live contribution). Previously this Robinhood check only ran silently,
    # once, immediately before a live buy attempt; surfacing it here makes a Crypto.com-vs-Robinhood
    # price, spread or tradability disagreement visible on the dashboard on every autopilot run,
    # whether or not a trade is ever attempted. Stocks are unaffected: Robinhood stock verification
    # already happens at approval/submission time through the existing Claude-mediated path, and nothing
    # here changes that.
    tickers = cross_check_candidates(tournament)
    results = []
    for ticker in tickers:
        symbol = ticker.replace('/', '-')
        entry = {'ticker': ticker, 'symbol': symbol, 'checkedAt': now_iso()}
        try:
            pair_rows = api.pairs(symbol)
            pair = pair_rows[0] if pair_rows else None
            if not pair:
                entry.update(available=False, reason='NOT_A_ROBINHOOD_CRYPTO_PAIR')
                results.append(entry)
                continue
            is_tradable = bool(pair.get('is_api_tradable'))
            entry.update(available=True, isApiTradable=is_tradable, status=pair.get('status'), minOrderAmount=pair.get('min_order_amount'))
            if is_tradable:
                quote = api.quote(symbol)
                if quote:
                    bid = Decimal(str(quote.get('bid') or 0))
                    ask = Decimal(str(quote.get('ask') or 0))
                    spread_pct = float((ask - bid) / ((ask + bid) / 2) * 100) if bid > 0 and ask > 0 else None
                    entry.update(bid=float(bid) if bid else None, ask=float(ask) if ask else None,
                                 spreadPct=round(spread_pct, 3) if spread_pct is not None else None)
                else:
                    entry.update(reason='NO_LIVE_QUOTE')
        except Exception as exc:
            entry.update(available=False, error=str(exc)[:200])
        results.append(entry)
    write_json(CROSS_CHECK, {
        'schemaVersion': 1,
        'source': 'ROBINHOOD_CRYPTO_API_READ_ONLY_CROSS_CHECK',
        'generatedAt': now_iso(),
        'note': ('Diagnostic-only live Robinhood Crypto API pair/quote cross-check for the current '
                 'Teststock crypto research champion, qualified champion and fallbacks. Zero live '
                 'ranking contribution; never places, cancels or modifies an order; a missing or '
                 'failed check leaves the candidate visibly unverified rather than assuming '
                 'tradability. Crypto.com remains the primary crypto research/bars/liquidity source.'),
        'candidatesChecked': len(results),
        'results': results,
    })


def publish_robinhood_tradable_universe(api):
    # User-requested (2026-08-23): crypto research should look at Robinhood as well as Crypto.com, and
    # the Crypto.com scan was widened from 80 to 200 pairs in the same change. This is a single bulk,
    # read-only Robinhood Crypto API trading-pairs call (no symbol filter -- every USD pair this key can
    # see), refreshed on the existing 5-minute autopilot cadence so scripts/generate-crypto-picks.mjs
    # (a separate ~10-15 minute workflow) can prefer Crypto.com research candidates Robinhood can
    # actually execute, rather than only discovering a mismatch after the fact. This never places,
    # cancels or modifies an order, contributes zero live ranking weight on its own (Evidence and
    # admission: alternative sources start at zero live contribution -- this only reorders among
    # already-qualifying candidates), and a failure here must never block or fail-closed the real
    # account/trading logic that follows -- it only ever affects its own output file. The real-money buy
    # path below still independently re-verifies the exact chosen pair live before any order regardless
    # of what this file says.
    rows = api.pairs()
    pairs = []
    for row in rows:
        symbol = str(row.get('symbol') or '').strip()
        if not symbol:
            asset_code, quote_code = row.get('asset_code'), row.get('quote_code')
            symbol = f'{asset_code}-{quote_code}' if asset_code and quote_code else ''
        if not symbol.endswith('-USD'):
            continue
        pairs.append({
            'symbol': symbol,
            'ticker': symbol.replace('-', '/'),
            'isApiTradable': bool(row.get('is_api_tradable')),
            'status': row.get('status'),
            'minOrderAmount': row.get('min_order_amount'),
        })
    write_json(TRADABLE_UNIVERSE, {
        'schemaVersion': 1,
        'source': 'ROBINHOOD_CRYPTO_API_TRADING_PAIRS',
        'generatedAt': now_iso(),
        'note': ('Full list of USD-quoted Robinhood Crypto API trading pairs, refreshed every autopilot '
                 'run. Research-preference input only: scripts/generate-crypto-picks.mjs uses this to '
                 'prefer Crypto.com research candidates Robinhood can actually execute. The real-money '
                 'buy path below still independently re-verifies the exact chosen pair live before any '
                 'order regardless of what this file says.'),
        'count': len(pairs),
        'tradableCount': sum(1 for p in pairs if p['isApiTradable']),
        'pairs': pairs,
    })


def set_status(status, message, **extra):
    payload = {
        'schemaVersion': 1,
        'source': 'TESTSTOCK_ROBINHOOD_CRYPTO_API_AUTOPILOT',
        'updatedAt': now_iso(),
        'status': status,
        'message': message,
        **extra,
    }
    # Never write account numbers, quantities, API keys, order IDs, balances or secrets here.
    write_json(STATUS, payload)
    print(f'Crypto autopilot: {status} - {message}')


def active_crypto_watch(watch):
    return next((x for x in watch.get('positions', []) if x.get('assetClass') == 'CRYPTO' and x.get('status') == 'ACTIVE'), None)


def matching_active_accounts(accounts, account_number=''):
    active = [a for a in accounts if str(a.get('status', '')).lower() == 'active']
    if account_number:
        return [a for a in active if str(a.get('account_number') or '').strip() == account_number.strip()]
    return active


def upsert_watch(watch, record):
    positions = watch.setdefault('positions', [])
    for i, row in enumerate(positions):
        if row.get('id') == record.get('id'):
            positions[i] = {**row, **record}
            return
    positions.append(record)


def crypto_admission_gate(admission, crypto_policy=None):
    # Shadow-first admission (CLAUDE.md's Evidence and admission section applies to every asset
    # class, not only stocks). scripts/apply-crypto-profitability-admission.mjs computes this from
    # forward-shadow outcomes (docs/data/crypto-shadow-trades.json, populated by
    # scripts/update-crypto-shadow-ledger.mjs) plus confirmed real fills
    # (docs/data/crypto-real-trade-journal.json), following the same six-shadow-outcome
    # MICRO_PROBATION / twelve-shadow-outcome PROBATION / real-fill-gated full admission ladder
    # already used for stocks. Only state and sizeMultiplier are consumed here -- never raw shadow
    # or real trade records -- and this gate can only block or shrink an order, never grow it beyond
    # ROBINHOOD_CRYPTO_MAX_ORDER_USD, buying power, or the pair's own limits.
    state = (admission or {}).get('state', 'SHADOW_ONLY')
    size_multiplier = Decimal(str((admission or {}).get('sizeMultiplier', 0) or 0))
    seed = (crypto_policy or {}).get('dayTradeSeedLane', {}) or {}
    if state == 'SHADOW_ONLY' and seed.get('enabled') is True:
        cap = Decimal(str(seed.get('maxOrderUsd', 0) or 0))
        if Decimal('0') < cap <= Decimal('5'):
            return True, Decimal('1'), cap, 'SEED'
    if state in ('SHADOW_ONLY', 'LIVE_SUSPENDED') or size_multiplier <= 0:
        shadow = (admission or {}).get('shadow', {}) or {}
        return False, Decimal('0'), Decimal('0'), (
            f'Crypto profitability admission gate not met (state={state}). Requires 6 independent '
            f'positive forward-shadow outcomes for micro-size trading; currently '
            f'{shadow.get("samples", 0)} resolved shadow outcomes '
            f'(winRate={shadow.get("winRatePct")}, avgR={shadow.get("averageR")}). No new crypto buy sent.'
        )
    return True, size_multiplier, Decimal('0'), state


def seed_stop_losses_today(watch):
    today = dt.datetime.now(dt.timezone.utc).date()
    return sum(1 for row in watch.get('positions', []) if row.get('admissionMode') == 'SEED'
               and row.get('exitReason') == 'STOP' and parse_time(row.get('closedAt'))
               and parse_time(row.get('closedAt')).date() == today)


def poll_order(api, account_number, order_id, seconds=25):
    end = time.time() + seconds
    last = None
    while time.time() < end:
        last = api.order(account_number, order_id)
        if last.get('state') in {'filled', 'failed', 'canceled'}:
            return last
        time.sleep(2)
    return last or {}


def cancel_open_sells(api, account_number, symbol):
    sell_orders = [o for o in api.orders(account_number, symbol) if o.get('side') == 'sell' and o.get('state') in {'open', 'pending'}]
    for o in sell_orders:
        api.cancel(o['id'])
    if not sell_orders:
        return True
    deadline = time.time() + 12
    while time.time() < deadline:
        still = [o for o in api.orders(account_number, symbol) if o.get('side') == 'sell' and o.get('state') in {'open', 'pending'}]
        if not still:
            return True
        time.sleep(2)
    return False


def ensure_stop(api, account_number, symbol, qty, stop_price, pair):
    existing = [o for o in api.orders(account_number, symbol) if o.get('side') == 'sell' and o.get('type') in {'stop_loss','stop_limit'} and o.get('state') in {'open','pending'}]
    if existing:
        return True
    inc = pair.get('asset_increment') or '0.00000001'
    q = floor_increment(qty, inc)
    if q <= 0:
        return False
    api.place(account_number, 'sell', 'stop_loss', symbol, {
        'asset_quantity': decstr(q),
        'stop_price': decstr(stop_price),
        'time_in_force': 'gtc',
    })
    return True


def main():
    enabled = os.getenv('ROBINHOOD_CRYPTO_AUTOPILOT_ENABLED', '').lower() == 'true'
    dry_run = os.getenv('ROBINHOOD_CRYPTO_DRY_RUN', '').lower() == 'true'
    api_key = os.getenv('ROBINHOOD_CRYPTO_API_KEY', '')
    private_key = os.getenv('ROBINHOOD_CRYPTO_PRIVATE_KEY_B64', '')
    account_selector = (os.getenv('ROBINHOOD_CRYPTO_ACCOUNT_NUMBER', '') or os.getenv('ROBINHOOD_CRYPTO_AGENTIC_ACCOUNT_NUMBER', '')).strip()
    max_order_usd = Decimal(os.getenv('ROBINHOOD_CRYPTO_MAX_ORDER_USD', '25'))

    if not enabled:
        set_status('DISABLED', 'Direct Robinhood Crypto API execution is installed but not enabled.')
        return
    if not (api_key and private_key):
        set_status('DISABLED_MISSING_SECRETS', 'Enablement is set but required Robinhood Crypto API secrets are missing.')
        return

    watch = read_json(WATCH, {'schemaVersion': 1, 'positions': []})
    signal = read_json(SIGNAL, {})
    plan = read_json(PLAN, {})
    tournament = read_json(TOURNAMENT, {})
    api = RobinhoodCryptoV2(api_key, private_key)

    # Read-only Robinhood cross-check for research visibility. Runs before account resolution (it
    # needs no account_number) and is wrapped so a failure here can never block or fail-closed the
    # real account/trading logic below -- it only ever affects its own diagnostic-only output file.
    try:
        publish_robinhood_cross_check(api, tournament)
    except Exception as exc:
        write_json(CROSS_CHECK, {
            'schemaVersion': 1,
            'source': 'ROBINHOOD_CRYPTO_API_READ_ONLY_CROSS_CHECK',
            'generatedAt': now_iso(),
            'available': False,
            'error': str(exc)[:200],
        })

    try:
        publish_robinhood_tradable_universe(api)
    except Exception as exc:
        write_json(TRADABLE_UNIVERSE, {
            'schemaVersion': 1,
            'source': 'ROBINHOOD_CRYPTO_API_TRADING_PAIRS',
            'generatedAt': now_iso(),
            'available': False,
            'error': str(exc)[:200],
        })

    accounts = api.accounts()
    all_active_count = len(matching_active_accounts(accounts))
    global _last_account_diag
    # Diagnostic-only, safe to publish: every crypto account this API key can see, labeled only by
    # its position in the list (never the account number, balance, or any other private quantity).
    # This exists to determine which account (if any) is actually eligible for order placement,
    # since is_api_tradable is not surfaced anywhere in the Robinhood app UI and the account that
    # reads succeed against is not necessarily the one writes are allowed on.
    _last_account_diag = {
        'all_accounts': [
            {
                'index': i,
                'status': a.get('status'),
                'account_type': a.get('account_type'),
                'is_api_tradable': a.get('is_api_tradable'),
            }
            for i, a in enumerate(accounts)
        ],
    }
    matching_accounts = matching_active_accounts(accounts, account_selector)
    if len(matching_accounts) != 1:
        # Diagnostic counts only -- never the account number itself -- so this stays safe to
        # publish in docs/data/crypto-api-status.json on a public repo.
        set_status(
            'BLOCKED_CRYPTO_ACCOUNT_NOT_UNIQUE',
            'Robinhood did not return exactly one active crypto account. Add the optional '
            'ROBINHOOD_CRYPTO_ACCOUNT_NUMBER selector only when more than one active crypto '
            f'account exists. No order sent. (active_accounts_total={all_active_count}, '
            f'account_selector_secret_present={bool(account_selector)}, '
            f'accounts_matching_selector={len(matching_accounts)})',
            account_diag=_last_account_diag,
        )
        return
    account = matching_accounts[0]
    _last_account_diag = {
        **_last_account_diag,
        'fields': sorted(account.keys()),
        'status': account.get('status'),
        'account_type': account.get('account_type'),
        'is_api_tradable': account.get('is_api_tradable'),
    }
    account_number = str(account.get('account_number') or '')
    if not account_number:
        set_status('BLOCKED_ACCOUNT_DATA_INVALID', 'The active Robinhood crypto trading account did not include an account number. No order sent.')
        return

    if dry_run:
        research = next((x for x in (plan.get('ranked') or []) if str(x.get('symbol', '')).endswith('/USD')), None)
        if not research:
            set_status('DRY_RUN_BLOCKED_NO_USD_CANDIDATE', 'Read-only test connected to Robinhood, but no exact USD research candidate was available. No order sent.')
            return
        symbol = str(research['symbol']).replace('/', '-')
        pair_rows = api.pairs(symbol)
        pair = pair_rows[0] if pair_rows else None
        quote = api.quote(symbol) if pair and pair.get('is_api_tradable') else None
        if not pair or not pair.get('is_api_tradable') or not quote:
            set_status('DRY_RUN_BLOCKED_PAIR_OR_QUOTE', f'Read-only test connected, but {symbol} failed the Robinhood pair/quote check. No order sent.', candidate=symbol)
            return
        bid, ask = Decimal(str(quote.get('bid') or 0)), Decimal(str(quote.get('ask') or 0))
        spread_pct = (ask-bid)/((ask+bid)/2)*100 if bid > 0 and ask > 0 else Decimal('999')
        buying_power = Decimal(str(account.get('buying_power') or 0))
        proposed = min(Decimal('5'), max_order_usd, buying_power * Decimal('0.90'))
        minimum = Decimal(str(pair.get('min_order_amount') or '1'))
        checks = {
            'exactUsdPair': symbol.endswith('-USD'),
            'apiTradable': bool(pair.get('is_api_tradable')),
            'validQuote': bid > 0 and ask > 0,
            'spreadWithinCap': spread_pct <= Decimal('0.75'),
            'buyingPowerAvailable': buying_power > 0,
            'proposedAmountMeetsPairMinimum': proposed >= minimum,
            'orderSubmissionDisabled': True,
        }
        passed = all(checks.values())
        set_status('DRY_RUN_PASSED' if passed else 'DRY_RUN_BLOCKED',
                   f'Read-only $5 crypto order-path test {"passed" if passed else "stopped at a safety check"} for {symbol}. No order was submitted.',
                   candidate=symbol, researchGrade=research.get('setupGrade'), checks=checks)
        return

    active = active_crypto_watch(watch)
    if active:
        symbol = active['ticker'].replace('/', '-')
        asset = symbol.split('-')[0]
        pair_rows = api.pairs(symbol)
        pair = pair_rows[0] if pair_rows else None
        if not pair or not pair.get('is_api_tradable'):
            set_status('BLOCKED_PAIR_NOT_TRADABLE', f'{symbol} is not API-tradable; existing position requires manual review.')
            return
        holding_rows = api.holdings(account_number, asset)
        holding = next((h for h in holding_rows if h.get('asset_code') == asset), None)
        qty = Decimal(str((holding or {}).get('quantity_available_for_trading', '0')))
        if qty <= 0:
            upsert_watch(watch, {**active, 'status': 'CLOSED', 'closedAt': now_iso()})
            write_json(WATCH, watch)
            set_status('POSITION_CLOSED', f'{symbol} no longer has an available crypto holding; watchlist marked closed.')
            return

        quote = api.quote(symbol)
        if not quote:
            set_status('BLOCKED_NO_QUOTE', f'No direct Robinhood quote for {symbol}; no action sent.')
            return
        bid = Decimal(str(quote['bid']))
        stop = Decimal(str(active.get('stop') or 0))
        t1 = Decimal(str(active.get('target1') or 0))
        t2 = Decimal(str(active.get('target2') or 0))
        entry = Decimal(str(active.get('entry') or 0))

        if stop > 0 and bid <= stop:
            if not cancel_open_sells(api, account_number, symbol):
                set_status('BLOCKED_OPEN_SELL_CANCEL', f'{symbol} hit stop but an existing sell order could not be cleared safely.')
                return
            sell = api.place(account_number, 'sell', 'market', symbol, {'asset_quantity': decstr(floor_increment(qty, pair.get('asset_increment') or '0.00000001'))})
            result = poll_order(api, account_number, sell['id'], 25)
            if result.get('state') == 'filled':
                upsert_watch(watch, {**active, 'status': 'CLOSED', 'closedAt': now_iso(), 'exitReason': 'STOP'})
                write_json(WATCH, watch)
                set_status('STOP_EXIT_FILLED', f'{symbol} stop exit was filled by the official Robinhood Crypto API.')
            else:
                set_status('STOP_EXIT_PENDING', f'{symbol} stop exit was submitted but not yet confirmed filled.')
            return

        if t2 > 0 and bid >= t2 and not active.get('target2Completed'):
            if not cancel_open_sells(api, account_number, symbol):
                set_status('BLOCKED_OPEN_SELL_CANCEL', f'{symbol} reached Target 2 but an existing sell order could not be cleared safely.')
                return
            sell = api.place(account_number, 'sell', 'market', symbol, {'asset_quantity': decstr(floor_increment(qty, pair.get('asset_increment') or '0.00000001'))})
            result = poll_order(api, account_number, sell['id'], 25)
            if result.get('state') == 'filled':
                upsert_watch(watch, {**active, 'status': 'CLOSED', 'target2Completed': True, 'closedAt': now_iso(), 'exitReason': 'TARGET2'})
                write_json(WATCH, watch)
                set_status('TARGET2_EXIT_FILLED', f'{symbol} Target 2 exit was filled by the official Robinhood Crypto API.')
            else:
                set_status('TARGET2_EXIT_PENDING', f'{symbol} Target 2 exit was submitted but not yet confirmed filled.')
            return

        if t1 > 0 and bid >= t1 and not active.get('target1Completed'):
            if not cancel_open_sells(api, account_number, symbol):
                set_status('BLOCKED_OPEN_SELL_CANCEL', f'{symbol} reached Target 1 but an existing sell order could not be cleared safely.')
                return
            sell_qty = floor_increment(qty * Decimal('0.25'), pair.get('asset_increment') or '0.00000001')
            if sell_qty <= 0:
                sell_qty = floor_increment(qty, pair.get('asset_increment') or '0.00000001')
            sell = api.place(account_number, 'sell', 'market', symbol, {'asset_quantity': decstr(sell_qty)})
            result = poll_order(api, account_number, sell['id'], 25)
            if result.get('state') != 'filled':
                ensure_stop(api, account_number, symbol, qty, stop, pair)
                set_status('TARGET1_EXIT_PENDING', f'{symbol} Target 1 sale was submitted but not confirmed filled; protection was restored where possible.')
                return
            new_hold = api.holdings(account_number, asset)
            h = next((x for x in new_hold if x.get('asset_code') == asset), None)
            remain = Decimal(str((h or {}).get('quantity_available_for_trading', '0')))
            new_stop = max(stop, entry) if entry > 0 else stop
            if remain > 0 and new_stop > 0:
                ensure_stop(api, account_number, symbol, remain, new_stop, pair)
            upsert_watch(watch, {**active, 'target1Completed': True, 'postTarget1Stop': float(new_stop), 'target1CompletedAt': now_iso()})
            write_json(WATCH, watch)
            set_status('TARGET1_FILLED', f'{symbol} Target 1 partial exit filled and remaining position protection was re-armed.')
            return

        max_holding_hours = Decimal(str(active.get('maxHoldingHours') or 0))
        if max_holding_hours > 0 and age_minutes(active.get('armedAt')) >= float(max_holding_hours * 60):
            if not cancel_open_sells(api, account_number, symbol):
                set_status('BLOCKED_OPEN_SELL_CANCEL', f'{symbol} reached its time exit but an existing sell order could not be cleared safely.')
                return
            sell = api.place(account_number, 'sell', 'market', symbol, {'asset_quantity': decstr(floor_increment(qty, pair.get('asset_increment') or '0.00000001'))})
            result = poll_order(api, account_number, sell['id'], 25)
            if result.get('state') == 'filled':
                upsert_watch(watch, {**active, 'status': 'CLOSED', 'closedAt': now_iso(), 'exitReason': 'TIME_EXIT'})
                write_json(WATCH, watch)
                set_status('TIME_EXIT_FILLED', f'{symbol} day-trade holding window expired and the exit filled.')
            else:
                set_status('TIME_EXIT_PENDING', f'{symbol} day-trade time exit was submitted but not yet confirmed filled.')
            return

        if stop > 0:
            ensure_stop(api, account_number, symbol, qty, stop, pair)
        set_status('HOLD', f'{symbol} remains between its saved stop and targets; broker stop protection was checked.')
        return

    # No tracked crypto position: fail closed if the API account already holds crypto.
    holdings = [h for h in api.holdings(account_number) if Decimal(str(h.get('quantity_available_for_trading', '0'))) > 0]
    if holdings:
        set_status('BLOCKED_UNTRACKED_HOLDING', 'Crypto exists in the configured account but is not in Teststock execution-watchlist; no new buy sent.')
        return

    if age_minutes(tournament.get('generatedAt')) > 30 or age_minutes(plan.get('generatedAt') or plan.get('asOf')) > 30:
        set_status('WAIT_FRESH_RESEARCH', 'Crypto plan is older than 30 minutes; no new buy sent.')
        return

    admission = read_json(CRYPTO_ADMISSION, {})
    probability_policy = read_json(PROBABILITY_POLICY, {})
    crypto_policy = probability_policy.get('crypto', {}) or {}
    admission_ok, size_multiplier, seed_cap, admission_reason = crypto_admission_gate(admission, crypto_policy)
    if not admission_ok:
        set_status('BLOCKED_INSUFFICIENT_CRYPTO_EVIDENCE', admission_reason)
        return
    seed_mode = admission_reason == 'SEED'
    seed_policy = crypto_policy.get('dayTradeSeedLane', {}) or {}
    if seed_mode and seed_stop_losses_today(watch) >= int(seed_policy.get('maxStopLossesPerUtcDay', 2)):
        set_status('BLOCKED_SEED_DAILY_LOSS_PAUSE', 'Crypto seed trading paused after the maximum stop losses for the current UTC day.')
        return

    allocations = plan.get('allocations') or []
    allocations_by_symbol = {str(x.get('symbol', '')).replace('-', '/'): x for x in allocations}
    ordered = [tournament.get('qualifiedChampion'), *(tournament.get('fallbacks') or [])]
    picks = []
    for candidate in ordered:
        if not candidate:
            continue
        ticker = str(candidate.get('ticker', '')).replace('-', '/')
        allocation = allocations_by_symbol.get(ticker)
        if allocation:
            picks.append({**allocation, 'tournamentRank': candidate.get('rank'), 'setupGrade': candidate.get('grade') or allocation.get('setupGrade')})
    if not picks:
        set_status('NO_QUALIFIED_CRYPTO', 'Current Teststock crypto tournament has no qualifying allocation.')
        return
    selected = None
    rejection_reasons = []
    for candidate in picks:
        grade = candidate.get('setupGrade')
        if not str(candidate.get('symbol', '')).endswith('/USD'):
            rejection_reasons.append(f'{candidate.get("symbol")}: non-USD quote')
            continue
        symbol = str(candidate['symbol']).replace('/', '-')
        if grade not in {'A', 'A+'}:
            rejection_reasons.append(f'{symbol}: grade')
            continue
        pair_rows = api.pairs(symbol)
        pair = pair_rows[0] if pair_rows else None
        if not pair or not pair.get('is_api_tradable') or pair.get('status') not in {'tradable', 'active'}:
            rejection_reasons.append(f'{symbol}: not API tradable')
            continue
        quote = api.quote(symbol)
        if not quote:
            rejection_reasons.append(f'{symbol}: no quote')
            continue
        bid = Decimal(str(quote['bid']))
        ask = Decimal(str(quote['ask']))
        if bid <= 0 or ask <= 0:
            rejection_reasons.append(f'{symbol}: invalid quote')
            continue
        spread_pct = (ask - bid) / ((ask + bid) / 2) * 100
        if spread_pct > Decimal('0.75'):
            rejection_reasons.append(f'{symbol}: spread')
            continue
        reference_entry = Decimal(str(candidate.get('entry') or ask))
        max_entry = reference_entry * Decimal('1.02')
        if ask > max_entry:
            rejection_reasons.append(f'{symbol}: do not chase')
            continue
        open_orders = [o for o in api.orders(account_number, symbol) if o.get('state') in {'open','pending'}]
        if open_orders:
            rejection_reasons.append(f'{symbol}: existing order')
            continue
        selected = (candidate, symbol, pair, bid, ask, reference_entry, max_entry, grade)
        break

    if not selected:
        set_status('NO_EXECUTABLE_CRYPTO_FINALIST', 'No Teststock crypto winner/fallback survived direct Robinhood live checks: ' + '; '.join(rejection_reasons[:6]))
        return
    pick, symbol, pair, bid, ask, reference_entry, max_entry, grade = selected

    buying_power = Decimal(str(account.get('buying_power') or '0'))
    desired = Decimal(str(pick.get('allocationDollars') or '0'))
    # Admission size_multiplier (MICRO_PROBATION=0.25, PROBATION=0.5, LIVE_ADMITTED=1) can only
    # shrink the effective ceiling below the already-declared ROBINHOOD_CRYPTO_MAX_ORDER_USD secret.
    effective_max_order_usd = max_order_usd * size_multiplier
    if seed_mode:
        effective_max_order_usd = min(effective_max_order_usd, seed_cap)
    amount = min(desired, effective_max_order_usd, buying_power * Decimal('0.90'))
    min_amount = Decimal(str(pair.get('min_order_amount') or '1'))
    if amount < min_amount or amount <= 0:
        set_status('BLOCKED_INSUFFICIENT_BUYING_POWER', 'Qualified crypto exists but safe order amount is below the API pair minimum.')
        return

    # Use a marketable limit order at the current direct Robinhood ask, bounded by Teststock's no-chase ceiling.
    limit_price = min(ask * Decimal('1.001'), max_entry)
    buy = api.place(account_number, 'buy', 'limit', symbol, {
        'quote_amount': decstr(amount),
        'limit_price': decstr(limit_price),
        'time_in_force': 'gtc',
    })
    result = poll_order(api, account_number, buy['id'], 25)
    if result.get('state') not in {'filled', 'partially_filled'}:
        api.cancel(buy['id'])
        set_status('BUY_NOT_FILLED_CANCELED', f'{symbol} buy did not fill promptly and was canceled to avoid an unattended unprotected fill.')
        return
    if result.get('state') == 'partially_filled':
        api.cancel(buy['id'])
        time.sleep(2)
        result = api.order(account_number, buy['id'])

    filled_qty = Decimal(str(result.get('filled_asset_quantity') or '0'))
    if filled_qty <= 0:
        set_status('BUY_FILL_UNCONFIRMED', f'{symbol} order returned without a confirmed filled quantity; no protection assumption made.')
        return

    stop = Decimal(str(pick.get('stop') or 0))
    t1 = Decimal(str(pick.get('target1') or 0))
    t2 = Decimal(str(pick.get('target2') or 0))
    if not (stop > 0 and t1 > 0 and t2 > 0):
        # Do not leave an unprotected position if the research packet was incomplete.
        api.place(account_number, 'sell', 'market', symbol, {'asset_quantity': decstr(floor_increment(filled_qty, pair.get('asset_increment') or '0.00000001'))})
        set_status('EMERGENCY_EXIT_INCOMPLETE_PLAN', f'{symbol} filled but saved exit levels were incomplete; immediate risk-reducing sell submitted.')
        return

    if not ensure_stop(api, account_number, symbol, filled_qty, stop, pair):
        api.place(account_number, 'sell', 'market', symbol, {'asset_quantity': decstr(floor_increment(filled_qty, pair.get('asset_increment') or '0.00000001'))})
        set_status('EMERGENCY_EXIT_PROTECTION_FAILED', f'{symbol} filled but broker stop could not be armed; immediate risk-reducing sell submitted.')
        return

    fill_price = Decimal(str(result.get('average_price') or reference_entry))
    record = {
        'id': f'CRYPTO:{symbol}:{int(time.time())}',
        'assetClass': 'CRYPTO',
        'ticker': symbol,
        'status': 'ACTIVE',
        'entry': float(fill_price),
        'stop': float(stop),
        'target1': float(t1),
        'target2': float(t2),
        'target1Completed': False,
        'target2Completed': False,
        'runnerPct': 0,
        'validatedExitPolicy': 'T1_25_T2_75',
        'signalGeneratedAt': plan.get('generatedAt') or plan.get('asOf'),
        'armedAt': now_iso(),
        'brokerProtection': 'ROBINHOOD_CRYPTO_API_STOP_LOSS_GTC',
        'admissionMode': 'SEED' if seed_mode else admission.get('state'),
        'maxHoldingHours': int(seed_policy.get('maxHoldingHours', 8)) if seed_mode else None,
    }
    upsert_watch(watch, record)
    write_json(WATCH, watch)
    set_status(
        'BUY_FILLED_AND_PROTECTED',
        f'{symbol} buy filled through the official Robinhood Crypto API and a broker-resident stop was armed.',
        candidate=symbol, grade=grade, admissionState=('SEED' if seed_mode else admission.get('state')), sizeMultiplier=str(size_multiplier),
    )


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # account_diag is diagnostic-only: field names plus a few coarse classification/eligibility
        # values (status, account_type, is_api_tradable) from Robinhood's own /accounts/ response
        # -- never the account number, balance, or any other private quantity -- safe to publish,
        # and here to help pin down why order-placement calls reject an account_number that reads
        # succeeded with moments earlier, without guessing at another blind fix.
        set_status(
            'ERROR_FAIL_CLOSED',
            f'Autopilot stopped without assuming success: {str(exc)[:220]}',
            account_diag=_last_account_diag,
        )
        raise
