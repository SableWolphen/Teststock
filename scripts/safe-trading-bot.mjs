// Read-only research. This module deliberately has no broker/order transport.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SAFETY_POLICY} from './safety-policy.mjs';
import {DEFAULT_STRATEGY,strategyConfig,loadResearchInputs,validSymbol,fresh,validResearchClock,intradaySignal,antiTradeReasons,researchPacket} from './trading-research-policy.mjs';
import {evaluateDailyLoss,effectiveDailyLossLimitCents} from './daily-loss-guard.mjs';

const positive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const cents = x => Number.isSafeInteger(x) && x >= 0;
export const UNIVERSE = Object.freeze({stocks:['SPY','QQQ','AAPL','MSFT','NVDA'],crypto:['BTC/USD','ETH/USD','SOL/USD']});

export class ResearchReader {
  constructor({key, secret, transport=fetch,config=DEFAULT_STRATEGY}) {
    if (![key,secret].every(x=>typeof x==='string' && x.length>=8 && !/\s/.test(x))) throw Error('DATA_CREDENTIALS_REQUIRED');
    this.headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret}; this.transport=transport;
    this.config=strategyConfig(config);this.requests=0;this.startedAt=Date.now();this.nextRequestAt=0;
  }
  async get(lane, {symbol, symbols, page_token, now=Date.now()}={}) {
    const routes={clock:'https://paper-api.alpaca.markets/v2/clock',stocks:'https://data.alpaca.markets/v2/stocks/snapshots',crypto:'https://data.alpaca.markets/v1beta3/crypto/us/snapshots',options:'https://data.alpaca.markets/v1beta1/options/snapshots/',stockAssets:'https://paper-api.alpaca.markets/v2/assets',cryptoAssets:'https://paper-api.alpaca.markets/v2/assets',stockBars:'https://data.alpaca.markets/v2/stocks/bars',cryptoBars:'https://data.alpaca.markets/v1beta3/crypto/us/bars',optionBars:'https://data.alpaca.markets/v1beta1/options/bars'};
    if (!Object.hasOwn(routes,lane)) throw Error('READ_DENIED');
    if(lane==='options'&&!validSymbol(symbol,'stock'))throw Error('SYMBOL_DENIED');
    const asset=lane.startsWith('crypto')?'crypto':lane==='optionBars'?'option':'stock';
    const list=symbols??(lane==='crypto'?UNIVERSE.crypto:UNIVERSE.stocks);
    if(['stocks','crypto','stockBars','cryptoBars','optionBars'].includes(lane)&&(!Array.isArray(list)||!list.length||list.length>this.config.batchSize||!list.every(s=>validSymbol(s,asset))))throw Error('SYMBOL_DENIED');
    const url=new URL(routes[lane]+(lane==='options'?symbol:''));
    if(['stocks','crypto','stockBars','cryptoBars','optionBars'].includes(lane))url.searchParams.set('symbols',list.join(','));
    if(['stocks','stockBars'].includes(lane))url.searchParams.set('feed','iex');
    if(lane.endsWith('Assets')) {url.searchParams.set('status','active');url.searchParams.set('asset_class',lane==='stockAssets'?'us_equity':'crypto');}
    if(lane.endsWith('Bars')) {
      if(!Number.isFinite(now))throw Error('QUERY_DENIED');
      url.searchParams.set('timeframe','1Min');url.searchParams.set('start',new Date(now-30*60000).toISOString());url.searchParams.set('end',new Date(now).toISOString());url.searchParams.set('limit','10000');url.searchParams.set('sort','asc');
      // Option bars have no documented feed selector; quote provenance stays indicative.
      if(page_token)url.searchParams.set('page_token',page_token);
    }
    if(lane==='options') {url.searchParams.set('feed','indicative');url.searchParams.set('limit','1000');if(page_token)url.searchParams.set('page_token',page_token);}
    // Bounded GET retries only; never log provider bodies, URLs or credentials.
    for(let attempt=0;attempt<3;attempt++) {
      const slot=Math.max(Date.now(),this.nextRequestAt);this.nextRequestAt=slot+350;
      if(this.requests>=this.config.maxRequests||slot-this.startedAt>=this.config.maxRuntimeMs)throw Error('DATA_BUDGET_EXHAUSTED');
      this.requests++;
      if(slot>Date.now())await new Promise(resolve=>setTimeout(resolve,slot-Date.now()));
      let response;
      try {response=await this.transport(url.href,{method:'GET',headers:this.headers,redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(10000,this.config.maxRuntimeMs-(Date.now()-this.startedAt))))});}
      catch {if(attempt===2)throw Error('DATA_NETWORK_FAILED');continue;}
      if(response.ok) {try{return await response.json();}catch{throw Error('DATA_INVALID_JSON');}}
      if(![429,500,502,503,504].includes(response.status)||attempt===2) {
        const error=Error('DATA_HTTP_FAILED');error.code=`DATA_HTTP_${response.status}`;throw error;
      }
      await new Promise(resolve=>setTimeout(resolve,250*2**attempt));
    }
  }
}

