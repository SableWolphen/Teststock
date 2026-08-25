import fs from 'node:fs/promises';

const file = 'scripts/robinhood_crypto_autopilot.py';
const source = await fs.readFile(file, 'utf8');

const oldBlock = `    # No tracked crypto position: fail closed if the API account already holds crypto.\n    holdings = [h for h in api.holdings(account_number) if Decimal(str(h.get('quantity_available_for_trading', '0'))) > 0]\n    if holdings:\n        set_status('BLOCKED_UNTRACKED_HOLDING', 'Crypto exists in the configured account but is not in Teststock execution-watchlist; no new buy sent.')\n        return\n`;

const newBlock = `    # Existing manual/untracked crypto must not freeze the entire autopilot. Keep a symbol-level\n    # exclusion instead: Teststock may open a different qualified crypto asset, but it must not add\n    # to or manage an untracked asset because broker holdings are aggregated and an exit could\n    # otherwise sell the user's manual quantity too.\n    untracked_holdings = [h for h in api.holdings(account_number) if Decimal(str(h.get('quantity_available_for_trading', '0'))) > 0]\n    untracked_assets = {str(h.get('asset_code') or '').strip().upper() for h in untracked_holdings if str(h.get('asset_code') or '').strip()}\n`;

const selectNeedle = `        symbol = str(candidate['symbol']).replace('/', '-')\n        if grade not in {'A', 'A+'}:`;
const selectReplacement = `        symbol = str(candidate['symbol']).replace('/', '-')\n        if symbol.split('-')[0].upper() in untracked_assets:\n            rejection_reasons.append(f'{symbol}: existing manual/untracked holding')\n            continue\n        if grade not in {'A', 'A+'}:`;

if (!source.includes(oldBlock)) {
  throw new Error('Expected untracked-holding block was not found; refusing to patch crypto autopilot blindly.');
}
if (!source.includes(selectNeedle)) {
  throw new Error('Expected crypto candidate-selection block was not found; refusing to patch blindly.');
}

const updated = source.replace(oldBlock, newBlock).replace(selectNeedle, selectReplacement);
await fs.writeFile(file, updated);
console.log('Applied nonblocking crypto reconciliation: untracked holdings no longer freeze other crypto trades; their own symbols remain excluded from Teststock automation.');
