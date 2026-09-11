import fs from 'node:fs/promises';

// Reuses the cross-sectional cohort evidence from build-new-listing-cohort-validation.mjs to let
// CURRENT genuine new listings (still inside their first ~90 trading days) compete for the
// existing stock seed lane's shared cap (docs/data/probability-first-policy.json ->
// stocks.seedLane) -- never a separate or additional risk budget. Consumed by
// apply-profitability-admission.mjs, which injects any published candidate here into the normal
// live-queue seed-lane eligibility pool with the lowest queueRank priority, so a same-stock
// historically validated candidate always wins the shared slot first when both are eligible.
// Disabled entirely whenever the cohort file is missing or below its own minimum sample bar.

const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const get=async u=>{const r=await fetch(u,{headers});if(!r.ok)throw new Error(`Alpaca ${r.status}: ${await r.text()}`);return r.json();};
const getRetry=async(u,attempts=4)=>{let err;for(let i=0;i<attempts;i++){try{return await get(u);}catch(e){err=e;if(i<attempts-1)await sleep(300*(2**i));}}throw err;};
const sma=(xs,n)=>avg(xs.slice(-n));
function rsi(c,n=10){if(c.length<n+1)return 50;let g=0,l=0;for(let i=c.length-n;i<c.length;i++){const d=c[i]-c[i-1];if(d>=0)g+=d;else l-=d;}if(!l)return 100;const rs=(g/n)/(l/n);return 100-(100/(1+rs));}
function looksLikeOperatingCompany(a){const name=String(a.name||'').trim();if(!name)return false;return !/(\bETF\b|\bETN\b|exchange.?traded|index fund|mutual fund|closed.end fund|\bfund\b|\bportfolio\b|\bproshares\b|\bishares\b|\bspdr\b|\bdirexion\b|\binvesco\b|\bwisdomtree\b|\bvaneck\b|\bglobal x\b|\bfirst trust\b|\bwarrant\b|\bright(s)?\b|\bunit(s)?\b|preferred|depositary shares|\b2x\b|\b3x\b|ultra|inverse|short s&p|short qqq|short russell|short dow)/i.test(name);}
function earlyStageSetupType({price,ma5,ma10,high10,rsiValue,trendUp}){
  const breakoutDistance=high10?((price/high10)-1)*100:0;
  const pullbackDistance=ma5?((price/ma5)-1)*100:99;
  if(breakoutDistance>=-2&&breakoutDistance<=3&&trendUp&&rsiValue<=76)return'BREAKOUT';
  if(pullbackDistance>=-1&&pullbackDistance<=5&&price>ma10&&trendUp&&rsiValue>=40&&rsiValue<=70)return'PULLBACK';
  if(trendUp)return'TREND';
  return'NONE';
}

const OUT='docs/data/new-listing-live-candidates.json';
const MIN_SETUP_SAMPLES=40;
const cohort=await read('docs/data/new-listing-cohort-validation.json',null);
if(!cohort||cohort.cohortMeetsMinimumSampleBar!==true){
  await fs.writeFile(OUT,JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),enabled:false,reason:'Cross-sectional cohort evidence unavailable or below its own minimum sample bar.',candidates:[]},null,2));
  console.log('New-listing live candidates: disabled (cohort evidence unavailable or below sample bar).');
  process.exit(0);
}
const goodSetups=new Set(Object.entries(cohort.bySetup||{}).filter(([,v])=>Number(v?.samples||0)>=MIN_SETUP_SAMPLES&&Number(v?.avgForwardReturnPct||0)>0).map(([k])=>k));
if(!goodSetups.size){
  await fs.writeFile(OUT,JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),enabled:false,reason:'No setup type cleared its own sample/return bar in the current cohort evidence.',candidates:[]},null,2));
  console.log('New-listing live candidates: disabled (no qualifying setup type in current cohort).');
  process.exit(0);
}

const EARLY_WINDOW=90,MIN_BARS_FOR_SETUP=12,MAX_LISTING_AGE_CALENDAR_DAYS=180,SAMPLE_CAP=600,MAX_CANDIDATES=3;
const assetsRaw=await getRetry('https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity');
const universe=(assetsRaw||[]).filter(a=>a.status==='active'&&a.tradable===true&&a.symbol&&looksLikeOperatingCompany(a));
const snapshotSymbols=universe.map(a=>a.symbol);
const snapshots={};
for(const batch of chunks(snapshotSymbols,80)){
  const q=new URLSearchParams({symbols:batch.join(','),feed:'iex'});
  try{Object.assign(snapshots,await getRetry(`https://data.alpaca.markets/v2/stocks/snapshots?${q}`));}catch{}
}
const byDollarVolume=universe
  .map(a=>{const s=snapshots[a.symbol]||{},day=s.dailyBar||s.daily_bar||{},trade=s.latestTrade||s.latest_trade||{};const price=Number(trade.p||day.c||0),vol=Number(day.v||0);return {symbol:a.symbol,price,dollarVolume:price*vol};})
  .filter(x=>x.dollarVolume>0)
  .sort((a,b)=>b.dollarVolume-a.dollarVolume)
  .slice(0,SAMPLE_CAP);
