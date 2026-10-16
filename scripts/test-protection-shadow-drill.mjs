import test from 'node:test';
import assert from 'node:assert/strict';
import {protectionDrill} from './protection-shadow-drill.mjs';
const now=Date.parse('2026-10-16T14:00:00Z');
const session={regularHours:true,date:'2026-10-16'};
const position={symbol:'FIXTURE',quantity:2,observedAt:new Date(now).toISOString()};
const protectiveOrder={id:'stop-fixture',symbol:'FIXTURE',side:'sell',type:'stop_market',quantity:2,filledQuantity:0,marketHours:'regular_hours',stopPrice:90,state:'confirmed',timeInForce:'gfd',sessionDate:session.date,observedAt:new Date(now).toISOString()};
const run=patch=>protectionDrill({position,protectiveOrder,session,now,...patch});
test('confirmed matching stop is shadow coverage only, never new-entry permission',()=>{const r=run();assert.equal(r.protectionOrderVerified,true);assert.equal(r.brokerWrites,false);assert.equal(r.liveEnabled,false);assert.equal(r.allowNewEntries,false);});
test('partial entry protects only broker-confirmed shares, not requested quantity',()=>{const r=run({entry:{state:'partially_filled',requestedQuantity:10},protectiveOrder:{...protectiveOrder,quantity:10}});assert.equal(r.action,'REPAIR_PROTECTION_REVIEW');assert.equal(r.confirmedQuantityToProtect,2);});
test('ambiguous entry always reconciles the original id instead of replacing it',()=>{const r=run({entry:{submission:'AMBIGUOUS',clientOrderId:'original'}});assert.equal(r.action,'RECONCILE_ORIGINAL_CLIENT_ID');assert.equal(r.clientOrderId,'original');});
test('queued and pending-cancel exits suppress duplicate exits',()=>{for(const state of ['queued','partially_filled','pending_cancelled'])assert.equal(run({exitOrder:{state}}).action,'RECONCILE_EXISTING_EXIT');});
test('queued/rejected/partial protection is not active full coverage',()=>{for(const state of ['queued','rejected','partially_filled'])assert.equal(run({protectiveOrder:{...protectiveOrder,state}}).protectionOrderVerified,false);});
test('failure or absence of protection is escalated without creating an order',()=>{const r=run({protectiveOrder:null});assert.equal(r.action,'PROTECTION_REVIEW_REQUIRED');assert.equal(r.brokerWrites,false);assert.equal(run({position:{...position,quantity:0.5}}).action,'ESCALATE_UNSUPPORTED_PROTECTION');});
test('after-hours, expired GFD, stale quotes/order state and symbol mismatches fail coverage',()=>{
 for(const patch of [{session:{regularHours:false}},{protectiveOrder:{...protectiveOrder,sessionDate:'2026-10-15'}},{protectiveOrder:{...protectiveOrder,observedAt:'2020-01-01'}},{protectiveOrder:{...protectiveOrder,symbol:'OTHER'}},{position:{...position,observedAt:'2020-01-01'}}]) assert.equal(run(patch).protectionOrderVerified,false);
});
test('flat account never invents an exit fill, and orphan sell orders require review',()=>{const r=run({position:{...position,quantity:0},protectiveOrder:null});assert.equal(r.action,'FLAT_VERIFIED');assert.equal(r.realizedPnl,undefined);assert.equal(run({position:{...position,quantity:0}}).action,'REVIEW_ORPHAN_PROTECTION');});

test('remaining protective quantity and session scope must be explicit',()=>{
 for(const patch of [{filledQuantity:undefined},{filledQuantity:1},{marketHours:'extended_hours'},{type:'unsupported'}]) assert.equal(run({protectiveOrder:{...protectiveOrder,...patch}}).protectionOrderVerified,false);
});
