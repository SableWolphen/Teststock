// Deterministic integration drill. All symbols, orders, fills and prices are fixtures.
// No broker transport or credentials are accepted by this module.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {describeOrders} from './monitor-reconciliation.mjs';
import {protectionDrill} from './protection-shadow-drill.mjs';
import {evaluateTradingReadiness} from './trading-readiness.mjs';
export function replayCycle() {
 const at='2026-10-16T14:00:00Z',now=Date.parse(at),symbol='FIXTURE';
 const session={regularHours:true,date:'2026-10-16'},steps=[];
 const record=(stage,result)=>steps.push({stage,result});
 const fill=(id,quantity,price)=>({id,quantity:String(quantity),price:String(price),timestamp:at});
 const order={id:'fixture-entry',symbol,side:'buy',state:'confirmed',quantity:'2',cumulative_quantity:'0',executions:[]};
 const position=quantity=>({symbol,quantity,observedAt:at});
 const drill=(quantity,patch={})=>protectionDrill({position:position(quantity),session,now,...patch});
 const ready=evaluateTradingReadiness({now});assert.equal(ready.stockReady,false);
 record('REAL_ENTRY_GATE',ready.mode);
 let ledger=describeOrders([order],[]);assert.equal(ledger.fills.length,0);
 record('SIMULATED_ENTRY_ACK','NO_FILL_INFERRED');
 const ambiguous=drill(0,{entry:{submission:'AMBIGUOUS',clientOrderId:order.id}});
 assert.equal(ambiguous.action,'RECONCILE_ORIGINAL_CLIENT_ID');record('AMBIGUOUS_ACK',ambiguous.action);
 const partial={...order,state:'partially_filled',cumulative_quantity:'1',executions:[fill('fixture-entry-fill',1,100)]};
 ledger=describeOrders([partial],[]);assert.equal(ledger.orders[0].confirmedFilledQuantity,1);assert.deepEqual(ledger.issues,[]);
 const missing=drill(1);assert.equal(missing.action,'PROTECTION_REVIEW_REQUIRED');record('PARTIAL_FILL',missing.action);
 const stop={id:'fixture-stop',symbol,side:'sell',type:'stop_market',quantity:1,filledQuantity:0,stopPrice:95,state:'confirmed',marketHours:'regular_hours',timeInForce:'gfd',sessionDate:session.date,observedAt:at};
 const coverage=drill(1,{protectiveOrder:stop});assert.equal(coverage.protectionOrderVerified,true);record('SIMULATED_STOP_ACK',coverage.action);
 const stale=drill(1,{protectiveOrder:{...stop,observedAt:'2026-10-15T14:00:00Z'}});assert.equal(stale.protectionOrderVerified,false);record('OUTAGE_STALE_SNAPSHOT',stale.action);
 const cancel=drill(1,{protectiveOrder:{...stop,state:'pending_cancelled'}});assert.equal(cancel.action,'RECONCILE_ORIGINAL_PROTECTION');record('PENDING_STOP_CANCEL',cancel.action);
 const working=drill(1,{exitOrder:{state:'queued'}});assert.equal(working.action,'RECONCILE_EXISTING_EXIT');record('WORKING_EXIT',working.action);
 const closedEntry={...partial,state:'partially_filled_rest_cancelled'};
 const exit={...order,id:'fixture-exit',side:'sell',quantity:'1',state:'filled',cumulative_quantity:'1',executions:[fill('fixture-exit-fill',1,102)]};
 ledger=describeOrders([closedEntry,exit],[]);assert.deepEqual(ledger.issues,[]);assert.equal(ledger.orders.filter(o=>o.working).length,0);
 const flat=drill(0);assert.equal(flat.action,'FLAT_VERIFIED');assert.equal(flat.realizedPnl,undefined);record('FLAT_RECONCILIATION',flat.action);
 assert.deepEqual(describeOrders([closedEntry,exit],[]),ledger);record('RESTART_REPLAY','SAME_EXECUTIONS_NO_ADDITIONAL_FILLS');
 assert.throws(()=>describeOrders([closedEntry,{...exit,id:'duplicate-order',executions:closedEntry.executions}],[]),/DUPLICATE_EXECUTION/);
 return {schemaVersion:1,evidenceType:'SYNTHETIC_FIXTURE_REPLAY',passed:true,brokerWrites:false,realMoneyEnabled:false,liveCycleVerified:false,fixtureGrossPnl:2,steps,note:'Fixture P&L excludes costs and is not performance evidence. No broker entry, stop, cancellation or exit was submitted. This drill does not admit a strategy or unlock trading.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(JSON.stringify(replayCycle(),null,2));
