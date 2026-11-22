import test from 'node:test';
import assert from 'node:assert/strict';
import {planOptionProfitExit} from './option-fast-profit-exit.mjs';
const base={entryAsk:.5,bid:.55,ask:.56,highestConfirmedBid:.55,quantity:1,quoteAgeMs:500,brokerPositionConfirmed:true,sessionOpen:true};
test('profitable executable bid triggers review, not order',()=>{
 const r=planOptionProfitExit(base);assert.equal(r.action,'EXIT_REVIEW_NOW');assert.equal(r.reason,'PROFIT_TARGET_AT_EXECUTABLE_BID');assert.equal(r.maySubmitOrder,false);
});
test('mid price does not substitute for executable bid',()=>{
 const r=planOptionProfitExit({...base,bid:.49,ask:.70,highestConfirmedBid:.49});assert.equal(r.action,'HOLD_AND_MONITOR');
});
test('existing exit or unverified broker position stops duplicates',()=>{
 assert.equal(planOptionProfitExit({...base,openExitOrder:true}).action,'RECONCILE_OR_WAIT');
 assert.equal(planOptionProfitExit({...base,brokerPositionConfirmed:false}).action,'RECONCILE_OR_WAIT');
});
test('stale quote and invalid market are rejected',()=>{
 assert.equal(planOptionProfitExit({...base,quoteAgeMs:6000}).action,'RECONCILE_OR_WAIT');
 assert.equal(planOptionProfitExit({...base,sessionOpen:false}).action,'RECONCILE_OR_WAIT');
});
test('high-water retracement triggers exit review after locking profit',()=>{
 const r=planOptionProfitExit({...base,bid:.55,highestConfirmedBid:.70});
 assert.equal(r.reason,'PROFIT_PROTECTION_RETRACEMENT');assert.ok(r.protectionFloorBid>.55);
});
test('fees must be covered before target review',()=>{
 const r=planOptionProfitExit({...base,knownExitFeesUsd:6});
 assert.equal(r.action,'HOLD_AND_MONITOR');
});
test('deadline outranks profit and loss',()=>{
 const r=planOptionProfitExit({...base,bid:.45,highestConfirmedBid:.45,sessionExitDeadline:true});
 assert.equal(r.reason,'SESSION_EXIT_DEADLINE');
});

test('higher executable bid updates high-water mark instead of rejecting quote',()=>{
 const r=planOptionProfitExit({...base,bid:.62,ask:.63,highestConfirmedBid:.55});
 assert.equal(r.highestConfirmedBid,.62);
 assert.equal(r.action,'EXIT_REVIEW_NOW');
});
