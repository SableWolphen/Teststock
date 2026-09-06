import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const src=await fs.readFile(new URL('./claude-trade-quality-rules.md',import.meta.url),'utf8');
const engine=await fs.readFile(new URL('./build-trade-quality-engine.mjs',import.meta.url),'utf8');
const replay=await fs.readFile(new URL('./build-trade-replay.mjs',import.meta.url),'utf8');
test('new risk fails closed on stale or broker mismatch',()=>{assert.match(src,/STOP_NEW_RISK/);assert.match(src,/brokerWatchdog/);assert.match(src,/mismatch between repository state and Robinhood/);});
test('hypothetical outcomes never become real PnL',()=>{assert.match(src,/Never count hypothetical trades as fills or PnL/);assert.match(replay,/RESEARCH_ONLY/);assert.match(replay,/do not rewrite real broker fills or PnL/);});
test('learning cannot increase hard risk ceiling',()=>{assert.match(engine,/never increase hard risk ceilings/i);assert.match(src,/never create eligibility, increase hard risk ceilings/i);});
test('chaos conditions include broker ambiguity and partial fills',()=>{assert.match(engine,/ambiguous order submission/);assert.match(engine,/partial fill/);assert.match(engine,/runner restart mid-order/);});
test('trade count is not the optimization target',()=>{assert.match(engine,/not trade count/);assert.match(src,/not number of trades/);});
