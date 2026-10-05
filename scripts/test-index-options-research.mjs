import assert from 'node:assert/strict';
import test from 'node:test';
import {buildIndexOptionsResearch} from './index-options-research-engine.mjs';

test('builds separate XND and DJX broker-resolved research rows from QQQ/DIA proxies',()=>{
  const out=buildIndexOptionsResearch({generatedAt:'2026-10-05T17:00:00Z',optionsScan:{
    generatedAt:'2026-10-05T16:55:00Z',
    indexEtfResearch:[
      {symbol:'QQQ',price:610,optionBias:'BULLISH',score:91},
      {symbol:'DIA',price:480,optionBias:'BEARISH',score:84},
    ],
  }});
  assert.deepEqual(out.indexes,['XND','DJX']);
  const xnd=out.candidates.find(x=>x.indexSymbol==='XND');
  const djx=out.candidates.find(x=>x.indexSymbol==='DJX');
  assert.equal(xnd.proxySymbol,'QQQ');
  assert.deepEqual(xnd.brokerResolution.allowedKinds,['LONG_CALL']);
  assert.equal(xnd.settlement.cashSettled,true);
  assert.equal(xnd.settlement.earlyAssignmentRisk,false);
  assert.equal(xnd.settlement.settlementWindow,'PM');
  assert.equal(djx.proxySymbol,'DIA');
  assert.deepEqual(djx.brokerResolution.allowedKinds,['LONG_PUT']);
  assert.equal(djx.settlement.settleOnOpen,true);
  assert.equal(djx.liveExecutionEligible,false);
  assert.equal(djx.taxContext.affectsEligibility,false);
});

test('mixed/unknown proxy never creates a tradable index-option direction',()=>{
  const out=buildIndexOptionsResearch({optionsScan:{indexEtfResearch:[{symbol:'QQQ',optionBias:'MIXED'}]}});
  const xnd=out.candidates.find(x=>x.indexSymbol==='XND');
  assert.equal(xnd.researchStatus,'WAIT_PROXY_DIRECTION');
  assert.deepEqual(xnd.brokerResolution.allowedKinds,[]);
  assert.equal(xnd.liveExecutionEligible,false);
});
