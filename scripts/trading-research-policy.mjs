import fs from 'node:fs/promises';
import path from 'node:path';
export const DEFAULT_STRATEGY=Object.freeze({version:1,maxSpreadBps:150,maxStockSymbols:2000,maxCryptoSymbols:500,discoverAssets:true,batchSize:100,concurrency:3,maxRequests:240,maxRuntimeMs:240000,maxOptionUnderlyings:5,maxHistorySymbols:20,volumeSpikeRatio:2,macroDropFraction:-0.03,earningsBlackoutHours:48,dailyLossLimitCents:8000});
export const validSymbol=(s,asset)=>typeof s==='string'&&(asset==='crypto'?/^[A-Z0-9]{1,15}\/USD$/:asset==='option'?/^[A-Z]{1,6}\d{6}[CP]\d{8}$/:/^[A-Z][A-Z0-9.-]{0,9}$/).test(s);
export const fresh=(t,now,age)=>typeof t==='string'&&Number.isFinite(Date.parse(t))&&now-Date.parse(t)>=0&&now-Date.parse(t)<=age;
// Clock transport can arrive slightly ahead of the local wall clock. This
// tolerance is only for research session observation, never quote eligibility.
export function validResearchClock(clock,now) {
  const age=now-Date.parse(clock?.timestamp);
  return typeof clock?.is_open==='boolean'&&Number.isFinite(age)&&age>=-2000&&age<=60000;
}
export function strategyConfig(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(DEFAULT_STRATEGY,k)))throw Error('STRATEGY_INVALID');
  const c={...DEFAULT_STRATEGY,...input};
  for(const [k,min,max] of [['maxSpreadBps',1,150],['maxStockSymbols',2,10000],['maxCryptoSymbols',1,10000],['batchSize',1,100],['concurrency',1,4],['maxRequests',1,500],['maxRuntimeMs',1000,240000],['maxOptionUnderlyings',1,10],['maxHistorySymbols',1,50],['earningsBlackoutHours',1,168]])if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw Error('STRATEGY_INVALID');
  if(c.version!==1||typeof c.discoverAssets!=='boolean'||!Number.isFinite(c.volumeSpikeRatio)||c.volumeSpikeRatio<1||c.volumeSpikeRatio>20||!Number.isFinite(c.macroDropFraction)||c.macroDropFraction>=0||c.macroDropFraction<-.2)throw Error('STRATEGY_INVALID');
  if(!Number.isSafeInteger(c.dailyLossLimitCents)||c.dailyLossLimitCents<=0)throw Error('DAILY_LIMIT_INVALID');
  return c;
}

export async function loadResearchInputs(root='.',now=Date.now()) {
  const read=async(file,required=false)=>{try{const stat=await fs.stat(path.join(root,file));if(stat.size>16*1024*1024)throw Error();return JSON.parse(await fs.readFile(path.join(root,file),'utf8'));}catch{if(required)throw Error('STRATEGY_UNREADABLE');return null;}};
  const config=strategyConfig(await read('.github/trading-bot-strategy.json',true));
  // Fixed paths only: repository data never controls a URL, shell, credential or order.
  const paths=['docs/data/execution-watchlist.json','docs/data/trigger-board.json','docs/data/broad-stock-universe.json','docs/data/crypto-universe.json','docs/data/small-account-options.json'];
  const stocks=new Set(['SPY','QQQ','AAPL','MSFT','NVDA']),crypto=new Set(['BTC/USD','ETH/USD','SOL/USD']),sources=[],triggers=new Map();
  for(const file of paths) {
    const data=await read(file);const at=data?.publishedAt??data?.generatedAt??data?.lastReconciledAt;
    sources.push({path:file,status:!data?'UNAVAILABLE':fresh(at,now,1800000)?'FRESH':'STALE_SYMBOLS_ONLY'});
    const rows=['positions','items','topCandidates','top20000Preview','ranked'].flatMap(k=>Array.isArray(data?.[k])?data[k]:[]);
    for(const row of rows) {
      const symbol=row?.symbol??row?.ticker;
      const asset=String(row?.assetClass??'').toLowerCase();
      if(asset.includes('crypto')||validSymbol(symbol,'crypto')) {if(validSymbol(symbol,'crypto'))crypto.add(symbol);}
      else if(validSymbol(symbol,'stock'))stocks.add(symbol);
      if(file.endsWith('trigger-board.json')&&fresh(at,now,1800000)&&fresh(row?.signalGeneratedAt,now,1800000)&&Number.isFinite(row?.maximumEntry)&&row.maximumEntry>0)triggers.set(symbol,{price:row.maximumEntry,asOf:row.signalGeneratedAt});
    }
    for(const symbol of Array.isArray(data?.underlyingsScanned)?data.underlyingsScanned:[])if(validSymbol(symbol,'stock'))stocks.add(symbol);
  }
  return {config,universe:{stocks:[...stocks],crypto:[...crypto]},sources,triggers,events:await read('docs/data/trading-bot-events.json')};
}

