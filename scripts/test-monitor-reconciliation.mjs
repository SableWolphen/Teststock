import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {collectReadOnlySnapshot,readPages,describeOrders} from './monitor-reconciliation.mjs';
import {cycle} from './windows-monitor.mjs';
import {SAFETY_POLICY} from './safety-policy.mjs';
const wrap=data=>({structuredContent:{data}});
const account={account_number:'private-fixture-account',agentic_allowed:true,state:'active'};
const fill={id:'fill-1',quantity:'1',price:'10',timestamp:'2026-10-16T14:00:00Z'};
const order={id:'order-1',symbol:'SPY',side:'buy',state:'partially_filled',quantity:'2',cumulative_quantity:'1',executions:[fill]};
const mock=(patch={})=>({call:async(name,args)=>{
 if(patch[name]) return patch[name](args);
 return wrap(name==='get_accounts'?{accounts:[account]}:name.includes('positions')?{positions:[]}:{orders:[]});
}});
test('canonical policy preserves strict floors and disables all bootstrap/order authority',()=>{
 assert.equal(SAFETY_POLICY.liveExecutionEnabled,false);assert.equal(SAFETY_POLICY.bootstrapAllowed,false);assert.equal(SAFETY_POLICY.maxOrderUsd,0);
 assert.equal(SAFETY_POLICY.stocks.microSamples,100);assert.equal(SAFETY_POLICY.stocks.microDays,20);assert.equal(SAFETY_POLICY.stocks.minProfitFactor,1.25);
 assert.equal(SAFETY_POLICY.options.microSamples,50);assert.equal(SAFETY_POLICY.options.microDays,20);assert.equal(SAFETY_POLICY.options.minProfitFactor,1.30);
});
test('pagination reads all pages and partial fills remain part of one working order',async()=>{
 let pages=0;const client=mock({get_equity_orders:args=>{pages++;return wrap(args.cursor?{orders:[{...order,id:'order-2',executions:[],cumulative_quantity:'0',state:'cancelled'}]}:{orders:[order],next:'next-page'});}});
 const s=await collectReadOnlySnapshot(client);assert.equal(pages,2);assert.equal(s.orders.length,2);assert.equal(s.fills.length,1);assert.equal(s.orders[0].confirmedFilledQuantity,1);assert.equal(s.orders[0].working,true);assert.equal(s.entryAllowed,false);assert.equal(s.allAssetReconciliationComplete,false);
});
test('account ambiguity and unexpected account changes fail closed',async()=>{
 await assert.rejects(collectReadOnlySnapshot(mock({get_accounts:()=>wrap({accounts:[account,{...account,account_number:'another'}]})})),/ACCOUNT_SELECTION/);
 await assert.rejects(collectReadOnlySnapshot(mock(),{accountFingerprint:'wrong'}),/ACCOUNT_CHANGED/);
});
test('repeated cursors, missing arrays, duplicate ids and page limits do not yield a complete snapshot',async()=>{
 await assert.rejects(readPages(mock({get_equity_orders:()=>wrap({orders:[],next:'loop'})}),'get_equity_orders',{},'orders'),/CURSOR_LOOP/);
 await assert.rejects(readPages(mock({get_equity_orders:()=>wrap({orders:null})}),'get_equity_orders',{},'orders'),/INVALID_BROKER_PAGE/);
 await assert.rejects(readPages(mock({get_equity_orders:()=>wrap({orders:[order,order]})}),'get_equity_orders',{},'orders'),/DUPLICATE/);
 await assert.rejects(readPages(mock({get_equity_orders:()=>wrap({orders:[],next:'more'})}),'get_equity_orders',{},'orders',{maxPages:1}),/PAGE_LIMIT/);
});
test('unknown lifecycle states remain working and missing fills never become invented executions',()=>{
 const s=describeOrders([{...order,state:'new_broker_state',executions:[]}],[]);assert.equal(s.orders[0].working,true);assert.equal(s.fills.length,0);assert.ok(s.issues.includes('UNKNOWN_ORDER_STATE'));assert.ok(s.issues.includes('FILLED_QUANTITY_WITHOUT_EXECUTIONS'));
});
test('duplicate executions and impossible quantities are rejected',()=>{
 assert.throws(()=>describeOrders([{...order,executions:[fill,fill]}],[]),/DUPLICATE_EXECUTION/);
 assert.throws(()=>describeOrders([{...order,quantity:'0'}],[]),/INVALID_ORDER_QUANTITY/);
});
test('multiple working orders are flagged without issuing cancel or replacement',()=>{
 const s=describeOrders([order,{...order,id:'order-2',executions:[],cumulative_quantity:'0'}],[]);assert.ok(s.issues.includes('MULTIPLE_WORKING_ORDERS_REQUIRE_REVIEW'));
});
test('slow multi-page reads cannot become fresh attestations',async()=>{
 let clock=0;await assert.rejects(collectReadOnlySnapshot(mock(),{now:()=>clock+=130000}),/RECONCILIATION_TOO_SLOW/);
});
test('network/auth failure retains last good snapshot and logs contain no account/credential text',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reconciliation-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'broker-reconciliation.json');fs.writeFileSync(file,JSON.stringify({generatedAt:'old',accountFingerprint:'pinned'}));const before=fs.readFileSync(file,'utf8');
 const client={version:'mock',call:async()=>{throw Error('private-fixture-account SECRET');}};
 const status=await cycle({root,client,symbols:['SPY']});assert.equal(status.health,'BLOCKED');assert.equal(status.reconciliation.positionsReadComplete,false);assert.equal(fs.readFileSync(file,'utf8'),before);assert.doesNotMatch(fs.readFileSync(path.join(root,'status.json'),'utf8'),/SECRET|private-fixture-account/);
});
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';

