import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {assessProtectionSnapshot as audit} from './protection-coverage.mjs';
const at='2026-10-16T14:00:00.000Z',now=Date.parse(at);
const pending={pending_assignment_quantity:'0',pending_exercise_quantity:'0',pending_expiration_quantity:'0',pending_buy_quantity:'0',pending_sell_quantity:'0'};
const option={option_id:'fixture-contract',chain_symbol:'FIXTURE',quantity:'2',type:'long',expiration_date:'2026-10-30',...pending};
const stop={asset:'OPTION',id:'fixture-stop',state:'confirmed',type:'market',trigger:'stop',quantity:'2',confirmedFilledQuantity:0,stop_price:'0.5',price:null,market_hours:'regular_hours',time_in_force:'gfd',created_at:at,legs:[{option_id:option.option_id,side:'sell',position_effect:'close',ratio_quantity:1}]};
const snapshot={generatedAt:at,positionsReadComplete:true,orderHistoryReadComplete:true,equities:[],options:[option],orders:[stop],cryptoPositions:[],blockers:[]};
const status={at,brokerConnected:true,reconciliation:{at,positionsReadComplete:true,orderHistoryReadComplete:true},entryData:{connected:true,verifiedAt:at,marketOpen:true}};
const run=(patch={})=>audit({snapshot,status,now,...patch});

test('exact option stop coverage is a read-only observation, never a live capability attestation',()=>{
 const r=run();assert.equal(r.matchedStopCount,1);assert.equal(r.allowRealMoneyOrders,false);assert.equal(r.liveCycleVerified,false);assert.equal(r.brokerWrites,false);
 assert.ok(r.blockers.includes('ADVANCED_ORDER_COVERAGE_UNVERIFIED'));
 assert.ok(r.blockers.includes('LIVE_ENTRY_PROTECTION_EXIT_CYCLE_UNVERIFIED'));
});

