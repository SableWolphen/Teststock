import fs from 'node:fs/promises';

const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const [board,adaptive,signal]=await Promise.all([
  read('docs/data/trigger-board.json',{}),
  read('docs/data/adaptive-performance.json',{}),
  read('docs/signal.json',{})
]);
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const now=new Date();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJson(url){let last;for(let i=0;i<3;i++){try{const r=await fetch(url,{headers});if(r.ok)return r.json();last=new Error(`Alpaca ${r.status}: ${await r.text()}`);}catch(e){last=e;}await sleep(200*(2**i));}throw last;}
const num=x=>Number(x), finite=x=>Number.isFinite(num(x));
const pct=(a,b)=>b?((a/b)-1)*100:0;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function barsOf(raw,symbol){return raw?.bars?.[symbol]||raw?.bars||[];}
function vwap(bars){let pv=0,v=0;for(const b of bars){const vol=num(b.v)||0,typ=(num(b.h)+num(b.l)+num(b.c))/3;if(vol>0&&finite(typ)){pv+=typ*vol;v+=vol;}}return v?pv/v:null;}
function average(a){const x=a.filter(finite).map(num);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;}
function features(b1,b5,assetClass){
  const last1=b1.at(-1),prev1=b1.at(-2),last5=b5.at(-1),prev5=b5.at(-2);if(!last1||!last5)return null;
  const price=num(last1.c),vw=vwap(assetClass==='STOCK'?b1:b5),mom1=prev1?pct(price,num(prev1.c)):0,mom5=prev5?pct(num(last5.c),num(prev5.c)):0;
  const recentVol=b1.slice(-5).map(x=>num(x.v)||0),baseVol=b1.slice(-30,-5).map(x=>num(x.v)||0),rvBase=average(baseVol)||average(recentVol)||0,relVol=rvBase>0?(average(recentVol)||0)/rvBase:null;
  const highs=b5.slice(-12).map(x=>num(x.h)).filter(finite),lows=b5.slice(-12).map(x=>num(x.l)).filter(finite),rangeHigh=highs.length?Math.max(...highs):null,rangeLow=lows.length?Math.min(...lows):null;
  let openingRange=null;
  if(assetClass==='STOCK'){
    const ny=b1.filter(b=>{const d=new Date(b.t);const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);return parts>='09:30'&&parts<='10:00';});
    if(ny.length)openingRange={high:Math.max(...ny.map(x=>num(x.h))),low:Math.min(...ny.map(x=>num(x.l)))};
  }
  const aboveVwap=finite(vw)&&price>vw,belowVwap=finite(vw)&&price<vw;
  const orbBreakout=openingRange&&price>openingRange.high,orbFailure=openingRange&&price<openingRange.low;
  const momentumAcceleration=mom1>0&&mom5>0&&mom1>mom5/5;
  let score=50;
  if(aboveVwap)score+=12;if(belowVwap)score-=10;
  if(relVol!=null)score+=clamp((relVol-1)*12,-12,18);
  score+=clamp(mom1*8,-12,12)+clamp(mom5*4,-12,12);
  if(momentumAcceleration)score+=8;if(orbBreakout)score+=12;if(orbFailure)score-=15;
  if(rangeHigh&&price>=rangeHigh*.999)score+=5;if(rangeLow&&price<=rangeLow*1.001)score-=5;
  score=clamp(Math.round(score),0,100);
  const regime=score>=70?'MOMENTUM_TREND':score<=35?'WEAK_OR_REVERSING':'MIXED';
  return {price,vwap:vw,aboveVwap,relVol,momentum1mPct:mom1,momentum5mPct:mom5,momentumAcceleration,openingRange,orbBreakout:Boolean(orbBreakout),orbFailure:Boolean(orbFailure),rangeHigh,rangeLow,score,regime};
}
function setupTag(f){if(f.orbBreakout&&f.relVol>=1.2)return 'OPENING_RANGE_BREAKOUT';if(f.aboveVwap&&f.momentumAcceleration)return 'VWAP_MOMENTUM_CONTINUATION';if(f.aboveVwap&&f.momentum5mPct>0)return 'VWAP_TREND';if(!f.aboveVwap&&f.momentum5mPct<0)return 'WEAK_LONG_SETUP';return 'MIXED_INTRADAY';}
function adaptiveBucket(tag){const xs=adaptive?.buckets?.bySetupType||[];return xs.find(x=>String(x.key||x.setupType||'').toUpperCase()===tag)||null;}
function candidateMeta(item){const all=[...(signal.stockPlan?.stockCandidateQueue||[]),...(signal.stockPlan?.stockOrders||[]),...(signal.cryptoPlan?.cryptoOrders||[])];return all.find(x=>x?.ticker===item.ticker)||{};}
function eventRisk(meta){const raw=String(meta?.eventRisk?.state||meta?.eventRisk||meta?.catalystRisk?.state||meta?.earningsRisk||'UNKNOWN').toUpperCase();const high=/BLOCK|HIGH|IMMINENT|EARNINGS|HALT|BINARY/.test(raw);return {raw,high};}
function costAdjustedEdge(item,f,learn){
  const rr=Math.max(num(item.rewardRisk)||1,1),learningR=finite(learn?.shrunkAverageR)?num(learn.shrunkAverageR):finite(learn?.averageRealizedR)?num(learn.averageRealizedR):0;
  const slippage=finite(adaptive?.executionQuality?.averageAdverseEntrySlippagePct)?Math.max(num(adaptive.executionQuality.averageAdverseEntrySlippagePct),0):0;
  const raw=(f.score/100)*rr + clamp(learningR,-1,1)*0.35 - clamp(slippage*2,0,0.5);
  return Number(raw.toFixed(3));
}
const entryItems=(board.items||[]).filter(x=>x?.kind==='ENTRY'&&x?.ticker);
const stockSyms=[...new Set(entryItems.filter(x=>x.assetClass==='STOCK').map(x=>x.ticker))];
const cryptoSyms=[...new Set(entryItems.filter(x=>x.assetClass==='CRYPTO').map(x=>x.ticker))];
const map=new Map(),errors=[];let spy=null,qqq=null,btc=null;
async function loadStocks(){if(!stockSyms.length)return;try{const symbols=[...new Set([...stockSyms,'SPY','QQQ'])];const start=new Date(now.getTime()-8*60*60*1000).toISOString();const qs=new URLSearchParams({symbols:symbols.join(','),timeframe:'1Min',start,limit:'10000',feed:'iex'});const one=await getJson(`https://data.alpaca.markets/v2/stocks/bars?${qs}`);qs.set('timeframe','5Min');const five=await getJson(`https://data.alpaca.markets/v2/stocks/bars?${qs}`);for(const s of symbols){const f=features(barsOf(one,s),barsOf(five,s),'STOCK');if(!f)continue;if(s==='SPY')spy=f;else if(s==='QQQ')qqq=f;else map.set(`STOCK:${s}`,f);}}catch(e){errors.push(`stocks: ${e.message}`);}}
async function loadCrypto(){if(!cryptoSyms.length)return;try{const symbols=[...new Set([...cryptoSyms,'BTC/USD'])];const start=new Date(now.getTime()-8*60*60*1000).toISOString();const qs=new URLSearchParams({symbols:symbols.join(','),timeframe:'1Min',start,limit:'10000'});const one=await getJson(`https://data.alpaca.markets/v1beta3/crypto/us/bars?${qs}`);qs.set('timeframe','5Min');const five=await getJson(`https://data.alpaca.markets/v1beta3/crypto/us/bars?${qs}`);for(const s of symbols){const f=features(barsOf(one,s),barsOf(five,s),'CRYPTO');if(!f)continue;if(s==='BTC/USD')btc=f;else map.set(`CRYPTO:${s}`,f);}}catch(e){errors.push(`crypto: ${e.message}`);}}
await Promise.all([loadStocks(),loadCrypto()]);
const generatedAt=now.toISOString();
for(const item of board.items||[]){
  if(item?.kind!=='ENTRY'||!item?.ticker)continue;
  const f=map.get(`${item.assetClass}:${item.ticker}`);
  if(!f){item.intradayEdge={status:'UNAVAILABLE_FAIL_CLOSED',generatedAt};continue;}
  const tag=setupTag(f),learn=adaptiveBucket(tag),meta=candidateMeta(item),evt=eventRisk(meta);
  let benchmark=null,relativeStrengthPct=null,marketRegime='UNKNOWN';
  if(item.assetClass==='STOCK'){
    benchmark=(Math.abs(spy?.momentum5mPct||0)>=Math.abs(qqq?.momentum5mPct||0)?spy:qqq)||spy||qqq;
    if(benchmark){relativeStrengthPct=Number((f.momentum5mPct-benchmark.momentum5mPct).toFixed(4));marketRegime=(spy?.score>=60||qqq?.score>=60)?'RISK_ON_TREND':(spy?.score<=40&&qqq?.score<=40)?'RISK_OFF_WEAK':'CHOPPY_MIXED';}
  }else if(btc){benchmark=btc;relativeStrengthPct=Number((f.momentum5mPct-btc.momentum5mPct).toFixed(4));marketRegime=btc.score>=60?'BTC_RISK_ON':btc.score<=40?'BTC_RISK_OFF':'BTC_MIXED';}
  let adjustedScore=f.score;
  if(relativeStrengthPct!=null)adjustedScore+=clamp(relativeStrengthPct*8,-10,10);
  if(item.assetClass==='STOCK'&&marketRegime==='RISK_OFF_WEAK')adjustedScore-=8;
  if(item.assetClass==='CRYPTO'&&marketRegime==='BTC_RISK_OFF')adjustedScore-=8;
  if(evt.high)adjustedScore-=25;
  if(learn?.temporaryBlock===true)adjustedScore-=30;
  adjustedScore=clamp(Math.round(adjustedScore),0,100);
  const edge=costAdjustedEdge(item,{...f,score:adjustedScore},learn);
  const learnedSize=finite(learn?.sizeMultiplier)?clamp(num(learn.sizeMultiplier),0.25,1):1;
  const strong=adjustedScore>=65&&edge>=1.3&&(!finite(f.relVol)||f.relVol>=0.9)&&!evt.high&&learn?.temporaryBlock!==true;
  const weak=adjustedScore<40||tag==='WEAK_LONG_SETUP'||evt.high||learn?.temporaryBlock===true;
  const sizeMultiplier=weak?0.25:strong?learnedSize:Math.min(0.6,learnedSize);
  item.intradayEdge={status:'FRESH',generatedAt,setup:tag,...f,adjustedScore,marketRegime,relativeStrengthPct,benchmark5mMomentumPct:benchmark?.momentum5mPct??null,eventRisk:evt,realFillLearning:{state:adaptive?.performanceState||adaptive?.status||'UNKNOWN',bucket:learn,executionQuality:adaptive?.executionQuality||null},costAdjustedEdge:edge,executionCostNote:'Robinhood live spread/slippage check is mandatory immediately before order; expected edge must remain positive after current spread.',profitProtection:{armAfterR:0.6,moveStopTowardBreakevenAfterR:0.8,trailAfterR:1.1,neverWidenStop:true,protectWinnerBeforeGiveback:true},adaptiveSizing:{mode:'EDGE_AND_REAL_FILL_WEIGHTED_WITHIN_EXISTING_RISK_CAP',multiplier:sizeMultiplier,mayNotIncreaseExistingRiskCap:true},regimeRouting:{preferred:marketRegime.includes('RISK_ON')||marketRegime.includes('TREND')?['OPENING_RANGE_BREAKOUT','VWAP_MOMENTUM_CONTINUATION','VWAP_TREND']:['VWAP_TREND','MIXED_INTRADAY'],cashAllowed:true}};
  if(['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER','CRYPTO_SEED_LANE_BUY_TRIGGER'].includes(item.status)){
    if(weak){item.status='BLOCKED_INTRADAY_EDGE';item.reason=`Intraday edge blocked: score ${adjustedScore}/100, setup ${tag}, regime ${marketRegime}${evt.high?', elevated event risk':''}.`;}
    else if(!strong){item.status='WAIT_INTRADAY_CONFIRMATION';item.reason=`Research qualifies, but intraday confirmation is ${adjustedScore}/100 (${tag}, ${marketRegime}); wait for stronger VWAP/volume/relative-strength confirmation.`;}
    else item.reason=`Fresh intraday confirmation ${adjustedScore}/100 (${tag}, ${marketRegime}); real-fill-adjusted size ${sizeMultiplier.toFixed(2)}x. Immediate Robinhood spread/price/risk/protection recheck still required.`;
  }
}
const actionable=new Set(['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER','CRYPTO_SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_FORCED_EXIT','TRIGGER_1_STOP','TRIGGER_2_TARGET1','TRIGGER_3_TARGET2']);
board.events=(board.items||[]).filter(x=>actionable.has(x.status)).map(x=>({id:x.id,assetClass:x.assetClass,ticker:x.ticker,trigger:x.status,entryTier:x.entryTier??null,setupGrade:x.setupGrade??null,queueRank:x.queueRank??null,rewardRisk:x.rewardRisk??null,intradayEdge:x.intradayEdge??null,reason:x.reason??null}));
board.executionNeeded=board.events.length>0;
board.intradayEngine={schemaVersion:2,generatedAt,status:errors.length?'DEGRADED':'OK',errors,benchmarks:{spy:spy?{score:spy.score,momentum5mPct:spy.momentum5mPct}:null,qqq:qqq?{score:qqq.score,momentum5mPct:qqq.momentum5mPct}:null,btc:btc?{score:btc.score,momentum5mPct:btc.momentum5mPct}:null},features:['1m momentum','5m momentum','VWAP','relative volume','opening range breakout','momentum acceleration','SPY/QQQ relative strength','BTC context','market regime routing','event-risk suppression','setup-specific real-fill learning','execution-cost expectancy','adaptive sizing','profit protection'],profitGivebackPolicy:{enabled:true,source:'ROBINHOOD_CONFIRMED_REALIZED_AND_UNREALIZED_PNL_AT_EXECUTION_TIME',reduceRiskAfterGivebackPct:35,stopNewRiskAfterGivebackPct:50,onlyWhenDayPnlPositive:true,note:'Executor must calculate from fresh broker-confirmed state; repository snapshots never invent PnL.'},policy:'Intraday edge may block, reorder, or reduce size but may never create eligibility or increase maximum risk. Stale/unavailable data fails closed for new entries; exits remain prioritized.'};
await Promise.all([write('docs/data/trigger-board.json',board),write('docs/data/intraday-edge.json',{schemaVersion:2,generatedAt,status:board.intradayEngine.status,errors,benchmarks:board.intradayEngine.benchmarks,profitGivebackPolicy:board.intradayEngine.profitGivebackPolicy,items:(board.items||[]).filter(x=>x.intradayEdge).map(x=>({id:x.id,ticker:x.ticker,assetClass:x.assetClass,status:x.status,intradayEdge:x.intradayEdge}))})]);
console.log(`Intraday edge overlay v2: ${map.size}/${entryItems.length} candidates enriched; executionNeeded=${board.executionNeeded}; errors=${errors.length}`);
