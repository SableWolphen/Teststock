import test from 'node:test';import assert from 'node:assert/strict';import {assessExecution} from './execution-safety.mjs';
const caps={mode:'MANUAL_ONLY_FAIL_CLOSED',liveOrderSubmission:false};

test('unknown and in-flight close states prevent duplicate exit proposals',()=>{
 for(const state of ['new','unconfirmed','pending_cancelled','pending_replace','unexpected']){
  const r=assessExecution({capabilities:caps,positions:[{option_id:'a'}],orders:[{state,legs:[{option_id:'a',position_effect:'close'}]}],now:'2026-10-19T15:00:00Z'});
  assert.deepEqual(r.actions.map(a=>a.kind),['RECONCILE_EXISTING_EXIT']);
 }
});
test('old, future or undated positive bids are not executable exit evidence',()=>{
 for(const updated_at of ['2026-10-16T19:59:59Z','2026-10-19T15:01:00Z',undefined]){
  const r=assessExecution({capabilities:caps,positions:[{option_id:'a'}],quotes:[{instrument_id:'a',bid_price:'0.67',updated_at}],now:'2026-10-19T15:00:00Z'});
  assert.deepEqual(r.actions.map(a=>a.kind),['STALE_EXIT_QUOTE']);
 }
});
test('blocks live entries without verified exits',()=>{const r=assessExecution({capabilities:caps,account:{buyingPower:20}});assert.equal(r.allowNewOrders,false);assert.ok(r.blockers.includes('LIVE_EXECUTION_NOT_VERIFIED'))});
test('reconciles existing close before any duplicate action',()=>{const r=assessExecution({capabilities:caps,account:{buyingPower:0},positions:[{option_id:'a',chain_symbol:'NOK',expiration_date:'2026-10-16'}],orders:[{state:'queued',legs:[{option_id:'a',position_effect:'close'}]}],now:'2026-10-16T14:00:00Z'});assert.deepEqual(r.actions.map(a=>a.kind),['RECONCILE_EXISTING_EXIT'])});
test('flags expiring unquoted options',()=>{const r=assessExecution({capabilities:caps,account:{buyingPower:0},positions:[{option_id:'a',chain_symbol:'NOK',expiration_date:'2026-10-16'}],now:'2026-10-16T14:00:00Z'});assert.deepEqual(r.actions.map(a=>a.kind),['URGENT_EXPIRATION_REVIEW','NO_EXECUTABLE_BID'])});

test('affirmative capability data cannot bypass the canonical execution lock',()=>{
 const capabilities={mode:'LIVE_VERIFIED',liveOrderSubmission:true,liveEquityExitSubmission:true,liveOptionExitSubmission:true,liveOptionExitVerifiedThisSession:true};
 const result=assessExecution({capabilities,account:{buyingPower:100}});assert.equal(result.allowNewOrders,false);assert.ok(result.blockers.includes('LIVE_DEPLOYMENT_LOCKED'));
});
