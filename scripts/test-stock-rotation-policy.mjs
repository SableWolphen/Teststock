import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const rules=await fs.readFile(new URL('./claude-stock-rotation-rules.md', import.meta.url),'utf8');
const runner=await fs.readFile(new URL('./run-live-intraday-cycle.sh', import.meta.url),'utf8');

test('stock rotation allows only one Teststock entry per ticker per New York trading day',()=>{
  assert.match(rules,/One automatic stock entry per ticker per New York trading day/i);
  assert.match(rules,/do not buy that ticker again that day/i);
  assert.match(rules,/next independently qualified stock candidate/i);
});

test('stock rotation never blocks exits and does not force a replacement trade',()=>{
  assert.match(rules,/Risk-reducing sells, profit-taking, protection repair, and forced exits are never blocked/i);
  assert.match(rules,/cash\/no-trade remains valid/i);
});

test('live Claude executor loads the stock rotation guard',()=>{
  assert.match(runner,/claude-stock-rotation-rules\.md/);
});