export function inspectCandidate(symbol, snapshot, asset, now=Date.now(),config=DEFAULT_STRATEGY) {
  const q=snapshot?.latestQuote, prev=snapshot?.prevDailyBar, trade=snapshot?.latestTrade;
  const reasons=[];
  if(!validSymbol(symbol,asset))reasons.push('INVALID_SYMBOL');
  if(!q || !positive(q.bp)||!positive(q.ap)||q.ap<q.bp||!positive(q.bs)||!positive(q.as)) reasons.push('INVALID_QUOTE');
  if(!fresh(q?.t,now,120000)) reasons.push('STALE_QUOTE');
  const spread=q && (q.ap-q.bp)/((q.ap+q.bp)/2);
  if(!Number.isFinite(spread)||spread>config.maxSpreadBps/10000) reasons.push('WIDE_SPREAD');
  let momentum=null;
  if(asset==='option') {
    const match=/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol);
    const expiry=match ? Date.parse(`20${match[2]}-${match[3]}-${match[4]}T21:00:00Z`) : NaN;
    const dte=(expiry-now)/86400000;
    if(!Number.isFinite(dte)||dte<7||dte>90) reasons.push('OPTION_EXPIRY');
    const delta=Math.abs(snapshot?.greeks?.delta);
    if(!positive(delta)||delta<0.2||delta>0.8||!positive(snapshot?.impliedVolatility)||snapshot.impliedVolatility>2) reasons.push('OPTION_GREEKS');
    reasons.push('INDICATIVE_RESEARCH_ONLY');
  } else {
    if(!positive(prev?.c)||!positive(prev?.v)||!positive(trade?.p)||!fresh(trade?.t,now,120000)) reasons.push('MISSING_MOMENTUM_DATA');
    else {momentum=trade.p/prev.c-1;if(momentum<=0||momentum>0.15)reasons.push('MOMENTUM_FILTER');}
  }
  return {symbol,asset,feed:asset==='stock'?'iex':asset==='option'?'indicative':'alpaca-us',researchOnly:true,liveEligible:false,
    status:reasons.some(r=>r!=='INDICATIVE_RESEARCH_ONLY')?'REJECTED':'WATCH',reasons,
    ask:positive(q?.ap)?q.ap:null,spread:Number.isFinite(spread)?spread:null,momentum};
}

