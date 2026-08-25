import fs from 'node:fs/promises';

const file = 'scripts/robinhood_crypto_autopilot.py';
const source = await fs.readFile(file, 'utf8');

const replaceOnce=(text,from,to,label)=>{
  if(!text.includes(from)) throw new Error(`Expected ${label} block was not found; refusing to patch crypto autopilot blindly.`);
  return text.replace(from,to);
};

let updated=source;

updated=replaceOnce(updated,
`            'client_order_id': str(uuid.uuid4()),`,
`            'client_order_id': f'teststock-{uuid.uuid4()}',`,
'client-order-id');

updated=replaceOnce(updated,
`        params = {'account_number': account_number, 'created_at_start': (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)).isoformat().replace('+00:00','Z')}`,
`        params = {'account_number': account_number, 'created_at_start': (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=180)).isoformat().replace('+00:00','Z')}`,
'crypto-order-history-window');

updated=replaceOnce(updated,
`def cancel_open_sells(api, account_number, symbol):\n    sell_orders = [o for o in api.orders(account_number, symbol) if o.get('side') == 'sell' and o.get('state') in {'open', 'pending'}]\n    for o in sell_orders:\n        api.cancel(o['id'])\n    if not sell_orders:\n        return True\n    deadline = time.time() + 12\n    while time.time() < deadline:\n        still = [o for o in api.orders(account_number, symbol) if o.get('side') == 'sell' and o.get('state') in {'open', 'pending'}]\n        if not still:\n            return True\n        time.sleep(2)\n    return False\n\n\ndef ensure_stop(api, account_number, symbol, qty, stop_price, pair):\n    existing = [o for o in api.orders(account_number, symbol) if o.get('side') == 'sell' and o.get('type') in {'stop_loss','stop_limit'} and o.get('state') in {'open','pending'}]\n`,
`def is_teststock_order(order):\n    return str(order.get('client_order_id') or '').startswith('teststock-')\n\n\ndef teststock_managed_quantity(api, account_number, symbol):\n    # Robinhood aggregates manual and automated crypto into one holding. Ownership is therefore\n    # reconstructed from Teststock-tagged confirmed fills rather than from the account's total asset\n    # quantity. This lets Teststock trade an asset the user already owns without claiming the manual lot.\n    managed = Decimal('0')\n    for order in api.orders(account_number, symbol):\n        if not is_teststock_order(order):\n            continue\n        if str(order.get('state') or '').lower() not in {'filled', 'partially_filled'}:\n            continue\n        filled = Decimal(str(order.get('filled_asset_quantity') or '0'))\n        if filled <= 0:\n            continue\n        managed += filled if order.get('side') == 'buy' else -filled\n    return max(Decimal('0'), managed)\n\n\ndef cancel_open_sells(api, account_number, symbol):\n    # Never cancel a user's manual sell/stop order. Only Teststock-tagged orders are ours to change.\n    sell_orders = [o for o in api.orders(account_number, symbol) if is_teststock_order(o) and o.get('side') == 'sell' and o.get('state') in {'open', 'pending'}]\n    for o in sell_orders:\n        api.cancel(o['id'])\n    if not sell_orders:\n        return True\n    deadline = time.time() + 12\n    while time.time() < deadline:\n        still = [o for o in api.orders(account_number, symbol) if is_teststock_order(o) and o.get('side') == 'sell' and o.get('state') in {'open', 'pending'}]\n        if not still:\n            return True\n        time.sleep(2)\n    return False\n\n\ndef ensure_stop(api, account_number, symbol, qty, stop_price, pair):\n    # A manual stop does not count as Teststock protection; conversely Teststock never cancels it.\n    existing = [o for o in api.orders(account_number, symbol) if is_teststock_order(o) and o.get('side') == 'sell' and o.get('type') in {'stop_loss','stop_limit'} and o.get('state') in {'open','pending'}]\n`,
'lot-ownership-helpers');

