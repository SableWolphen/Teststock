import test from 'node:test';import assert from 'node:assert/strict';import {buildRiskSnapshot} from './risk-snapshot.mjs';
test('pending exit is reconciled without duplicate placement',()=>{
 const r=buildRiskSnapshot({now:'2026-10-16T15:00:00Z',positions:[{option_id:'a',chain_symbol:'NOK',quantity:'2',pending_sell_quantity:'2',expiration_date:'2026-10-16'}],orders:[{state:'queued',legs:[{option_id:'a',position_effect:'close'}]}],quotes:[{instrument_id:'a',bid_price:'0',updated_at:'2026-10-15T15:00:00Z'}],account:{buyingPower:0},capabilities:{}});
 assert.equal(r.liveOrderSubmissionAuthorized,false);assert.equal(r.activeOrderCount,1);assert.ok(r.issues.some(x=>x.code==='EXPIRATION_TODAY_OR_PAST'));assert.ok(r.issues.some(x=>x.code==='STALE_OPTION_QUOTE'));assert.ok(r.actions.some(x=>x.kind==='RECONCILE_EXISTING_EXIT'));
});
test('no order is authorized even with nominal live capabilities',()=>{const r=buildRiskSnapshot({account:{buyingPower:100},capabilities:{mode:'LIVE_VERIFIED',liveOrderSubmission:true,liveEquityExitSubmission:true,liveOptionExitSubmission:true,liveOptionExitVerifiedThisSession:true}});assert.equal(r.allowNewOrders,false)});
