import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ResearchReader,inspectCandidate,planSettledCash,scan as rawScan,UNIVERSE} from './safe-trading-bot.mjs';
import {DEFAULT_STRATEGY} from './trading-research-policy.mjs';
const scan=(reader,options={})=>rawScan(reader,{...options,inputs:options.inputs??{universe:UNIVERSE,config:{...DEFAULT_STRATEGY,discoverAssets:false},triggers:new Map(),events:null,sources:[]}});
const now=Date.parse('2026-10-16T16:00:00Z'),t=new Date(now).toISOString();
const snap=()=>({latestQuote:{bp:99.9,ap:100,bs:10,as:10,t},latestTrade:{p:100,t},prevDailyBar:{c:98,v:1000000,t}});
const account=()=>({source:'robinhood',reconciled:true,uncertainOrders:false,asOf:t,equityCents:1000000,settledCashCents:100000,cashBuyingPowerCents:80000,pendingBuyCommitmentsCents:20000,openRiskCents:0,exposureSymbols:[],dailyLoss:{asOf:t,sessionDate:'2026-10-16',grossRealizedLossCents:0,unrealizedLossCents:0},dailyLossState:{version:1,sessionDate:'2026-10-16',halted:false,peakLossCents:0,grossRealizedLossCents:0,updatedAt:t}});
const candidate=(symbol='AAPL',asset='stock',ask=100)=>({symbol,asset,ask,status:'WATCH'});
test('fresh stock remains research only',()=>{const c=inspectCandidate('AAPL',snap(),'stock',now);assert.equal(c.status,'WATCH');assert.equal(c.liveEligible,false);});
for(const [name,mutate] of [
 ['stale',s=>s.latestQuote.t='2020-01-01'],['future',s=>s.latestQuote.t=new Date(now+1).toISOString()],
 ['crossed',s=>s.latestQuote.bp=101],['wide',s=>s.latestQuote.bp=90],['zero size',s=>s.latestQuote.bs=0],
 ['NaN',s=>s.latestQuote.ap=NaN],['missing price',s=>delete s.latestTrade],['falling',s=>s.latestTrade.p=90],
])test(`reject ${name}`,()=>{const s=snap();mutate(s);assert.equal(inspectCandidate('AAPL',s,'stock',now).status,'REJECTED');});
test('options indicative warning and malformed expiry',()=>{
 const s=snap();s.greeks={delta:0.5};s.impliedVolatility=0.3;
 const c=inspectCandidate('AAPL261120C00100000',s,'option',now);assert.equal(c.status,'WATCH');assert.deepEqual(c.reasons,['INDICATIVE_RESEARCH_ONLY']);
 assert.equal(inspectCandidate('BAD',s,'option',now).status,'REJECTED');
});
test('batch respects cash, pending reservations, risk and duplicates',()=>{
 const p=planSettledCash([candidate(),candidate('MSFT'),candidate('AAPL')],account(),now);
 assert.ok(p.proposals.length>0);assert.ok(p.proposals.reduce((s,p)=>s+p.costCents,0)<=60000);assert.ok(p.proposals.every(p=>p.riskCents<=10000));
 assert.equal(new Set(p.proposals.map(p=>p.symbol)).size,p.proposals.length);assert.equal(p.liveOrdersEnabled,false);
});
for(const [name,patch] of [['missing',null],['stale',{asOf:'2020-01-01'}],['unsettled',{settledCashCents:0}],['margin only',{cashBuyingPowerCents:0}],['uncertain',{uncertainOrders:true}],['fractional cents',{settledCashCents:1.5}],['negative',{openRiskCents:-1}],['risk full',{openRiskCents:50000}],['reserved',{pendingBuyCommitmentsCents:999999}],['duplicate',{exposureSymbols:['AAPL']}],['unreconciled',{reconciled:false}]])test(`cash blocks ${name}`,()=>{
 assert.equal(planSettledCash([candidate()],patch===null?null:{...account(),...patch},now).proposals.length,0);
});
test('options risk entire premium including buffer',()=>{
 const p=planSettledCash([candidate('OPT','option',0.5)],account(),now).proposals[0];assert.ok(p.quantity>0);assert.equal(p.riskCents,p.costCents);assert.ok(p.riskCents<=10000);
 assert.equal(planSettledCash([candidate('OPT','option',100)],account(),now).proposals.length,0);
});
test('GET allowlist, redirects and credential privacy',async()=>{
 const calls=[];const r=new ResearchReader({key:'test-key',secret:'test-secret',transport:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({})};}});
 await r.get('crypto');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'error');assert.ok(!calls[0].url.includes('test-secret'));
 await assert.rejects(r.get('orders'),/READ_DENIED/);await assert.rejects(r.get('options',{symbol:'https://evil'}),/SYMBOL_DENIED/);
});
test('HTTP errors redact provider bodies',async()=>{
 const r=new ResearchReader({key:'test-key',secret:'test-secret',transport:async()=>({ok:false,status:401,text:async()=>'test-secret'})});await assert.rejects(r.get('clock'),/^Error: DATA_HTTP_FAILED$/);
});
test('closed session blocks securities, crypto still scans',async()=>{
 const calls=[];const r=await scan({get:async lane=>{calls.push(lane);return lane==='clock'?{is_open:false,timestamp:t}:{snapshots:Object.fromEntries(UNIVERSE.crypto.map(s=>[s,snap()]))};}},{now});
 assert.deepEqual(calls,['clock','crypto','cryptoBars']);assert.equal(r.lanes.stock,'SESSION_BLOCKED');assert.equal(r.lanes.crypto,'DATA_UNAVAILABLE_OR_INCOMPLETE');assert.equal(r.dailyLossLimitCents,8000);
});
test('unknown session fails closed',async()=>{const r=await scan({get:async()=>{throw Error('private');}},{now});assert.equal(r.lanes.session,'UNVERIFIED');assert.equal(r.candidates.length,0);assert.ok(!JSON.stringify(r).includes('private'));});
test('incomplete and repeated pagination discards option lane',async()=>{
 const r=await scan({get:async lane=>lane==='clock'?{is_open:true,timestamp:t}:lane==='stocks'?Object.fromEntries(UNIVERSE.stocks.map(s=>[s,snap()])):lane==='crypto'?{snapshots:{}}:{snapshots:{AAPL261120C00100000:snap()},next_page_token:'repeat'}},{now});
 assert.equal(r.lanes.option,'DATA_UNAVAILABLE_OR_INCOMPLETE');assert.ok(!r.candidates.some(c=>c.asset==='option'));assert.equal(r.lanes.crypto,'DATA_UNAVAILABLE_OR_INCOMPLETE');
});
test('workflow pins actions, isolates credentials and defaults paused',()=>{
 const w=fs.readFileSync('.github/workflows/trading_bot.yml','utf8');assert.ok(w.includes('*/5 13-21 * * 1-5'));
 assert.ok(!/ROBINHOOD|OPENAI_API_KEY|pull_request_target/.test(w));assert.equal((w.match(/uses: [^\n]+@[0-9a-f]{40}/g)||[]).length,8);
 assert.equal(JSON.parse(fs.readFileSync('.github/trading-bot-control.json')).enabled,false);
 assert.ok(w.includes("action !== 'stop'"));assert.ok(w.includes('persist-credentials: false'));
});
test('successful paginated chain retains all pages',async()=>{
 const s=snap();s.greeks={delta:0.5};s.impliedVolatility=0.3;
 const r=await scan({get:async(lane,args)=>lane==='clock'?{is_open:true,timestamp:t}:lane==='stocks'?Object.fromEntries(UNIVERSE.stocks.map(x=>[x,snap()])):lane==='crypto'?{snapshots:Object.fromEntries(UNIVERSE.crypto.map(x=>[x,snap()]))}:lane.endsWith('Bars')?{bars:{}}:{snapshots:{[`${args.symbol}261120${args.page_token?'P':'C'}00100000`]:s},next_page_token:args.page_token?null:'second'}},{now});
 assert.equal(r.lanes.option,'COMPLETE');assert.equal(r.candidates.filter(c=>c.asset==='option').length,10);
});
test('network retries bounded to three and redact thrown messages',async()=>{
 let count=0;const r=new ResearchReader({key:'test-key',secret:'test-secret',transport:async()=>{count++;throw Error('test-secret');}});
 await assert.rejects(r.get('clock'),/^Error: DATA_NETWORK_FAILED$/);assert.equal(count,3);
});
test('cash and heat invariants across many budgets',()=>{
 for(let n=1;n<=200;n++) {
   const a={...account(),settledCashCents:n*137,pendingBuyCommitmentsCents:n*11,openRiskCents:n*71};
   const p=planSettledCash([candidate('A','stock',n/10),candidate('B','option',n/100),candidate('C','crypto',n/3)],a,now);
   assert.ok(p.proposals.reduce((v,c)=>v+c.costCents,0)<=Math.max(0,Math.min(a.settledCashCents,a.cashBuyingPowerCents)-a.pendingBuyCommitmentsCents));
   assert.ok(p.proposals.reduce((v,c)=>v+c.riskCents,0)+a.openRiskCents<=50000);
   assert.ok(p.proposals.every(c=>c.riskCents<=10000&&Number.isSafeInteger(c.quantity)));
 }
});