export function intradaySignal(bars,price,now,config=DEFAULT_STRATEGY) {
  const fail=reason=>({confirmed:false,reasons:[reason],breakout:false,volumeRatio:null});
  if(!Array.isArray(bars))return fail('INTRADAY_UNVERIFIED');
  // Use completed one-minute bars only; exclude the current, partial minute.
  const end=Math.floor(now/60000)*60000;
  const completed=bars.filter(b=>Date.parse(b?.t)<end).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t)).slice(-21);
  if(completed.length<21||!fresh(completed.at(-1)?.t,now,120000))return fail('INTRADAY_UNVERIFIED');
  for(let i=0;i<completed.length;i++) {
    const b=completed[i];
    if(![b.h,b.l,b.c,b.v].every(Number.isFinite)||b.l<=0||b.h<b.l||b.c<b.l||b.c>b.h||b.v<0||!Number.isFinite(Date.parse(b.t))||(i>0&&Date.parse(b.t)-Date.parse(completed[i-1].t)!==60000))return fail('INTRADAY_GAPS_OR_INVALID');
  }
  const baseline=completed.slice(0,-1),last=completed.at(-1),mean=baseline.reduce((s,b)=>s+b.v,0)/20;
  if(mean<=0||!Number.isFinite(price)||price<=0)return fail('INTRADAY_UNVERIFIED');
  const high=Math.max(...baseline.map(b=>b.h)),breakout=price>high&&last.c>high,volumeRatio=last.v/mean;
  return {confirmed:breakout||volumeRatio>=config.volumeSpikeRatio,reasons:breakout||volumeRatio>=config.volumeSpikeRatio?[]:['NO_BREAKOUT_OR_VOLUME_SPIKE'],breakout,volumeRatio,priorHigh:high,barAsOf:last.t};
}

export function antiTradeReasons(candidate,{events,macro,now,config=DEFAULT_STRATEGY}={}) {
  const reasons=[];
  // A stock-market stress check is applied across all lanes, not assumed irrelevant to crypto.
  if(!macro||!fresh(macro.asOf,now,120000)||!Number.isFinite(macro.change))reasons.push('MACRO_UNVERIFIED');
  else if(macro.change<=config.macroDropFraction)reasons.push('MACRO_DRAWDOWN');
  if(candidate.asset==='crypto')return reasons;
  const underlying=candidate.asset==='option'?candidate.symbol.replace(/\d{6}[CP]\d{8}$/,''):candidate.symbol;
  if(['SPY','QQQ'].includes(underlying))return reasons; // Explicit index ETFs; no issuer earnings date.
  const coverage=events?.coverage?.[underlying],through=Date.parse(coverage?.checkedThrough),horizon=now+config.earningsBlackoutHours*3600000;
  if(!events?.source||typeof events.source!=='string'||!fresh(events.generatedAt,now,86400000)||!coverage||!fresh(coverage.checkedAt,now,86400000)||!Number.isFinite(through)||through<horizon||!Array.isArray(coverage.earningsAt)||coverage.earningsAt.some(d=>!Number.isFinite(Date.parse(d))))reasons.push('EARNINGS_UNVERIFIED');
  else if(coverage.earningsAt.some(d=>Date.parse(d)>=now-3600000&&Date.parse(d)<=horizon))reasons.push('EARNINGS_BLACKOUT');
  return reasons;
}

export function researchPacket(report,now=Date.now()) {
  if(report?.mode!=='RESEARCH_ONLY'||report.liveOrdersEnabled!==false||!fresh(report.generatedAt,now,300000)||!Array.isArray(report.candidates))throw Error('PUBLICATION_INVALID');
  const picks=report.candidates.filter(c=>c.status==='WATCH'&&c.signal?.confirmed===true&&c.liveEligible===false&&validSymbol(c.symbol,c.asset)&&['stock','option','crypto'].includes(c.asset)&&['iex','indicative','alpaca-us'].includes(c.feed)&&Number.isFinite(c.ask)&&c.ask>0&&Number.isFinite(c.spread)&&c.spread>=0&&c.spread<=.015&&fresh(c.quoteAsOf,now,120000)&&fresh(c.signal.barAsOf,now,120000)).slice(0,20).map(c=>({symbol:c.symbol,asset:c.asset,ask:c.ask,spread:c.spread,feed:c.feed,quoteAsOf:c.quoteAsOf,barAsOf:c.signal.barAsOf,breakout:c.signal.breakout===true,volumeRatio:Number.isFinite(c.signal.volumeRatio)?c.signal.volumeRatio:null,liveEligible:false}));
  const expiresAt=Math.min(Date.parse(report.generatedAt)+300000,...picks.flatMap(c=>[Date.parse(c.quoteAsOf)+120000,Date.parse(c.barAsOf)+120000]));
  return {schemaVersion:1,generatedAt:report.generatedAt,expiresAt:new Date(expiresAt).toISOString(),mode:'RESEARCH_ONLY',liveOrdersEnabled:false,action:'NO_ACTION',purpose:'Research shortlist; never an order or confirmed fill',candidates:picks};
}
