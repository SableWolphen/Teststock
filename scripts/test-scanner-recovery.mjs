import test from 'node:test';
import assert from 'node:assert/strict';
import {scan,ResearchReader} from './safe-trading-bot.mjs';
import {DEFAULT_STRATEGY,researchPacket} from './trading-research-policy.mjs';
const now=Date.parse('2026-10-19T14:00:30Z'),t=new Date(now).toISOString();
const snapshot={latestQuote:{bp:99.9,ap:100,bs:10,as:10,t},latestTrade:{p:100,t},prevDailyBar:{c:98,v:1000,t}};
const bars=Array.from({length:21},(_,i)=>({t:new Date(Math.floor(now/60000)*60000-(21-i)*60000).toISOString(),h:i===20?101:99,l:97,c:i===20?100:98,v:100}));
const inputs={config:{...DEFAULT_STRATEGY,discoverAssets:false},universe:{stocks:['SPY'],crypto:['BTC/USD']},sources:[],triggers:new Map(),events:null};
function reader({recover=false,denyBars=false}={}){
 let stockCalls=0;
 return {get:async(lane,args)=>{
  if(lane==='clock')return {is_open:true,timestamp:t};
  if(lane==='stocks'){stockCalls++;return stockCalls===1||!recover?{}:{SPY:snapshot};}
  if(lane==='crypto')return {snapshots:{'BTC/USD':snapshot}};
  if(lane==='options')return {snapshots:{}};
  if(denyBars){const error=Error('PRIVATE_BODY');error.code='DATA_HTTP_403';throw error;}
  return {bars:Object.fromEntries(args.symbols.map(s=>[s,bars]))};
 }};
}
test('transient snapshot omissions get one bounded retry and recovered observations remain research only',async()=>{
 const r=await scan(reader({recover:true}),{inputs,now});assert.equal(r.coverage.stock.retried,1);assert.equal(r.coverage.stock.recovered,1);assert.equal(r.coverage.stock.missingSnapshots,0);assert.equal(r.lanes.stock,'COMPLETE');assert.equal(r.liveOrdersEnabled,false);
});
test('persistent missing snapshots never become complete or published picks',async()=>{
 const r=await scan(reader(),{inputs,now});assert.equal(r.coverage.stock.recovered,0);assert.equal(r.coverage.stock.missingSnapshots,1);assert.equal(r.lanes.stock,'DATA_UNAVAILABLE_OR_INCOMPLETE');assert.equal(researchPacket(r,now).candidates.length,0);
});
test('HTTP diagnostics identify denied historical reads without publishing upstream messages or credentials',async()=>{
 const r=await scan(reader({recover:true,denyBars:true}),{inputs,now});assert.deepEqual(r.coverage.stock.errorCodes,['DATA_HTTP_403']);assert.equal(r.coverage.stock.historyReceived,0);assert.equal(r.coverage.stock.historyMissing,1);assert.equal(r.lanes.stock,'DATA_UNAVAILABLE_OR_INCOMPLETE');
 const p=researchPacket(r,now);assert.deepEqual(p.diagnostics.stock.errorCodes,['DATA_HTTP_403']);assert.doesNotMatch(JSON.stringify(p),/PRIVATE_BODY/);
});
test('reader preserves only safe status classification on authorization failure',async()=>{
 const r=new ResearchReader({key:'test-key',secret:'test-secret',transport:async()=>new Response('SECRET',{status:403})});
 await assert.rejects(r.get('optionBars',{symbols:['SPY261030C00100000'],now}),e=>e.message==='DATA_HTTP_FAILED'&&e.code==='DATA_HTTP_403');
});