test('actual desktop receipt clears only its alert gate; a matched stop never clears the session close review',()=>{
 const late='2026-10-16T19:00:00Z',time=Date.parse(late);
 const r=run({now:time,snapshot:{...snapshot,generatedAt:late,orders:[{...stop,created_at:late}]},status:{...status,at:late,reconciliation:{...status.reconciliation,at:late},alertDelivery:{userReceiptVerified:true,deliveryHeartbeatFresh:true},entryData:{connected:true,verifiedAt:late,marketOpen:true,calendarVerified:true,calendarSession:{date:'2026-10-16',open:'09:30',close:'16:00'}}}});
 assert.equal(r.matchedStopCount,1);assert.ok(!r.blockers.includes('ALERT_RECEIPT_UNVERIFIED'));assert.ok(r.blockers.includes('SESSION_EXIT_REVIEW_REQUIRED'));assert.equal(r.allowRealMoneyOrders,false);assert.equal(r.liveCycleVerified,false);
});
test('equity and option positions are assessed together',()=>{
 const equity={symbol:'EQUITY',quantity:'1'};
 const equityStop={...stop,asset:'EQUITY',symbol:equity.symbol,side:'sell',quantity:'1'};
 const r=run({snapshot:{...snapshot,equities:[equity],orders:[stop,equityStop]}});
 assert.equal(r.holdingCount,2);assert.equal(r.matchedStopCount,2);
});
test('a fresh retained snapshot cannot verify coverage after a failed current read or mixed generation',()=>{
 for(const patch of [{...status,brokerConnected:false},{...status,brokerConnected:'true'},{...status,reconciliation:{...status.reconciliation,at:'2026-10-16T13:59:59Z'}},{...status,at:'2020-01-01'}]){
  const r=run({status:patch});assert.equal(r.currentReadVerified,false);assert.equal(r.matchedStopCount,null);assert.equal(r.assessments.length,0);
 }
});
test('stale or future source reads cannot appear protected',()=>{
 for(const time of [now+30001,now-3000]){const r=run({now:time});assert.equal(r.matchedStopCount,null);assert.ok(r.blockers.includes('BROKER_SNAPSHOT_STALE_OR_MISSING'));}
});
test('multiple stops or simultaneous exit and stop cannot silently select a first order',()=>{
 for(const other of [{...stop,id:'second-stop'},{...stop,id:'exit',trigger:'immediate',type:'limit'}]){
  const a=run({snapshot:{...snapshot,orders:[stop,other]}}).assessments[0];assert.equal(a.matchedStopObserved,false);assert.ok(a.issues.includes('CONFLICTING_SELL_ORDERS_REQUIRE_REVIEW'));
 }
});
test('unknown order states and working buys block coverage even with a matching stop',()=>{
 for(const other of [{...stop,state:'new_unknown_state'},{...stop,id:'entry',legs:[{...stop.legs[0],side:'buy',position_effect:'open'}]}])assert.equal(run({snapshot:{...snapshot,orders:[stop,other]}}).matchedStopCount,0);
});
test('multi-leg, opening-sell, mismatched and partial protection are rejected',()=>{
 for(const change of [{legs:[...stop.legs,{...stop.legs[0],option_id:'other'}]},{legs:[{...stop.legs[0],position_effect:'open'}]},{legs:[{...stop.legs[0],ratio_quantity:2}]},{quantity:'3'},{confirmedFilledQuantity:1},{state:'pending_cancelled'},{state:'partially_filled'}])assert.equal(run({snapshot:{...snapshot,orders:[{...stop,...change}]}}).matchedStopCount,0);
});
test('pending processing, expiration today, missing expiry and short/fractional contracts block coverage',()=>{
 for(const patch of [{pending_expiration_quantity:'1'},{pending_exercise_quantity:'1'},{pending_assignment_quantity:'1'},{pending_buy_quantity:'1'},{expiration_date:'2026-10-16'},{expiration_date:null},{type:'short'},{quantity:'0.5'},{quantity:true},{quantity:' '},{pending_exercise_quantity:undefined}])assert.equal(run({snapshot:{...snapshot,options:[{...option,...patch}]}}).matchedStopCount,0);
 const r=run({snapshot:{...snapshot,options:[{...option,expiration_date:'2026-10-16'}]}});assert.ok(r.blockers.includes('OPTION_EXPIRATION_REVIEW_REQUIRED'));
});
test('known pending sell quantities are reconciled against the matching stop, unknown sells block',()=>{
 assert.equal(run({snapshot:{...snapshot,options:[{...option,pending_sell_quantity:'2'}]}}).matchedStopCount,1);
 assert.equal(run({snapshot:{...snapshot,options:[{...option,pending_sell_quantity:'3'}]}}).matchedStopCount,0);
});
test('stop-limit needs valid explicit prices, option stop-market cannot claim unsupported GTC coverage',()=>{
 const limit={...stop,type:'limit',price:'0.45'};
 assert.equal(run({snapshot:{...snapshot,orders:[limit]}}).matchedStopCount,1);
 for(const price of [null,'0','0.6'])assert.equal(run({snapshot:{...snapshot,orders:[{...limit,price}]}}).matchedStopCount,0);
 assert.equal(run({snapshot:{...snapshot,orders:[{...stop,time_in_force:'gtc'}]}}).matchedStopCount,0);
});
test('closed market, stale market clock, expired GFD or missing stop never verify current coverage',()=>{
 assert.equal(run({status:{...status,entryData:{...status.entryData,marketOpen:false}}}).matchedStopCount,0);
 assert.equal(run({status:{...status,entryData:{...status.entryData,verifiedAt:'2020-01-01'}}}).matchedStopCount,0);
 assert.equal(run({snapshot:{...snapshot,orders:[{...stop,created_at:'2026-10-15T14:00:00Z'}]}}).matchedStopCount,0);
 assert.equal(run({snapshot:{...snapshot,orders:[]}}).matchedStopCount,0);
});
test('crypto exposure and empty or malformed snapshots stay blocked',()=>{
 assert.ok(run({snapshot:{...snapshot,cryptoPositions:[{currency:{type:'cryptocurrency'},quantity:'0.01'}]}}).blockers.includes('CRYPTO_PROTECTION_UNVERIFIED'));
 for(const s of [null,{...snapshot,options:null}])assert.equal(run({snapshot:s}).matchedStopCount,null);
 const flat=run({snapshot:{...snapshot,options:[],orders:[]}});assert.equal(flat.holdingCount,0);assert.equal(flat.allowRealMoneyOrders,false);
});
test('CLI produces private blocked evidence with no holding details in stdout and never enables orders',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'protection-audit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'broker-reconciliation.json'),JSON.stringify(snapshot));fs.writeFileSync(path.join(root,'status.json'),JSON.stringify(status));
 const r=spawnSync(process.execPath,['scripts/verify-protection-readiness.mjs','--state-dir',root],{encoding:'utf8'});
 assert.equal(r.status,2);assert.doesNotMatch(r.stdout,/FIXTURE|fixture-contract/);
 const report=JSON.parse(fs.readFileSync(path.join(root,'protection-readiness.json')));assert.equal(report.allowRealMoneyOrders,false);assert.equal(report.brokerWrites,false);
});
