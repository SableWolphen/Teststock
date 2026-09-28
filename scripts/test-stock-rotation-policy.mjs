import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const rules=await fs.readFile(new URL('./chatgpt-stock-rotation-rules.md', import.meta.url),'utf8');
const executor=await fs.readFile(new URL('./chatgpt-executor.mjs', import.meta.url),'utf8');

test('stock rotation allows only one Teststock entry per ticker per New York trading day',()=>{
  assert.match(rules,/One automatic stock entry per ticker per New York trading day/i);
  assert.match(rules,/do not buy that ticker again that day/i);
  assert.match(rules,/next independently qualified stock candidate/i);
});

test('stock rotation never blocks exits and does not force a replacement trade',()=>{
  assert.match(rules,/Risk-reducing sells, profit-taking, protection repair, and forced exits are never blocked/i);
  assert.match(rules,/cash\/no-trade remains valid/i);
});

test('live ChatGPT executor loads the stock rotation guard',()=>{
  assert.match(executor,/chatgpt-stock-rotation-rules\.md/);
});
