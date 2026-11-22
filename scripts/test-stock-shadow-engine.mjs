import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStockShadowTrade,netShadowResult,eligibleStockShadowEvidence,sameSessionOutcome} from './stock-shadow-engine.mjs';
const now=Date.parse('2026-11-22T18:00:00Z');
const trade={status:'OPEN',decision:'ACCEPTED',createdDate:'2026-09-01',entry:100,stop:95,target2:110};
const bar=(date,o,h,l,c)=>({t:`${date}T04:00:00Z`,o,h,l,c});

test('paper gains include spread/slippage assumptions and cost sensitivity',()=>{
  const r=resolveStockShadowTrade(trade,[bar('2026-09-02',100,104,99,103),bar('2026-09-03',104,111,103,110)],now);
  assert.equal(r.status,'RESOLVED');assert.equal(r.grossRealizedR,2);
  assert.ok(Math.abs(r.realizedR-1.958)<1e-10);assert.equal(r.afterCosts,true);
  assert.equal(r.costModel.brokerVerified,false);assert.equal(r.timeHorizon,'SWING_20_SESSIONS');
  assert.ok(r.costSensitivity['20BPS_PER_SIDE']<r.costSensitivity['5BPS_PER_SIDE']);
});
test('a gross scratch is a net loss and gap losses can exceed one R',()=>{
  assert.ok(netShadowResult(100,100,95).realizedR<0);
  const r=resolveStockShadowTrade(trade,[bar('2026-09-02',100,104,99,103),bar('2026-09-03',90,94,88,92)],now);
  assert.equal(r.exitReason,'STOP_GAP');assert.equal(r.grossRealizedR,-2);assert.ok(r.realizedR<-2);
});
test('unknown daily ordering never fabricates a winning fill',()=>{
  for(const b of [bar('2026-09-02',100,111,99,110),bar('2026-09-02',100,111,94,101)]) {
    const r=resolveStockShadowTrade(trade,[b],now);assert.equal(r.status,'AMBIGUOUS');assert.equal(r.realizedR,null);
  }
});
test('incomplete, missing and future daily bars do not resolve paper trades',()=>{
  const xs=[bar('2026-09-02',100,104,99,102),bar('2026-11-22',100,120,90,110),{...bar('2026-09-03',100,120,90,110),o:null}];
  assert.equal(resolveStockShadowTrade(trade,xs,now).status,'OPEN');
  assert.equal(resolveStockShadowTrade({...trade,stop:null},xs,now).status,'UNKNOWN');
});
test('daily evidence cannot qualify a same-session strategy; legacy gross outcomes cannot qualify either',()=>{
  const r=resolveStockShadowTrade(trade,[bar('2026-09-02',100,104,99,103),bar('2026-09-03',104,111,103,110)],now);
  assert.equal(eligibleStockShadowEvidence(r),true);
  assert.equal(eligibleStockShadowEvidence(r,{intradayOnly:true}),false);
  assert.equal(eligibleStockShadowEvidence({...r,afterCosts:undefined}),false);
  assert.equal(eligibleStockShadowEvidence({...r,transactionCostR:0}),false);
  const intraday={...r,timeHorizon:'INTRADAY',entryFilledAt:'2026-09-02T14:00:00Z',resolvedAt:'2026-09-02T15:00:00Z'};
  assert.equal(eligibleStockShadowEvidence(intraday,{intradayOnly:true}),true);
  assert.equal(sameSessionOutcome('2026-09-02','2026-09-02'),false);
  assert.equal(sameSessionOutcome('2026-09-02T19:00:00Z','2026-09-03T14:00:00Z'),false);
});
