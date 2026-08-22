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
SIGNAL = ROOT / 'docs' / 'signal.json'
PLAN = DATA / 'crypto-plan-100.json'
TOURNAMENT = DATA / 'crypto-tournament.json'
CRYPTO_ADMISSION = DATA / 'crypto-profitability-admission.json'
BASE = 'https://trading.robinhood.com'


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
        # account_number is accepted here only for call-site symmetry; the real Crypto Trading
        # API scopes holdings to the single account tied to the API key and 400s on an
        # account_number query param ("account number provided is not valid for this request").
        path = '/api/v2/crypto/trading/holdings/' + self.q({'asset_code': list(asset_codes) if asset_codes else None})
        return self.request('GET', path).get('results', [])

    def pairs(self, *symbols):
        path = '/api/v2/crypto/trading/trading_pairs/' + self.q({'symbol': list(symbols) if symbols else None})
        return self.request('GET', path).get('results', [])

    def quote(self, symbol):
        path = '/api/v2/crypto/marketdata/best_bid_ask/' + self.q({'symbol': symbol})
        rows = self.request('GET', path).get('results', [])
        return rows[0] if rows else None

    def orders(self, account_number, symbol=None):
        # account_number kept in the signature for call-site symmetry only -- see holdings().
        params = {'created_at_start': (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)).isoformat().replace('+00:00','Z')}
        if symbol:
            params['symbol'] = symbol
        path = '/api/v2/crypto/trading/orders/' + self.q(params)
        return self.request('GET', path).get('results', [])

    def order(self, account_number, order_id):
        path = f'/api/v2/crypto/trading/orders/{order_id}/'
        return self.request('GET', path)

    def place(self, account_number, side, order_type, symbol, config):
        body = {
            'symbol': symbol,
            'client_order_id': str(uuid.uuid4()),
            'side': side,
            'type': order_type,
            f'{order_type}_order_config': config,
        }
        path = '/api/v2/crypto/trading/orders/'
        return self.request('POST', path, body)

    def cancel(self, order_id):
        return self.request('POST', f'/api/v2/crypto/trading/orders/{order_id}/cancel/')


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


def crypto_admission_gate(admission):
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
    if state in ('SHADOW_ONLY', 'LIVE_SUSPENDED') or size_multiplier <= 0:
        shadow = (admission or {}).get('shadow', {}) or {}
        return False, Decimal('0'), (
            f'Crypto profitability admission gate not met (state={state}). Requires 6 independent '
            f'positive forward-shadow outcomes for micro-size trading; currently '
            f'{shadow.get("samples", 0)} resolved shadow outcomes '
            f'(winRate={shadow.get("winRatePct")}, avgR={shadow.get("averageR")}). No new crypto buy sent.'
        )
    return True, size_multiplier, ''


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

    accounts = api.accounts()
    all_active_count = len(matching_active_accounts(accounts))
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
            f'accounts_matching_selector={len(matching_accounts)})'
        )
        return
    account = matching_accounts[0]
    account_number = str(account.get('account_number') or '')
    if not account_number:
        set_status('BLOCKED_ACCOUNT_DATA_INVALID', 'The active Robinhood crypto trading account did not include an account number. No order sent.')
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
    admission_ok, size_multiplier, admission_reason = crypto_admission_gate(admission)
    if not admission_ok:
        set_status('BLOCKED_INSUFFICIENT_CRYPTO_EVIDENCE', admission_reason)
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
        'id': f'CRYPTO:{symbol}',
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
    }
    upsert_watch(watch, record)
    write_json(WATCH, watch)
    set_status(
        'BUY_FILLED_AND_PROTECTED',
        f'{symbol} buy filled through the official Robinhood Crypto API and a broker-resident stop was armed.',
        candidate=symbol, grade=grade, admissionState=admission.get('state'), sizeMultiplier=str(size_multiplier),
    )


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        set_status('ERROR_FAIL_CLOSED', f'Autopilot stopped without assuming success: {str(exc)[:220]}')
        raise
