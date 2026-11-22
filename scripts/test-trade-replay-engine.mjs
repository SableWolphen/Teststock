import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateTradeReplay,loadReplayBars} from './trade-replay-engine.mjs';
const start=Date.parse('2026-10-01T14:00:00Z');
const trade={actualAverageEntry:100,plannedStop:95,actualAverageExit:null,realizedR:-1,entryFilledAt:new Date(start).toISOString(),finalExitAt:new Date(start+3600000).toISOString()};
const bar=(minute,c=101)=>({t:new Date(start+minute*60000).toISOString(),h:c+1,l:c-1,c});

test('elapsed timestamps determine exit horizons and MFE timing',()=>{
  const r=calculateTradeReplay(trade,[bar(29,110),bar(14,105),bar(0,101)]);
  assert.equal(r.alternativeExits.exit15mR,1);
  assert.equal(r.alternativeExits.exit30mR,2);
  assert.equal(r.alternativeExits.exit60mR,null);
  assert.equal(r.minutesToMFE,30);
  assert.equal(r.edgeDecayMinutes,null);
  assert.equal(r.alternativeExits.actualExitR,-1,'missing actual exit must not turn into a zero price');
});
test('short history never masquerades as a later exit',()=>{
  const r=calculateTradeReplay({...trade,realizedR:null},[bar(0),bar(1)]);
  assert.deepEqual(r.alternativeExits,{exit15mR:null,exit30mR:null,exit60mR:null,actualExitR:null});
});
test('pre-fill intervals, invalid prices and post-exit bars cannot alter replay',()=>{
  const t={...trade,entryFilledAt:new Date(start+30000).toISOString()};
  const r=calculateTradeReplay(t,[bar(0,1000),bar(1,101),bar(1,999),bar(60,1000),{...bar(2),h:null}]);
  assert.equal(r.barCount,1);assert.equal(r.maximumFavorableExcursionR,.4);
  assert.equal(calculateTradeReplay({...trade,plannedStop:null},[bar(1)]),null);
});

test('replay follows every provider page and rejects truncated or repeated tokens',async()=>{
  const calls=[];
  const bars=await loadReplayBars(async url=>{
    calls.push(url);
    return calls.length===1?{bars:{ABC:[bar(0)]},next_page_token:'next'}:{bars:{ABC:[bar(14)]}};
  },'https://example.test/bars?symbols=ABC','ABC');
  assert.equal(bars.length,2);assert.equal(new URL(calls[1]).searchParams.get('page_token'),'next');
  await assert.rejects(loadReplayBars(async()=>({bars:[],next_page_token:'same'}),'https://example.test/bars','ABC'),/PAGINATION_INVALID/);
  await assert.rejects(loadReplayBars(async()=>({bars:[],next_page_token:'more'}),'https://example.test/bars','ABC',1),/HISTORY_INCOMPLETE/);
});
