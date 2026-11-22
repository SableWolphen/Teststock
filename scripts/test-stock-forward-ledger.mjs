import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceStockForwardLedger,FORWARD_POLICY} from './stock-forward-ledger.mjs';
import {eligibleStockShadowEvidence} from './stock-shadow-engine.mjs';
import fs from 'node:fs';
const start=Date.parse('2026-10-16T14:30:00Z'),stamp=t=>new Date(t).toISOString();
function candidate(now,symbol='SPY',bid=99.98,ask=100) {
  return {symbol,asset:'stock',feed:'iex',bid,ask,quoteAsOf:stamp(now),status:'WATCH',liveEligible:false,
    signal:{confirmed:true,breakout:true,volumeRatio:3,priorHigh:99.8,barAsOf:stamp(now-60000)}};
}
function report(now,rows=[candidate(now)]) {
  return {generatedAt:stamp(now),mode:'RESEARCH_ONLY',liveOrdersEnabled:false,candidates:rows,lanes:{session:'OPEN',stock:'COMPLETE'},
    macro:{status:'CLEAR'},session:{source:'ALPACA_CLOCK',asOf:stamp(now),isOpen:true,closeAt:'2026-10-16T20:00:00Z'}};
}
test('forward collection starts empty and cannot fabricate historical trades',()=>{
  const state=advanceStockForwardLedger(null,report(start),start);
  assert.equal(state.trades.length,1);assert.equal(state.trades[0].status,'OPEN');
  assert.equal(state.trades[0].entry,100);assert.equal(state.summary.independentResolvedTrades,0);
  assert.equal(state.liveOrdersEnabled,false);assert.equal(state.trades[0].brokerVerified,false);
  assert.equal(advanceStockForwardLedger(state,report(start),start),state,'same report is idempotent');
});
test('ask-entry/bid-exit results include additional slippage, and rejected candidates still get exits',()=>{
  const state=advanceStockForwardLedger(null,report(start),start),later=start+300000;
  const next=advanceStockForwardLedger(state,report(later,[{...candidate(later,'SPY',101.5,101.52),status:'REJECTED'}]),later);
  const t=next.trades[0];assert.equal(t.status,'RESOLVED');assert.equal(t.exitReason,'TARGET');
  assert.equal(t.modelExitPrice,101.5);assert.ok(t.realizedR<t.grossRealizedR);
  assert.equal(eligibleStockShadowEvidence(t,{intradayOnly:true}),true);
  assert.equal(next.summary.independentResolvedTrades,1);assert.equal(next.summary.distinctTradingDays,1);
  assert.equal(state.trades[0].status,'OPEN','previous observation stays immutable');
});
test('gaps through a stop are charged at the observed bid, not clipped at one R',()=>{
  const s=advanceStockForwardLedger(null,report(start),start),later=start+300000;
  const next=advanceStockForwardLedger(s,report(later,[candidate(later,'SPY',98,98.02)]),later);
  assert.equal(next.trades[0].exitReason,'STOP');assert.ok(next.trades[0].realizedR<-1);
});
test('monitoring gaps and missing session exits cannot become admission proof',()=>{
  const s=advanceStockForwardLedger(null,report(start),start),later=start+FORWARD_POLICY.maxObservationGapMs+1;
  const gap=advanceStockForwardLedger(s,report(later,[candidate(later,'SPY',102,102.02)]),later);
  assert.equal(gap.trades[0].status,'RESOLVED');assert.equal(gap.trades[0].evidenceEligible,false);
  assert.equal(gap.summary.independentResolvedTrades,0);
  const nextDay=Date.parse('2026-10-19T14:30:00Z');
  const invalid=advanceStockForwardLedger(s,{...report(nextDay,[]),session:{...report(nextDay).session,closeAt:'2026-10-19T20:00:00Z'}},nextDay);
  assert.equal(invalid.trades[0].status,'INVALIDATED');assert.equal(invalid.trades[0].realizedR,null);
});
test('bad sessions, incomplete data, wide spreads, weak volume and chasing cannot open papers',()=>{
  const baseline=report(start);
  for(const r of [{...baseline,session:{}},{...baseline,macro:{status:'UNVERIFIED'}},{...baseline,lanes:{session:'OPEN',stock:'DATA_UNAVAILABLE_OR_INCOMPLETE'}},
    report(start,[candidate(start,'SPY',95,100)]),report(start,[candidate(start,'SPY',102,102.02)]),
    report(start,[{...candidate(start),signal:{...candidate(start).signal,volumeRatio:1}}]),
    report(start,[{...candidate(start),quoteAsOf:stamp(start-120001)}])]) assert.equal(advanceStockForwardLedger(null,r,start).trades.length,0);
});
test('one symbol per session and two entries per session cap correlated sample inflation',()=>{
  const s=advanceStockForwardLedger(null,report(start,[candidate(start),candidate(start,'QQQ'),candidate(start,'NVDA')]),start);
  assert.equal(s.trades.length,2);
  const later=start+300000,r=report(later,[candidate(later,'SPY',102,102.02),candidate(later,'QQQ',102,102.02),candidate(later,'NVDA')]);
  assert.equal(advanceStockForwardLedger(s,r,later).trades.length,2);
});
test('observed exits flatten before the authoritative close, including early closes',()=>{
  const at=Date.parse('2026-10-16T16:35:00Z'),closeAt='2026-10-16T17:00:00Z';
  const r=now=>({...report(now),session:{...report(now).session,closeAt}});
  let state=advanceStockForwardLedger(null,r(at),at);
  for(let i=1;i<=3;i++)state=advanceStockForwardLedger(state,r(at+i*300000),at+i*300000);
  assert.equal(state.trades[0].exitReason,'SESSION_EXIT');assert.equal(state.trades[0].status,'RESOLVED');
  assert.equal(state.summary.openTrades,0);
  assert.equal(advanceStockForwardLedger(null,r(at+15*60000),at+15*60000).trades.length,0,'no new entries near close');
});
test('malformed persisted state fails instead of resetting evidence',()=>{
  assert.throws(()=>advanceStockForwardLedger({},report(start),start),/LEDGER_INVALID/);
  assert.throws(()=>advanceStockForwardLedger({schemaVersion:1,trades:[{id:'bad',status:'OPEN'}]},report(start),start),/OPEN_TRADE_INVALID/);
});
test('scheduled publication persists this ledger without broker credentials or order authority',()=>{
  const workflow=fs.readFileSync('.github/workflows/trading_bot.yml','utf8');
  assert.ok(workflow.includes('advanceStockForwardLedger(ledger, report)'));
  assert.ok(workflow.includes("const ledgerPath = 'docs/data/stock-intraday-forward.json'"));
  assert.ok(!/ROBINHOOD|OPENAI_API_KEY/.test(workflow));
});
