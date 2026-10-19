import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {strategyConfig,DEFAULT_STRATEGY,intradaySignal,antiTradeReasons,loadResearchInputs,researchPacket} from './trading-research-policy.mjs';
import {ResearchReader,inspectCandidate,scan,planSettledCash} from './safe-trading-bot.mjs';
import {evaluateDailyLoss,updateDailyLossGuard} from './daily-loss-guard.mjs';
import {readFileSync} from 'node:fs';
const workflowSource=readFileSync('.github/workflows/trading_bot.yml','utf8');
const now=Date.parse('2026-10-16T16:00:30Z'),t=new Date(now).toISOString();
const bars=()=>Array.from({length:21},(_,i)=>({t:new Date(Math.floor(now/60000)*60000-(21-i)*60000).toISOString(),h:i===20?101:99,l:97,c:i===20?100:98,v:i===20?300:100}));
const snap=()=>({latestQuote:{bp:99.9,ap:100,bs:10,as:10,t},latestTrade:{p:100,t},prevDailyBar:{c:98,v:1000,t}});
const events=()=>({source:'test-calendar',generatedAt:t,coverage:{AAPL:{checkedAt:t,checkedThrough:new Date(now+72*3600000).toISOString(),earningsAt:[]}}});
const macro={asOf:t,change:.01};
const account=()=>({source:'robinhood',reconciled:true,uncertainOrders:false,asOf:t,dailyLoss:{asOf:t,sessionDate:'2026-10-16',grossRealizedLossCents:3000,unrealizedLossCents:2000}});
const state=()=>({version:1,sessionDate:'2026-10-16',halted:false,peakLossCents:0,grossRealizedLossCents:0,updatedAt:t});
async function workspace(fn){await fs.mkdir('work',{recursive:true});const dir=await fs.mkdtemp(path.resolve('work/policy-test-'));try{return await fn(dir);}finally{assert.ok(dir.startsWith(path.resolve('work')+path.sep));await fs.rm(dir,{recursive:true,force:true});}}
test('strategy validates ceilings, no unsafe URLs or unknown keys',()=>{
 assert.equal(strategyConfig({}).dailyLossLimitCents,8000);
 for(const c of [{maxSpreadBps:151},{concurrency:10},{maxStockSymbols:10001},{maxRequests:0},{dailyLossLimitCents:null},{endpoint:'https://evil'}])assert.throws(()=>strategyConfig(c));
});
test('1.5% midpoint spread boundary applies to every asset',()=>{
 for(const [asset,symbol]of [['stock','AAPL'],['crypto','BTC/USD'],['option','AAPL261120C00100000']]) {
  const s=snap();s.greeks={delta:.5};s.impliedVolatility=.3;s.latestQuote.bp=99.25;s.latestQuote.ap=100.75;
  assert.ok(!inspectCandidate(symbol,s,asset,now).reasons.includes('WIDE_SPREAD'));
  s.latestQuote.ap=100.76;assert.ok(inspectCandidate(symbol,s,asset,now).reasons.includes('WIDE_SPREAD'));
 }
});
test('completed minute bars confirm breakout and relative volume',()=>{
 const x=intradaySignal(bars(),100,now);assert.equal(x.confirmed,true);assert.equal(x.breakout,true);assert.equal(x.volumeRatio,3);
 const b=bars();b[20].h=99;b[20].c=98;assert.equal(intradaySignal(b,98,now).confirmed,true);
});
test('partial bars, gaps, stale data and zero baselines do not qualify',()=>{
 const b=bars();b.push({t:new Date(Math.floor(now/60000)*60000).toISOString(),h:1000,l:1,c:999,v:999999});assert.equal(intradaySignal(b,100,now).volumeRatio,3);
 for(const bad of [bars().slice(1),bars().map(x=>({...x,v:0})),bars().map(x=>({...x,t:'2020-01-01'})),bars().map((x,i)=>i===1?{...x,t:bars()[0].t}:x)])assert.equal(intradaySignal(bad,100,now).confirmed,false);
});
test('earnings missing/stale/incomplete coverage fails closed',()=>{
 const c={symbol:'AAPL',asset:'stock'};
 assert.deepEqual(antiTradeReasons(c,{events:null,macro,now}),['EARNINGS_UNVERIFIED']);
 assert.deepEqual(antiTradeReasons(c,{events:events(),macro,now}),[]);
 const e=events();e.coverage.AAPL.checkedThrough=t;assert.deepEqual(antiTradeReasons(c,{events:e,macro,now}),['EARNINGS_UNVERIFIED']);
 e.generatedAt='2020-01-01';assert.deepEqual(antiTradeReasons(c,{events:e,macro,now}),['EARNINGS_UNVERIFIED']);
});
test('earnings blackout uses option underlying; macro applies to crypto too',()=>{
 const e=events();e.coverage.AAPL.earningsAt=[new Date(now+3600000).toISOString()];
 assert.deepEqual(antiTradeReasons({symbol:'AAPL261120C00100000',asset:'option'},{events:e,macro,now}),['EARNINGS_BLACKOUT']);
 assert.deepEqual(antiTradeReasons({symbol:'BTC/USD',asset:'crypto'},{macro:{asOf:t,change:-.03},now}),['MACRO_DRAWDOWN']);
 assert.deepEqual(antiTradeReasons({symbol:'QQQ',asset:'stock'},{macro:null,now}),['MACRO_UNVERIFIED']);
});
test('repository ingestion extracts valid symbols, never trusts stale triggers',()=>workspace(async dir=>{
 await fs.mkdir(path.join(dir,'.github'));await fs.mkdir(path.join(dir,'docs/data'),{recursive:true});
 await fs.writeFile(path.join(dir,'.github/trading-bot-strategy.json'),'{}');
 const file=path.join(dir,'docs/data/trigger-board.json');
 await fs.writeFile(file,JSON.stringify({publishedAt:t,items:[{ticker:'TSLA',maximumEntry:100,signalGeneratedAt:t},{ticker:'https://evil',maximumEntry:1,signalGeneratedAt:t}]}));
 let i=await loadResearchInputs(dir,now);assert.ok(i.universe.stocks.includes('TSLA'));assert.ok(!i.universe.stocks.includes('https://evil'));assert.equal(i.triggers.get('TSLA').price,100);
 await fs.writeFile(file,JSON.stringify({publishedAt:'2020-01-01',items:[{ticker:'TSLA',maximumEntry:100,signalGeneratedAt:t}]}));
 i=await loadResearchInputs(dir,now);assert.equal(i.triggers.size,0);assert.ok(i.universe.stocks.includes('TSLA'));
}));
test('reader batches arbitrary validated repo symbols, limits requests and rejects order routes',async()=>{
 const calls=[];const r=new ResearchReader({key:'test-key',secret:'test-secret',config:{...DEFAULT_STRATEGY,maxRequests:1},transport:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({})};}});
 await r.get('stocks',{symbols:['TSLA','SPY']});assert.equal(new URL(calls[0].url).searchParams.get('symbols'),'TSLA,SPY');
 await assert.rejects(r.get('clock'),/DATA_BUDGET_EXHAUSTED/);await assert.rejects(r.get('orders'),/READ_DENIED/);
});
test('bulk discovery records truncation and bounded history shortlist',async()=>{
 const config={...DEFAULT_STRATEGY,maxStockSymbols:2,maxCryptoSymbols:1,maxHistorySymbols:1,maxOptionUnderlyings:1};
 const reader={get:async(lane,args)=>{
  if(lane==='clock')return {is_open:true,timestamp:t};
  if(lane.endsWith('Assets'))return ['SPY','AAPL','TSLA'].map(symbol=>({symbol,status:'active',tradable:true}));
  if(lane==='stocks')return Object.fromEntries(args.symbols.map(s=>[s,snap()]));
  if(lane==='crypto')return {snapshots:Object.fromEntries(args.symbols.map(s=>[s,snap()]))};
  if(lane==='options')return {snapshots:{}};
  return {bars:Object.fromEntries(args.symbols.map(s=>[s,bars()]))};
 }};
 const r=await scan(reader,{now,inputs:{config,universe:{stocks:['AAPL'],crypto:['BTC/USD']},sources:[],events:events(),triggers:new Map()}});
 assert.equal(r.coverage.stock.discovered,3);assert.equal(r.coverage.stock.requested,2);assert.equal(r.coverage.stock.truncated,true);assert.equal(r.coverage.stock.historyRequested,1);
 assert.equal(r.candidates.filter(c=>c.asset==='stock'&&c.signal.confirmed).length,1);assert.equal(r.liveOrdersEnabled,false);
});
test('public payload expires, strips private data, and never declares fills or order authority',()=>{
 const r={mode:'RESEARCH_ONLY',liveOrdersEnabled:false,generatedAt:t,lanes:{session:'OPEN',stock:'COMPLETE',option:'COMPLETE',crypto:'COMPLETE'},macro:{status:'CLEAR'},account:{secret:'private'},candidates:[{symbol:'AAPL',asset:'stock',status:'WATCH',ask:100,spread:.01,feed:'iex',quoteAsOf:t,liveEligible:false,signal:{confirmed:true,breakout:true,volumeRatio:3,barAsOf:t},secret:'private'}]};
 const p=researchPacket(r,now);assert.equal(p.candidates.length,1);assert.equal(p.action,'NO_ACTION');assert.ok(!JSON.stringify(p).includes('private'));assert.equal(Date.parse(p.expiresAt)-now,120000);
 assert.equal(researchPacket(r,now+120001).candidates.length,0);
 assert.throws(()=>researchPacket(r,now+300001),/PUBLICATION_INVALID/);assert.throws(()=>researchPacket({...r,liveOrdersEnabled:true},now));
});
test('$80 threshold halts at equality; recovered losses remain latched',()=>{
 const a=account();assert.equal(evaluateDailyLoss(a,state(),8000,now).allowed,true);
 a.dailyLoss.unrealizedLossCents=5000;const hit=evaluateDailyLoss(a,state(),8000,now);assert.equal(hit.allowed,false);assert.equal(hit.reason,'DAILY_LOSS_LIMIT');
 a.dailyLoss.unrealizedLossCents=0;assert.equal(evaluateDailyLoss(a,hit.state,8000,now).allowed,false);
});
test('loss latch resets on New York date, not UTC midnight',()=>{
 const a=account(),s={...state(),halted:true,peakLossCents:8000};
 const utcMidnight=Date.parse('2026-10-17T00:30:00Z');a.asOf=a.dailyLoss.asOf=new Date(utcMidnight).toISOString();assert.equal(evaluateDailyLoss(a,s,8000,utcMidnight).allowed,false);
 const nextDay=Date.parse('2026-10-17T05:00:00Z');a.asOf=a.dailyLoss.asOf=new Date(nextDay).toISOString();a.dailyLoss.sessionDate='2026-10-17';assert.equal(evaluateDailyLoss(a,s,8000,nextDay).allowed,true);
});
test('missing/stale/reversed daily losses block plans',()=>{
 const a=account();assert.equal(evaluateDailyLoss(a,null,8000,now).allowed,false);
 assert.equal(evaluateDailyLoss({...a,dailyLoss:{...a.dailyLoss,asOf:'2020-01-01'}},state(),8000,now).allowed,false);
 assert.equal(evaluateDailyLoss(a,{...state(),grossRealizedLossCents:4000},8000,now).reason,'DAILY_LOSS_REWIND');
 assert.ok(planSettledCash([],a,now).blockers.includes('DAILY_STATE_UNAVAILABLE'));
 assert.equal(evaluateDailyLoss(a,{...state(),updatedAt:new Date(now-360001).toISOString()},8000,now).reason,'DAILY_STATE_STALE');
 assert.equal(evaluateDailyLoss({...a,dailyLoss:{...a.dailyLoss,unrealizedLossCents:-1}},state(),8000,now).allowed,false);
});
test('private loss guard persists latch atomically and fails closed on lock/corruption',()=>workspace(async dir=>{
 const file=path.join(dir,'loss.json'),a=account();
 assert.equal((await updateDailyLossGuard(file,a,8000,now)).allowed,false);
 await fs.writeFile(file,JSON.stringify(state()));a.dailyLoss.unrealizedLossCents=5000;
 assert.equal((await updateDailyLossGuard(file,a,8000,now)).allowed,false);
 a.dailyLoss.unrealizedLossCents=0;assert.equal((await updateDailyLossGuard(file,a,8000,now)).allowed,false);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).halted,true);
 await fs.writeFile(file+'.lock','');assert.equal((await updateDailyLossGuard(file,a,8000,now)).reason,'DAILY_STATE_UNAVAILABLE');await fs.rm(file+'.lock');
 await fs.writeFile(file,'bad json');assert.equal((await updateDailyLossGuard(file,a,8000,now)).allowed,false);
}));