const symbols=byDollarVolume.map(x=>x.symbol);
const start=new Date(Date.now()-200*86400000).toISOString().slice(0,10);
const by={};
for(const batch of chunks(symbols,80)){
  let token='';
  for(let page=0;page<4;page++){
    const q=new URLSearchParams({symbols:batch.join(','),timeframe:'1Day',start,limit:'10000',adjustment:'all',feed:'iex'});if(token)q.set('page_token',token);
    const raw=await getRetry(`https://data.alpaca.markets/v2/stocks/bars?${q}`);
    for(const [sym,bars] of Object.entries(raw.bars||{}))by[sym]=[...(by[sym]||[]),...bars];
    token=raw.next_page_token||'';if(!token)break;
  }
}
const now=Date.now();
const candidates=[];
for(const symbol of symbols){
  const bars=by[symbol]||[];if(bars.length<MIN_BARS_FOR_SETUP)continue;
  const firstBarAgeDays=Math.round((now-new Date(bars[0].t).getTime())/86400000);
  if(firstBarAgeDays>MAX_LISTING_AGE_CALENDAR_DAYS)continue; // not a genuinely new/current listing
  if(bars.length>EARLY_WINDOW)continue; // already past its early-stage window
  const c=bars.map(x=>x.c),price=c.at(-1);
  const ma5=sma(c,5),ma10=sma(c,Math.min(10,c.length)),high10=Math.max(...bars.slice(-10).map(x=>x.h)),rrsi=rsi(c);
  const trendUp=price>ma10&&ma5>=ma10*.995;
  const setup=earlyStageSetupType({price,ma5,ma10,high10,rsiValue:rrsi,trendUp});
  if(setup==='NONE'||!goodSetups.has(setup))continue;
  const recentLow=Math.min(...bars.slice(-5).map(x=>x.l));
  const stop=round(Math.min(recentLow,price*0.97));
  if(!(stop>0&&stop<price))continue;
  const riskPerShare=price-stop;
  const target1=round(price+riskPerShare*1.5);
  const target2=round(price+riskPerShare*2.5);
  const setupStats=cohort.bySetup[setup];
  const dollarVolume=byDollarVolume.find(x=>x.symbol===symbol)?.dollarVolume||0;
  candidates.push({symbol,setupType:setup,tradingDaysSinceListing:bars.length,firstBarAgeDays,entry:round(price),minimumEntry:round(price*0.995),maximumEntry:round(price*1.01),stop,target1,target2,rewardRisk:round(riskPerShare>0?(target2-price)/riskPerShare:0,2),dollarVolume,cohortSetupSamples:setupStats.samples,cohortSetupWinRatePct:setupStats.winRatePct,cohortSetupAvgForwardReturnPct:setupStats.avgForwardReturnPct});
}
candidates.sort((a,b)=>b.dollarVolume-a.dollarVolume);
const chosen=candidates.slice(0,MAX_CANDIDATES);
const report={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  enabled:true,
  cohortGeneratedAt:cohort.generatedAt,
  method:'Live scan for CURRENT genuine new listings (first bar within the last 180 calendar days, still inside their first ~90 trading days) showing a live BREAKOUT/PULLBACK/TREND setup that matches a setup type the cross-sectional cohort backtest already found profitable with at least 40 samples. This is diagnostic-cohort-gated evidence, not same-stock validation -- these candidates are deliberately deprioritized so a same-stock-validated candidate always wins the shared stock seed-lane slot first.',
  qualifyingSetupTypes:[...goodSetups],
  candidatesScanned:symbols.length,
  candidatesFound:candidates.length,
  candidates:chosen,
  rules:[
    'Never a separate or additional risk budget: these candidates compete only for the existing stocks.seedLane shared cap (fixed dollar ceiling, existing Robinhood cash only).',
    'Never outranks a same-stock historically validated candidate for that shared slot.',
    'Disabled entirely whenever the cross-sectional cohort file is missing or below its own minimum sample bar.',
  ],
};
await fs.writeFile(OUT,JSON.stringify(report,null,2));
console.log(`New-listing live candidates: ${symbols.length} scanned, ${candidates.length} matched a qualifying setup, ${chosen.length} published.`);
