import fs from 'node:fs/promises';

const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const board=await read('docs/data/trigger-board.json',{});
const adaptive=await read('docs/data/adaptive-performance.json',{});
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
  if(relVol!=null){score+=clamp((relVol-1)*12,-12,18);}
  score+=clamp(mom1*8,-12,12)+clamp(mom5*4,-12,12);
  if(momentumAcceleration)score+=8;if(orbBreakout)score+=12;if(orbFailure)score-=15;
  if(rangeHigh&&price>=rangeHigh*.999)score+=5;if(rangeLow&&price<=rangeLow*1.001)score-=5;
  score=clamp(Math.round(score),0,100);
  const regime=score>=70?'MOMENTUM_TREND':score<=35?'WEAK_OR_REVERSING':'MIXED';
  return {price,vwap:vw,aboveVwap,relVol,momentum1mPct:mom1,momentum5mPct:mom5,momentumAcceleration,openingRange,orbBreakout:Boolean(orbBreakout),orbFailure:Boolean(orbFailure),rangeHigh,rangeLow,score,regime};
}
function costAdjustedEdge(item,f){
  const rr=num(item.rewardRisk)||0;
  const spreadPenalty=0; // live Robinhood spread remains authoritative immediately before order.
  const raw=(f.score/100)*Math.max(rr,1)-spreadPenalty;
  return Number(raw.toFixed(3));
}
function setupTag(item,f){if(f.orbBreakout&&f.relVol>=1.2)return 'OPENING_RANGE_BREAKOUT';if(f.aboveVwap&&f.momentumAcceleration)return 'VWAP_MOMENTUM_CONTINUATION';if(f.aboveVwap&&f.momentum5mPct>0)return 'VWAP_TREND';if(!f.aboveVwap&&f.momentum5mPct<0)return 'WEAK_LONG_SETUP';return 'MIXED_INTRADAY';}
const entryItems=(board.items||[]).filter(x=>x?.kind==='ENTRY'&&x?.ticker);
const stockSyms=[...new Set(entryItems.filter(x=>x.assetClass==='STOCK').map(x=>x.ticker))];
const cryptoSyms=[...new Set(entryItems.filter(x=>x.assetClass==='CRYPTO').map(x=>x.ticker))];
const map=new Map(),errors=[];
async function loadStocks(){if(!stockSyms.length)return;try{const start=new Date(now.getTime()-8*60*60*1000).toISOString();const qs=new URLSearchParams({symbols:stockSyms.join(','),timeframe:'1Min',start,limit:'10000',feed:'iex'});const one=await getJson(`https://data.alpaca.markets/v2/stocks/bars?${qs}`);qs.set('timeframe','5Min');const five=await getJson(`https://data.alpaca.markets/v2/stocks/bars?${qs}`);for(const s of stockSyms){const f=features(barsOf(one,s),barsOf(five,s),'STOCK');if(f)map.set(`STOCK:${s}`,f);}}catch(e){errors.push(`stocks: ${e.message}`);}}
async function loadCrypto(){if(!cryptoSyms.length)return;try{const start=new Date(now.getTime()-8*60*60*1000).toISOString();const qs=new URLSearchParams({symbols:cryptoSyms.join(','),timeframe:'1Min',start,limit:'10000'});const one=await getJson(`https://data.alpaca.markets/v1beta3/crypto/us/bars?${qs}`);qs.set('timeframe','5Min');const five=await getJson(`https://data.alpaca.markets/v1beta3/crypto/us/bars?${qs}`);for(const s of cryptoSyms){const f=features(barsOf(one,s),barsOf(five,s),'CRYPTO');if(f)map.set(`CRYPTO:${s}`,f);}}catch(e){errors.push(`crypto: ${e.message}`);}}
await Promise.all([loadStocks(),loadCrypto()]);
const generatedAt=now.toISOString();
for(const item of board.items||[]){if(item?.kind!=='ENTRY'||!item?.ticker)continue;const f=map.get(`${item.assetClass}:${item.ticker}`);if(!f){item.intradayEdge={status:'UNAVAILABLE_FAIL_CLOSED',generatedAt};continue;}const tag=setupTag(item,f),edge=costAdjustedEdge(item,f);const strong=f.score>=65&&edge>=1.3&&(!finite(f.relVol)||f.relVol>=0.9);const weak=f.score<40||tag==='WEAK_LONG_SETUP';item.intradayEdge={status:'FRESH',generatedAt,setup:tag,...f,costAdjustedEdge:edge,realFillLearningState:adaptive?.state||adaptive?.health||'UNKNOWN',executionCostNote:'Robinhood live spread/slippage check remains mandatory immediately before order.',profitProtection:{armAfterR:0.75,trailAfterR:1.25,neverWidenStop:true},adaptiveSizing:{mode:'EDGE_WEIGHTED_WITHIN_EXISTING_RISK_CAP',multiplier:strong?1:weak?0.25:0.6,mayNotIncreaseExistingRiskCap:true}};
  if(['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER','CRYPTO_SEED_LANE_BUY_TRIGGER'].includes(item.status)){
    if(weak){item.status='BLOCKED_INTRADAY_EDGE';item.reason=`Fresh intraday edge is weak (${f.score}/100, ${tag}); wait for a better setup.`;}
    else if(!strong){item.status='WAIT_INTRADAY_CONFIRMATION';item.reason=`Research qualifies, but intraday confirmation is only ${f.score}/100 (${tag}); wait for VWAP/volume/momentum confirmation.`;}
    else item.reason=`Fresh intraday confirmation ${f.score}/100 (${tag}); still requires immediate Robinhood price/spread/buying-power/risk/protection recheck.`;
  }
}
const actionable=new Set(['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER','CRYPTO_SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_FORCED_EXIT','TRIGGER_1_STOP','TRIGGER_2_TARGET1','TRIGGER_3_TARGET2']);
board.events=(board.items||[]).filter(x=>actionable.has(x.status)).map(x=>({id:x.id,assetClass:x.assetClass,ticker:x.ticker,trigger:x.status,entryTier:x.entryTier??null,setupGrade:x.setupGrade??null,queueRank:x.queueRank??null,rewardRisk:x.rewardRisk??null,intradayEdge:x.intradayEdge??null,reason:x.reason??null}));
board.executionNeeded=board.events.length>0;
board.intradayEngine={schemaVersion:1,generatedAt,status:errors.length?'DEGRADED':'OK',errors,features:['1m momentum','5m momentum','VWAP','relative volume','opening range breakout','momentum acceleration','range context','cost-adjusted edge','adaptive sizing','profit protection'],policy:'Intraday edge may block or reduce size but may never create eligibility by itself. Stale/unavailable data fails closed for new entries; exits remain prioritized.'};
await Promise.all([write('docs/data/trigger-board.json',board),write('docs/data/intraday-edge.json',{schemaVersion:1,generatedAt,status:board.intradayEngine.status,errors,items:(board.items||[]).filter(x=>x.intradayEdge).map(x=>({id:x.id,ticker:x.ticker,assetClass:x.assetClass,status:x.status,intradayEdge:x.intradayEdge}))})]);
console.log(`Intraday edge overlay: ${map.size}/${entryItems.length} candidates enriched; executionNeeded=${board.executionNeeded}; errors=${errors.length}`);