// All money is integer cents. Snapshot must be independently reconciled and private.
// Pending buy reservations must include remaining notional and fees, even if cash already excludes them.
export function planSettledCash(candidates, account, now=Date.now(),config=DEFAULT_STRATEGY) {
  const blocked=code=>({mode:'RESEARCH_ONLY',liveOrdersEnabled:false,blockers:[code],proposals:[]});
  if(!account||account.source!=='robinhood'||account.reconciled!==true||account.uncertainOrders!==false||!fresh(account.asOf,now,60000))return blocked('ACCOUNT_NOT_VERIFIED');
  const daily=evaluateDailyLoss(account,account.dailyLossState,effectiveDailyLossLimitCents(account.equityCents,config.dailyLossLimitCents),now);
  if(!daily.allowed)return blocked(daily.reason);
  const keys=['equityCents','settledCashCents','cashBuyingPowerCents','pendingBuyCommitmentsCents','openRiskCents'];
  if(!keys.every(k=>cents(account[k]))||!account.equityCents||!Array.isArray(account.exposureSymbols)||!account.exposureSymbols.every(s=>typeof s==='string'))return blocked('INVALID_ACCOUNT');
  let cash=Math.max(0,Math.min(account.settledCashCents,account.cashBuyingPowerCents)-account.pendingBuyCommitmentsCents);
  const perTrade=Math.floor(account.equityCents/100);
  let heat=Math.max(0,Math.floor(account.equityCents*0.05)-account.openRiskCents);
  const seen=new Set(account.exposureSymbols), proposals=[];
  for(const c of candidates) {
    if(!['stock','crypto','option'].includes(c.asset)||typeof c.symbol!=='string'||c.status!=='WATCH'||seen.has(c.symbol)||!positive(c.ask))continue;
    // Whole stock/crypto units; long options risk the entire premium, not a synthetic stop.
    const unitCost=Math.ceil(c.ask*100*(c.asset==='option'?100:1)*1.01);
    if(!Number.isSafeInteger(unitCost)||unitCost<=0)continue;
    const unitRisk=c.asset==='option'?unitCost:Math.ceil(unitCost*0.03);
    const quantity=Math.min(Math.floor(cash/unitCost),Math.floor(Math.min(perTrade,heat)/unitRisk));
    if(quantity<=0)continue;
    const costCents=quantity*unitCost,riskCents=quantity*unitRisk;
    cash-=costCents;heat-=riskCents;seen.add(c.symbol);
    proposals.push({symbol:c.symbol,asset:c.asset,quantity,costCents,riskCents,liveEligible:false,requires:'BROKER_CAPABILITY_SECURITY_PROTECTION_AND_ADMISSION_TESTING'});
  }
  return {mode:'RESEARCH_ONLY',liveOrdersEnabled:false,blockers:['LIVE_EXECUTION_LOCKED'],proposals,remainingCashCents:cash};
}

