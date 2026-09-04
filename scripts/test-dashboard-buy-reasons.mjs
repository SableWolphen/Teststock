import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');

test('dashboard explains why stock and crypto candidates are not buying', () => {
  assert.match(dashboard, /function entryBoardItem\(assetClass,ticker\)/);
  assert.match(dashboard, /function buyDecision\(assetClass,x,blocked=false\)/);
  assert.match(dashboard, /Not buying because/);
  assert.match(dashboard, /The stock market is closed/);
  assert.match(dashboard, /outside the allowed entry range/);
  assert.match(dashboard, /buyDecision\('STOCK',x,blocked\)/);
  assert.match(dashboard, /buyDecision\('CRYPTO',lead,!c\)/);
});
