import test from 'node:test';
import assert from 'node:assert/strict';
import {scan,UNIVERSE} from './safe-trading-bot.mjs';
import {DEFAULT_STRATEGY,researchPacket} from './trading-research-policy.mjs';
const now=Date.parse('2026-10-19T14:20:30Z'),t=new Date(now).toISOString();
const snapshot={latestQuote:{bp:99.9,ap:100,bs:10,as:10,t},latestTrade:{p:100,t},prevDailyBar:{c:98,v:10000,t}};
const bars=Array.from({length:21},(_,i)=>({t:new Date(Math.floor(now/60000)*60000-(21-i)*60000).toISOString(),h:i===20?101:99,l:97,c:i===20?100:98,v:100}));
const inputs={config:DEFAULT_STRATEGY,universe:{stocks:['MISSING'],crypto:['MISSING/USD']},sources:[],triggers:new Map(),events:null};
function reader({missing=false}={}){const calls=[];return {calls,get:async(lane,args)=>{
 calls.push(lane);if(lane==='clock')return {timestamp:t,is_open:true};
 if(lane==='stocks')return Object.fromEntries(args.symbols.filter(s=>!missing||s!=='SPY').map(s=>[s,snapshot]));
 if(lane==='crypto')return {snapshots:Object.fromEntries(args.symbols.map(s=>[s,snapshot]))};
 if(lane.endsWith('Bars'))return {bars:Object.fromEntries(args.symbols.map(s=>[s,bars]))};
 throw Error('UNEXPECTED_ACCESS');
}};}
test('declared core scope uses complete current access without discovery or denied option history',async()=>{
 const r=reader(),report=await scan(r,{scope:'CURRENT_ACCESS_CORE',inputs,now});
 assert.equal(report.scope,'CURRENT_ACCESS_CORE');assert.equal(report.coverage.stock.requested,UNIVERSE.stocks.length);assert.equal(report.coverage.crypto.requested,UNIVERSE.crypto.length);
 assert.equal(report.lanes.stock,'COMPLETE');assert.equal(report.lanes.crypto,'COMPLETE');assert.equal(report.lanes.option,'EXCLUDED_CURRENT_ACCESS');
 assert.ok(!r.calls.some(x=>['stockAssets','cryptoAssets','options','optionBars'].includes(x)));
 const p=researchPacket(report,now);assert.equal(p.dataHealth,'OK');assert.equal(p.liveOrdersEnabled,false);assert.equal(p.diagnostics.scope.name,'CURRENT_ACCESS_CORE');assert.ok(p.candidates.every(c=>c.asset!=='option'));
});
test('core scope does not hide missing observations inside its declared universe',async()=>{
 const report=await scan(reader({missing:true}),{scope:'CURRENT_ACCESS_CORE',inputs,now});assert.equal(report.lanes.stock,'DATA_UNAVAILABLE_OR_INCOMPLETE');assert.equal(researchPacket(report,now).dataHealth,'DEGRADED');assert.ok(researchPacket(report,now).candidates.every(c=>c.asset!=='stock'));
});
test('unknown scopes fail and core packets cannot publish symbols outside the fixed scope',async()=>{
 await assert.rejects(scan(reader(),{scope:'FAKE',inputs,now}),/RESEARCH_SCOPE_INVALID/);
 const report=await scan(reader(),{scope:'CURRENT_ACCESS_CORE',inputs,now});const extra={...report.candidates.find(c=>c.symbol==='SPY'),symbol:'OTHER'};report.candidates.unshift(extra);
 assert.ok(!researchPacket(report,now).candidates.some(c=>c.symbol==='OTHER'));
});

test('briefly ahead provider observations are evaluated only after local time reaches them; far-future quotes still fail',async()=>{
 for(const ahead of [30,5000]){
  const r=reader(),base=r.get;r.get=async(lane,args)=>{const value=await base(lane,args);if(lane==='stocks')for(const s of Object.keys(value))value[s]={...value[s],latestQuote:{...value[s].latestQuote,t:new Date(now+ahead).toISOString()},latestTrade:{...value[s].latestTrade,t:new Date(now+ahead).toISOString()}};return value;};
  const report=await scan(r,{scope:'CURRENT_ACCESS_CORE',inputs,now});const spy=report.candidates.find(c=>c.symbol==='SPY');
  assert.equal(spy.reasons.includes('STALE_QUOTE'),ahead>2000);
 }
});