test('research clock tolerates bounded transport skew without weakening quote freshness',async()=>{
 const {validResearchClock,fresh}=await import('./trading-research-policy.mjs');
 for(const offset of [-2000,-1,0,60000])assert.equal(validResearchClock({is_open:false,timestamp:new Date(now-offset).toISOString()},now),true);
 for(const offset of [-2001,60001])assert.equal(validResearchClock({is_open:true,timestamp:new Date(now-offset).toISOString()},now),false);
 assert.equal(validResearchClock({timestamp:t},now),false);
 assert.equal(validResearchClock({is_open:true,timestamp:'bad'},now),false);
 assert.equal(fresh(new Date(now+1).toISOString(),now,120000),false);
});


test('degraded scans publish explicit coverage and withhold picks from incomplete or unverified lanes',()=>{
 const candidate={symbol:'AAPL',asset:'stock',status:'WATCH',ask:100,spread:.01,feed:'iex',quoteAsOf:t,liveEligible:false,signal:{confirmed:true,barAsOf:t}};
 const report={mode:'RESEARCH_ONLY',liveOrdersEnabled:false,generatedAt:t,lanes:{session:'OPEN',stock:'COMPLETE',option:'SESSION_BLOCKED',crypto:'DATA_UNAVAILABLE_OR_INCOMPLETE'},macro:{status:'CLEAR'},coverage:{crypto:{discovered:60,received:36,secret:'private'}},candidates:[candidate,{...candidate,symbol:'BTC/USD',asset:'crypto',feed:'alpaca-us'}]};
 const packet=researchPacket(report,now);assert.equal(packet.dataHealth,'DEGRADED');assert.equal(packet.action,'NO_ACTION');assert.deepEqual(packet.candidates.map(c=>c.symbol),['AAPL']);assert.equal(packet.coverage.crypto.received,36);assert.ok(!JSON.stringify(packet).includes('private'));
 assert.equal(researchPacket({...report,lanes:null},now).candidates.length,0);
 assert.equal(researchPacket({...report,lanes:{...report.lanes,session:'CLOSED'}},now).candidates.length,0);
});


test('failed scan publication cannot bypass fresh-report validation or macro gates',()=>{
 const w=workflowSource;
 assert.match(w,/if: always\(\) && \(needs.scan.result == 'success' \|\| needs.scan.result == 'failure'\)/);
 const packet=researchPacket({mode:'RESEARCH_ONLY',liveOrdersEnabled:false,generatedAt:t,lanes:{session:'OPEN',stock:'COMPLETE',option:'COMPLETE',crypto:'COMPLETE'},candidates:[]},now);
 assert.equal(packet.macroStatus,'UNVERIFIED');assert.equal(packet.dataHealth,'DEGRADED');assert.deepEqual(packet.candidates,[]);
});