updated=replaceOnce(updated,
`        qty = Decimal(str((holding or {}).get('quantity_available_for_trading', '0')))\n        if qty <= 0:\n            upsert_watch(watch, {**active, 'status': 'CLOSED', 'closedAt': now_iso()})\n            write_json(WATCH, watch)\n            set_status('POSITION_CLOSED', f'{symbol} no longer has an available crypto holding; watchlist marked closed.')\n            return\n`,
`        qty = Decimal(str((holding or {}).get('quantity_available_for_trading', '0')))\n        managed_qty = min(qty, teststock_managed_quantity(api, account_number, symbol))\n        if managed_qty <= 0:\n            upsert_watch(watch, {**active, 'status': 'CLOSED', 'closedAt': now_iso(), 'closeReason': 'NO_TESTSTOCK_TAGGED_QUANTITY'})\n            write_json(WATCH, watch)\n            set_status('POSITION_CLOSED', f'{symbol} has no remaining Teststock-tagged crypto quantity; manual holdings, if any, were left untouched.')\n            return\n`,
'active-managed-quantity');

updated=updated
  .replaceAll("floor_increment(qty, pair.get('asset_increment') or '0.00000001')", "floor_increment(managed_qty, pair.get('asset_increment') or '0.00000001')")
  .replace("sell_qty = floor_increment(qty * Decimal('0.25'), pair.get('asset_increment') or '0.00000001')", "sell_qty = floor_increment(managed_qty * Decimal('0.25'), pair.get('asset_increment') or '0.00000001')")
  .replace("                sell_qty = floor_increment(qty, pair.get('asset_increment') or '0.00000001')", "                sell_qty = floor_increment(managed_qty, pair.get('asset_increment') or '0.00000001')")
  .replace("                ensure_stop(api, account_number, symbol, qty, stop, pair)", "                ensure_stop(api, account_number, symbol, managed_qty, stop, pair)")
  .replace("            remain = Decimal(str((h or {}).get('quantity_available_for_trading', '0')))\n            new_stop = max(stop, entry) if entry > 0 else stop\n            if remain > 0 and new_stop > 0:\n                ensure_stop(api, account_number, symbol, remain, new_stop, pair)", "            remain_total = Decimal(str((h or {}).get('quantity_available_for_trading', '0')))\n            remain = min(remain_total, teststock_managed_quantity(api, account_number, symbol))\n            new_stop = max(stop, entry) if entry > 0 else stop\n            if remain > 0 and new_stop > 0:\n                ensure_stop(api, account_number, symbol, remain, new_stop, pair)")
  .replace("            ensure_stop(api, account_number, symbol, qty, stop, pair)", "            ensure_stop(api, account_number, symbol, managed_qty, stop, pair)");

updated=replaceOnce(updated,
`    # No tracked crypto position: fail closed if the API account already holds crypto.\n    holdings = [h for h in api.holdings(account_number) if Decimal(str(h.get('quantity_available_for_trading', '0'))) > 0]\n    if holdings:\n        set_status('BLOCKED_UNTRACKED_HOLDING', 'Crypto exists in the configured account but is not in Teststock execution-watchlist; no new buy sent.')\n        return\n`,
`    # Manual/untracked crypto holdings do not block Teststock. Robinhood aggregates holdings, so\n    # Teststock ownership is isolated by tagged order history and every automated exit is capped to\n    # the net quantity created by Teststock-tagged fills. Manual quantities are never adopted.\n`,
'untracked-holding-global-block');

updated=replaceOnce(updated,
`        open_orders = [o for o in api.orders(account_number, symbol) if o.get('state') in {'open','pending'}]\n        if open_orders:\n            rejection_reasons.append(f'{symbol}: existing order')\n            continue\n`,
`        open_orders = [o for o in api.orders(account_number, symbol) if is_teststock_order(o) and o.get('state') in {'open','pending'}]\n        if open_orders:\n            rejection_reasons.append(f'{symbol}: existing Teststock order')\n            continue\n`,
'candidate-open-order-scope');

updated=replaceOnce(updated,
`        'brokerProtection': 'ROBINHOOD_CRYPTO_API_STOP_LOSS_GTC',\n        'admissionMode': 'SEED' if seed_mode else admission.get('state'),`,
`        'brokerProtection': 'ROBINHOOD_CRYPTO_API_STOP_LOSS_GTC',\n        'ownershipMode': 'TESTSTOCK_TAGGED_ORDER_LEDGER',\n        'manualHoldingsExcludedFromAutomation': True,\n        'admissionMode': 'SEED' if seed_mode else admission.get('state'),`,
'watch-ownership-metadata');

await fs.writeFile(file, updated);
console.log('Applied lot-aware crypto reconciliation: Teststock can trade assets already held manually, but buy/sell/stop ownership is isolated to Teststock-tagged fills and manual orders are never canceled.');