const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));
async function pool(items,limit,fn) {
  let cursor=0;const results=[];
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const index=cursor++;try{results[index]={ok:true,value:await fn(items[index])};}catch(error){results[index]={ok:false,code:/^DATA_HTTP_\d{3}$/.test(error?.code)?error.code:'DATA_READ_FAILED'};}}}));
  return results;
}
export async function scan(reader,{now=Date.now(),scope='BROAD',inputs={universe:UNIVERSE,config:DEFAULT_STRATEGY,sources:[],triggers:new Map(),events:null}}={}) {
  // Research has no order transport and stays read-only even after a separately
  // verified connected-executor deployment. Bootstrap overrides remain forbidden.
  if(SAFETY_POLICY.bootstrapAllowed!==false)throw Error('UNSAFE_BOOTSTRAP_POLICY');
  if(!['BROAD','CURRENT_ACCESS_CORE'].includes(scope))throw Error('RESEARCH_SCOPE_INVALID');
  // A separate, declared research universe. This never reclassifies omissions
  // from the broad scan as complete, or upgrades indicative/delayed options.
  if(scope==='CURRENT_ACCESS_CORE')inputs={...inputs,universe:UNIVERSE,config:{...inputs.config,discoverAssets:false}};
  const started=Date.now(),config=strategyConfig(inputs.config),requested={stocks:[...new Set(['SPY',...inputs.universe.stocks])],crypto:[...new Set(inputs.universe.crypto)]};
  const evaluationNow=()=>now+(Date.now()-started);
  const report={generatedAt:new Date(now).toISOString(),mode:'RESEARCH_ONLY',liveOrdersEnabled:false,dailyLossLimitCents:config.dailyLossLimitCents,dailyLossGate:'PRIVATE_ACCOUNT_AND_PERSISTED_STATE_REQUIRED',candidates:[],lanes:{},sources:inputs.sources??[],coverage:{},metrics:{}};
  report.scope=scope;
  report.scopeDescription=scope==='CURRENT_ACCESS_CORE'?'Five named IEX stock symbols and three named Alpaca US crypto pairs; options excluded because current recent-history access is unverified.':'Bounded broad provider discovery; omissions remain incomplete.';
  let macro=null;
  let marketOpen=false;
  try {const clock=await reader.get('clock');if(!validResearchClock(clock,evaluationNow()))throw Error();marketOpen=clock.is_open;report.lanes.session=marketOpen?'OPEN':'CLOSED';}
  catch {report.lanes.session='UNVERIFIED';}
  const rowsByAsset={stock:new Map(),crypto:new Map(),option:new Map()};
  const waitForObservationTime=async assets=>{
    const at=evaluationNow(),remaining=config.maxRuntimeMs-(Date.now()-started);
    const times=assets.flatMap(asset=>[...rowsByAsset[asset].values()].flatMap(s=>[s?.latestQuote?.t,s?.latestTrade?.t].map(t=>Date.parse(t)))).filter(t=>Number.isFinite(t)&&t>at&&t-at<=2000);
    const wait=times.length?Math.max(...times)-at+1:0;
    // Wait for a slightly ahead provider clock to reach local time. The normal
    // strict quote/trade freshness check still rejects every future timestamp.
    if(wait>0&&wait<remaining)await new Promise(resolve=>setTimeout(resolve,wait));
  };
  for(const asset of ['stock','crypto']) {
    if(asset!=='crypto'&&!marketOpen) {report.lanes[asset]='SESSION_BLOCKED';continue;}
    const key=asset==='stock'?'stocks':'crypto',all=new Set(requested[key].filter(s=>validSymbol(s,asset)));
    let discovery='NOT_REQUESTED';
    if(config.discoverAssets)try {
      const assets=await reader.get(asset==='stock'?'stockAssets':'cryptoAssets');if(!Array.isArray(assets))throw Error();
      for(const a of assets)if(a.status==='active'&&a.tradable===true&&validSymbol(a.symbol,asset))all.add(a.symbol);
      discovery='COMPLETE';
    }catch{discovery='UNAVAILABLE';}
    const symbols=[...all].slice(0,asset==='stock'?config.maxStockSymbols:config.maxCryptoSymbols),rows=rowsByAsset[asset];
    const batches=await pool(chunks(symbols,config.batchSize),config.concurrency,async batch=>{
      const data=await reader.get(key,{symbols:batch});const snapshots=asset==='stock'?data:data.snapshots;
      if(!snapshots||typeof snapshots!=='object'||Array.isArray(snapshots))throw Error();
      let missing=0;for(const symbol of batch){if(snapshots[symbol])rows.set(symbol,snapshots[symbol]);else missing++;}return missing;
    });
    // Retry only missing snapshots once within the same reader's request/time budget.
    // A persistent omission is not an empty successful observation or an excluded asset.
    const missing=symbols.filter(s=>!rows.has(s));
    const retries=await pool(chunks(missing,config.batchSize),config.concurrency,async batch=>{
      const data=await reader.get(key,{symbols:batch});const snapshots=asset==='stock'?data:data.snapshots;
      if(!snapshots||typeof snapshots!=='object'||Array.isArray(snapshots))throw Error();
      for(const symbol of batch)if(snapshots[symbol])rows.set(symbol,snapshots[symbol]);
    });
    const missingSymbols=symbols.filter(s=>!rows.has(s));
    report.coverage[asset]={discovery,discovered:all.size,requested:symbols.length,received:rows.size,truncated:all.size>symbols.length,batchFailures:batches.filter(r=>!r.ok).length,retryFailures:retries.filter(r=>!r.ok).length,retried:missing.length,recovered:missing.length-missingSymbols.length,missingSnapshots:missingSymbols.length,missingSymbols,errorCodes:[...new Set([...batches,...retries].filter(r=>!r.ok).map(r=>r.code))]};
    report.lanes[asset]=discovery!=='UNAVAILABLE'&&!missingSymbols.length?'COMPLETE':'DATA_UNAVAILABLE_OR_INCOMPLETE';
  }
  await waitForObservationTime(['stock','crypto']);
  const spy=rowsByAsset.stock.get('SPY');
  const spyQuote=spy?.latestQuote;
  const validSpyQuote=spyQuote&&[spyQuote.ap,spyQuote.bp,spyQuote.as,spyQuote.bs].every(positive)&&spyQuote.ap>=spyQuote.bp&&(spyQuote.ap-spyQuote.bp)/((spyQuote.ap+spyQuote.bp)/2)<=config.maxSpreadBps/10000;
  if(validSpyQuote&&fresh(spyQuote.t,evaluationNow(),120000)&&fresh(spy.latestTrade?.t,evaluationNow(),120000)&&positive(spy.latestTrade?.p)&&positive(spy.prevDailyBar?.c)&&fresh(spy.prevDailyBar?.t,evaluationNow(),7*86400000))macro={asOf:spy.latestTrade.t,change:spy.latestTrade.p/spy.prevDailyBar.c-1};
  report.macro=macro?{...macro,status:macro.change<=config.macroDropFraction?'BLOCKED':'CLEAR'}:{status:'UNVERIFIED'};
  const prelim=asset=>[...rowsByAsset[asset]].map(([s,v])=>inspectCandidate(s,v,asset,evaluationNow(),config)).filter(c=>c.status==='WATCH').sort((a,b)=>(b.momentum??-1)-(a.momentum??-1)||a.symbol.localeCompare(b.symbol));
  const underlyings=marketOpen?prelim('stock').slice(0,config.maxOptionUnderlyings).map(c=>c.symbol):[];
  if(scope==='CURRENT_ACCESS_CORE')report.lanes.option='EXCLUDED_CURRENT_ACCESS';
  else if(!marketOpen)report.lanes.option='SESSION_BLOCKED';
  else {
    const chains=await pool(underlyings,config.concurrency,async symbol=>{
      const rows=new Map();let token;const tokens=new Set();
      for(let page=0;page<5;page++) {
        const data=await reader.get('options',{symbol,page_token:token});if(!data.snapshots||typeof data.snapshots!=='object'||Array.isArray(data.snapshots)||Object.keys(data.snapshots).length>1000)throw Error();
        for(const [s,v]of Object.entries(data.snapshots)){if(!validSymbol(s,'option')||!s.startsWith(symbol)||s.replace(/\d{6}[CP]\d{8}$/,'')!==symbol)throw Error();rows.set(s,v);}
        token=data.next_page_token;if(!token)return rows;if(typeof token!=='string'||tokens.has(token))throw Error();tokens.add(token);
      }throw Error();
    });
    for(const result of chains)if(result.ok)for(const [s,v]of result.value)rowsByAsset.option.set(s,v);
    report.lanes.option=chains.every(r=>r.ok)?'COMPLETE':'DATA_UNAVAILABLE_OR_INCOMPLETE';
    report.coverage.option={underlyings:underlyings.length,received:rowsByAsset.option.size,chainFailures:chains.filter(r=>!r.ok).length};
  }
  await waitForObservationTime(['option']);
  for(const asset of ['stock','crypto','option']) {
    const shortlist=prelim(asset).slice(0,config.maxHistorySymbols),histories=new Map();
    const reads=await pool(chunks(shortlist.map(c=>c.symbol),config.batchSize),config.concurrency,async symbols=>{
      let token;const tokens=new Set(),local=new Map();
      for(let page=0;page<5;page++) {
        const data=await reader.get(`${asset}Bars`,{symbols,now:evaluationNow(),page_token:token});if(!data.bars||typeof data.bars!=='object'||Array.isArray(data.bars))throw Error();
        for(const s of symbols){if(data.bars[s]&&!Array.isArray(data.bars[s]))throw Error();local.set(s,[...(local.get(s)??[]),...(data.bars[s]??[])]);}
        token=data.next_page_token;if(!token){for(const [s,b]of local)histories.set(s,b);return;}
        if(typeof token!=='string'||tokens.has(token))throw Error();tokens.add(token);
      }throw Error();
    });
    const historyReceived=[...histories.values()].filter(b=>b.length>0).length;
    if(reads.some(r=>!r.ok)||historyReceived<shortlist.length)report.lanes[asset]='DATA_UNAVAILABLE_OR_INCOMPLETE';
    for(const [s,v]of rowsByAsset[asset]) {
      const c=inspectCandidate(s,v,asset,evaluationNow(),config);
      c.signal=intradaySignal(histories.get(s),v.latestTrade?.p,evaluationNow(),config);
      c.reasons.push(...c.signal.reasons,...antiTradeReasons(c,{events:inputs.events,macro,now:evaluationNow(),config}));
      const trigger=inputs.triggers?.get(s);
      if(trigger&&v.latestTrade?.p>trigger.price)c.repositoryTriggerCrossed=true;
      if(c.reasons.some(r=>r!=='INDICATIVE_RESEARCH_ONLY'))c.status='REJECTED';
      report.candidates.push(c);
    }
    if(report.coverage[asset])Object.assign(report.coverage[asset],{historyRequested:shortlist.length,historyReceived,historyMissing:shortlist.length-historyReceived,historyFailures:reads.filter(r=>!r.ok).length,errorCodes:[...new Set([...(report.coverage[asset].errorCodes??[]),...reads.filter(r=>!r.ok).map(r=>r.code)])]});
  }
  report.candidates.sort((a,b)=>(b.momentum??-1)-(a.momentum??-1)||a.symbol.localeCompare(b.symbol));
  // Recheck after all reads so early batches cannot become stale while later lanes run.
  const completedAt=evaluationNow();
  for(const c of report.candidates) {
    const snapshot=rowsByAsset[c.asset].get(c.symbol);
    c.quoteAsOf=snapshot?.latestQuote?.t??null;
    if(!fresh(c.quoteAsOf,completedAt,120000)||!fresh(snapshot?.latestTrade?.t,completedAt,120000)||!fresh(c.signal.barAsOf,completedAt,120000))c.reasons.push('STALE_AT_COMPLETION');
    c.reasons=[...new Set([...c.reasons,...antiTradeReasons(c,{events:inputs.events,macro,now:completedAt,config})])];
    if(c.reasons.some(r=>r!=='INDICATIVE_RESEARCH_ONLY'))c.status='REJECTED';
  }
  report.metrics={elapsedMs:Date.now()-started,requests:reader.requests??null,intradayConfirmed:report.candidates.filter(c=>c.signal?.confirmed).length,watchCount:report.candidates.filter(c=>c.status==='WATCH').length};
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const output=path.resolve('work/trading-bot-report.json');await fs.mkdir(path.dirname(output),{recursive:true});
    await fs.rm(output,{force:true});await fs.rm(path.resolve('work/trading-bot-payload.json'),{force:true});
    const inputs=await loadResearchInputs();
    const report=await scan(new ResearchReader({key:process.env.ALPACA_API_KEY,secret:process.env.ALPACA_API_SECRET,config:inputs.config}),{inputs,scope:process.env.TESTSTOCK_RESEARCH_SCOPE||'BROAD'});
    await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    await fs.writeFile(path.resolve('work/trading-bot-payload.json'),JSON.stringify(researchPacket(report),null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({mode:report.mode,lanes:report.lanes,candidateCount:report.candidates.length}));
    if(report.macro?.status==='UNVERIFIED'||Object.values(report.lanes).some(s=>['UNVERIFIED','DATA_UNAVAILABLE_OR_INCOMPLETE'].includes(s)))process.exitCode=2;
  } catch {console.error('SAFE_SCANNER_FAILED');process.exitCode=1;}
}
