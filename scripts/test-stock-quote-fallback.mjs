import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {selectStockQuotes} from './stock-quote-fallback.mjs';
import {cycle} from './windows-monitor.mjs';
const now=Date.parse('2026-10-16T14:00:00Z');
const quote={symbol:'SPY',bid:100,ask:101,bidAt:new Date(now).toISOString(),askAt:new Date(now).toISOString()};
test('fresh primary quotes skip backup; missing symbols alone fail over with provenance',async()=>{
 let called=false;const first=await selectStockQuotes({symbols:['SPY'],now,primary:async()=>[quote],secondary:async()=>{called=true;return[];}});assert.equal(called,false);assert.equal(first.quotes[0].source,'ROBINHOOD');
 const second=await selectStockQuotes({symbols:['SPY','QQQ'],now,primary:async()=>[quote],secondary:async needed=>{assert.deepEqual(needed,['QQQ']);return[{...quote,symbol:'QQQ'}];}});assert.equal(second.complete,true);assert.equal(second.quotes[1].source,'ALPACA_IEX');assert.equal(second.executionAuthorized,false);
});
test('source failure falls back; stale, future, crossed and duplicated backup quotes stay missing',async()=>{
 for(const rows of [[{...quote,bidAt:'2020-01-01'}],[{...quote,askAt:new Date(now+60000).toISOString()}],[{...quote,bid:102}],[quote,quote]]) {
  const result=await selectStockQuotes({symbols:['SPY'],now,primary:async()=>{throw Error('secret');},secondary:async()=>rows});assert.equal(result.complete,false);assert.deepEqual(result.missing,['SPY']);assert.doesNotMatch(JSON.stringify(result),/secret/);
 }
 const result=await selectStockQuotes({symbols:['SPY'],now,primary:async()=>{throw Error();},secondary:async()=>[quote]});assert.equal(result.complete,true);
});
test('successful fallback never clears a disconnected broker or grants trading authority',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fallback-cycle-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const status=await cycle({root,symbols:['SPY'],now,fallbackReader:async()=>[quote]});assert.equal(status.marketData.complete,true);assert.equal(status.brokerConnected,false);assert.equal(status.health,'BLOCKED');assert.equal(status.liveEnabled,false);assert.equal(status.tradingReady,false);
});
