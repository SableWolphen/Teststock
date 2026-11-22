import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceOptionExitWatch} from './option-exit-watch-state.mjs';
const position={contractId:'test-option-contract',confirmedEntryAsk:.5,confirmedOpenQuantity:1,brokerConfirmed:true,workingExitOrder:false};
const session={open:true};
const tick=(bid,observedAt)=>({bid,ask:bid+.01,observedAt});
const t=Date.parse('2026-11-20T16:00:00.000Z');
test('high-water advances on confirmed fresh price events',()=>{
 const a=advanceOptionExitWatch({position,session,quote:tick(.48,new Date(t).toISOString()),now:t+100});
 const b=advanceOptionExitWatch({previous:a.state,position,session,quote:tick(.52,new Date(t+500).toISOString()),now:t+600});
 assert.equal(b.state.highestConfirmedBid,.52);
});
test('profit exit review fires once without broker writes',()=>{
 const a=advanceOptionExitWatch({position,session,quote:tick(.56,new Date(t).toISOString()),now:t+100});
 assert.equal(a.packet.reason,'PROFIT_TARGET_AT_EXECUTABLE_BID');
 assert.equal(a.packet.brokerWriteAuthorized,false);
 const b=advanceOptionExitWatch({previous:a.state,position,session,quote:tick(.57,new Date(t+500).toISOString()),now:t+600});
 assert.equal(b.packet,null);
 assert.equal(b.reason,'EXIT_REVIEW_ALREADY_RAISED');
});
test('stale quotes, out-of-order ticks, and working exits fail closed',()=>{
 const a=advanceOptionExitWatch({position,session,quote:tick(.48,new Date(t).toISOString()),now:t+100});
 assert.equal(advanceOptionExitWatch({previous:a.state,position,session,quote:tick(.60,new Date(t).toISOString()),now:t+200}).packet,null);
 assert.equal(advanceOptionExitWatch({previous:a.state,position,session,quote:tick(.60,new Date(t+600).toISOString()),now:t+10000}).packet,null);
 assert.equal(advanceOptionExitWatch({previous:a.state,position:{...position,workingExitOrder:true},session,quote:tick(.60,new Date(t+600).toISOString()),now:t+700}).packet,null);
});
