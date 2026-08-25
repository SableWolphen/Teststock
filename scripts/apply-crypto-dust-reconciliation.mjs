import fs from 'node:fs/promises';

const file = 'scripts/robinhood_crypto_autopilot.py';
const source = await fs.readFile(file, 'utf8');

const oldBlock = `    # No tracked crypto position: fail closed if the API account already holds crypto.\n    holdings = [h for h in api.holdings(account_number) if Decimal(str(h.get('quantity_available_for_trading', '0'))) > 0]\n    if holdings:\n        set_status('BLOCKED_UNTRACKED_HOLDING', 'Crypto exists in the configured account but is not in Teststock execution-watchlist; no new buy sent.')\n        return\n`;

const newBlock = `    # No tracked crypto position: ignore only immaterial crypto dust; fail closed on any meaningful\n    # or unpriceable unknown holding. This avoids tiny post-fill residuals freezing the autopilot while\n    # preserving the core rule that Teststock must never silently adopt, sell, or trade around a real\n    # manual/untracked position. The public status exposes counts only, never balances or quantities.\n    dust_limit_usd = Decimal(os.getenv('ROBINHOOD_CRYPTO_DUST_USD', '1.00'))\n    if dust_limit_usd < 0 or dust_limit_usd > Decimal('1.00'):\n        dust_limit_usd = Decimal('1.00')\n    unknown_holdings = [h for h in api.holdings(account_number) if Decimal(str(h.get('quantity_available_for_trading', '0'))) > 0]\n    meaningful_unknown = []\n    ignored_dust = 0\n    for h in unknown_holdings:\n        asset = str(h.get('asset_code') or '').strip().upper()\n        qty = Decimal(str(h.get('quantity_available_for_trading', '0') or '0'))\n        if not asset or qty <= 0:\n            continue\n        symbol = f'{asset}-USD'\n        try:\n            pair_rows = api.pairs(symbol)\n            pair = pair_rows[0] if pair_rows else None\n            quote = api.quote(symbol) if pair and pair.get('is_api_tradable') else None\n            bid = Decimal(str((quote or {}).get('bid') or '0'))\n            usd_value = qty * bid if bid > 0 else None\n        except Exception:\n            usd_value = None\n        if usd_value is not None and usd_value <= dust_limit_usd:\n            ignored_dust += 1\n            continue\n        meaningful_unknown.append(asset)\n    if meaningful_unknown:\n        set_status(\n            'BLOCKED_UNTRACKED_HOLDING',\n            'A meaningful or unpriceable crypto holding exists in the configured account but is not in Teststock execution-watchlist; no new buy sent.',\n            untrackedHoldingCount=len(meaningful_unknown),\n            ignoredDustCount=ignored_dust,\n            dustThresholdUsd=float(dust_limit_usd),\n        )\n        return\n`;

if (!source.includes(oldBlock)) {
  throw new Error('Expected untracked-holding block was not found; refusing to patch crypto autopilot blindly.');
}

const updated = source.replace(oldBlock, newBlock);
await fs.writeFile(file, updated);
console.log('Applied conservative crypto dust reconciliation: <= $1 ignored; meaningful/unpriceable holdings still block new buys.');