test('49 outcomes or 19 days cannot earn options micro admission; evidence never grants execution',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'admission-boundary-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const data=path.join(dir,'docs/data');fs.mkdirSync(data,{recursive:true});
 for(const [count,days,expected] of [[49,20,'SHADOW_ONLY'],[50,19,'SHADOW_ONLY'],[50,20,'MICRO_PROBATION']]) {
  const trades=Array.from({length:count},(_,i)=>({status:'RESOLVED',realizedR:1,evidenceEligible:true,shadowEvidenceVersion:3,createdDate:`2026-09-${String(i%days+1).padStart(2,'0')}`,underlying:'SYM'+i}));
  fs.writeFileSync(path.join(data,'options-shadow-trades.json'),JSON.stringify({trades}));
  const child=spawnSync(process.execPath,[path.resolve('scripts/apply-options-profitability-admission.mjs')],{cwd:dir,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
  const out=JSON.parse(fs.readFileSync(path.join(data,'options-profitability-admission.json')));assert.equal(out.state,expected);assert.equal(out.executionAuthorized,false);
 }
});
test('legacy enabled index policy cannot create bootstrap admission with zero evidence',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'index-legacy-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const data=path.join(dir,'docs/data');fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,'index-options-live-policy.json'),JSON.stringify({enabled:true,maxOrderUsd:null}));
 const child=spawnSync(process.execPath,[path.resolve('scripts/apply-index-options-profitability-admission.mjs')],{cwd:dir,encoding:'utf8'});assert.equal(child.status,0,child.stderr);const out=JSON.parse(fs.readFileSync(path.join(data,'index-options-profitability-admission.json')));assert.equal(out.state,'SHADOW_ONLY');assert.equal(out.bootstrapLivePolicy,null);assert.equal(out.executionAuthorized,false);
});
test('crashed monitor retains its lock and prevents an unattended duplicate restart',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crash-drill-'));const env={...process.env,TESTSTOCK_RUNTIME_STATE_DIR:root,ROBINHOOD_MCP_OAUTH_TOKEN:''};
 const child=spawn(process.execPath,['scripts/windows-monitor.mjs'],{env,stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill();fs.rmSync(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('monitor startup timed out')),5000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});
 const ended=once(child,'exit');child.kill('SIGKILL');await ended;
 const restarted=spawnSync(process.execPath,['scripts/windows-monitor.mjs','--once'],{env,encoding:'utf8'});assert.equal(restarted.status,1);assert.equal(fs.existsSync(path.join(root,'monitor.lock')),true);
});
