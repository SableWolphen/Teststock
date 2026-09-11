import fs from 'node:fs/promises';

// Same-stock historical backtesting (expand-stock-universe.mjs) cannot evaluate a genuinely
// new/recent listing: there is no repeated history of ITS OWN setups to measure. This script
// answers a different, still-real question: pooled across MANY past new listings, how did
// early-stage (first ~90 trading days) BREAKOUT/PULLBACK/TREND setups actually resolve?
// That is real evidence -- just cross-sectional (across stocks) instead of longitudinal (one
// stock's own repeated history). It is deliberately kept separate from and never merged into
// the main same-stock validation pool: it is a different, more uncertain kind of evidence and
// must be treated that way downstream (smaller size, its own probation, real-fill proof
// required before ever scaling), matching the same seed-lane philosophy already used elsewhere.

const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const get=async u=>{const r=await fetch(u,{headers});if(!r.ok)throw new Error(`Alpaca ${r.status}: ${await r.text()}`);return r.json();};
const getRetry=async(u,attempts=4)=>{let err;for(let i=0;i<attempts;i++){try{return await get(u);}catch(e){err=e;if(i<attempts-1)await sleep(300*(2**i));}}throw err;};
const sma=(xs,n)=>avg(xs.slice(-n));
function rsi(c,n=10){if(c.length<n+1)return 50;let g=0,l=0;for(let i=c.length-n;i<c.length;i++){const d=c[i]-c[i-1];if(d>=0)g+=d;else l-=d;}if(!l)return 100;const rs=(g/n)/(l/n);return 100-(100/(1+rs));}
function looksLikeOperatingCompany(a){const name=String(a.name||'').trim();if(!name)return false;return !/(\bETF\b|\bETN\b|exchange.?traded|index fund|mutual fund|closed.end fund|\bfund\b|\bportfolio\b|\bproshares\b|\bishares\b|\bspdr\b|\bdirexion\b|\binvesco\b|\bwisdomtree\b|\bvaneck\b|\bglobal x\b|\bfirst trust\b|\bwarrant\b|\bright(s)?\b|\bunit(s)?\b|preferred|depositary shares|\b2x\b|\b3x\b|ultra|inverse|short s&p|short qqq|short russell|short dow)/i.test(name);}

// Early-stage setup classification uses short windows (5/10-day) since a fresh listing's
// first 90 days cannot support the main scanner's 20/50-day moving averages.
function earlyStageSetupType({price,ma5,ma10,high10,rsiValue,trendUp}){
  const breakoutDistance=high10?((price/high10)-1)*100:0;
  const pullbackDistance=ma5?((price/ma5)-1)*100:99;
  if(breakoutDistance>=-2&&breakoutDistance<=3&&trendUp&&rsiValue<=76)return'BREAKOUT';
  if(pullbackDistance>=-1&&pullbackDistance<=5&&price>ma10&&trendUp&&rsiValue>=40&&rsiValue<=70)return'PULLBACK';
  if(trendUp)return'TREND';
  return'NONE';
}

// Scans an individual listing's own first EARLY_WINDOW days, classifies whatever early setups
// appear, then measures the forward return using ONLY that same stock's later bars (which we
// have because enough calendar time has passed since it was a new listing) -- no data leakage.
const EARLY_WINDOW=90,FORWARD_DAYS=15,MIN_BARS_FOR_SETUP=12;
function scanEarlyEpisodes(bars,symbol){
  const episodes=[];
  const window=bars.slice(0,Math.min(EARLY_WINDOW,bars.length));
  for(let i=MIN_BARS_FOR_SETUP;i<window.length-FORWARD_DAYS;i++){
    const prior=window.slice(0,i+1),c=prior.map(x=>x.c),price=c.at(-1);
    const ma5=sma(c,5),ma10=sma(c,Math.min(10,c.length)),high10=Math.max(...prior.slice(-10).map(x=>x.h)),rrsi=rsi(c);
    const trendUp=price>ma10&&ma5>=ma10*.995;
    const setup=earlyStageSetupType({price,ma5,ma10,high10,rsiValue:rrsi,trendUp});
    if(setup==='NONE')continue;
    const forward=bars[i+FORWARD_DAYS];if(!forward)continue;
    const forwardReturnPct=round(((forward.c/price)-1)*100,2);
    episodes.push({symbol,tradingDaySinceListing:i,setup,entryPrice:round(price),forwardReturnPct});
  }
  return episodes;
}

const start=new Date(Date.now()-760*86400000).toISOString().slice(0,10);
const assetsRaw=await getRetry('https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity');
const universe=(assetsRaw||[]).filter(a=>a.status==='active'&&a.tradable===true&&a.symbol&&looksLikeOperatingCompany(a));
console.log(`New-listing cohort scan: ${universe.length} active operating-company symbols to check for a recent-enough-but-resolved listing date.`);

// Fetch each symbol's bars since ~760 days ago. A symbol whose earliest returned bar falls
// between 250 and 730 days ago was itself a new listing at that point AND has had enough
// subsequent time for its early setups' forward outcomes to have actually resolved.
const SAMPLE_CAP=1500; // bound total API volume for this diagnostic scan; ranked by liquidity below before slicing
const snapshotSymbols=universe.map(a=>a.symbol);
const snapshots={};
for(const batch of chunks(snapshotSymbols,80)){
  const q=new URLSearchParams({symbols:batch.join(','),feed:'iex'});
  try{Object.assign(snapshots,await getRetry(`https://data.alpaca.markets/v2/stocks/snapshots?${q}`));}catch{}
}
const byDollarVolume=universe
  .map(a=>{const s=snapshots[a.symbol]||{},day=s.dailyBar||s.daily_bar||{},trade=s.latestTrade||s.latest_trade||{};const price=Number(trade.p||day.c||0),vol=Number(day.v||0);return {symbol:a.symbol,dollarVolume:price*vol};})
  .filter(x=>x.dollarVolume>0)
  .sort((a,b)=>b.dollarVolume-a.dollarVolume)
  .slice(0,SAMPLE_CAP)
  .map(x=>x.symbol);
console.log(`Checking listing age for the top ${byDollarVolume.length} symbols by current dollar volume (bounds API volume for this diagnostic).`);

const by={};
for(const batch of chunks(byDollarVolume,80)){
  let token='';
  for(let page=0;page<6;page++){
    const q=new URLSearchParams({symbols:batch.join(','),timeframe:'1Day',start,limit:'10000',adjustment:'all',feed:'iex'});if(token)q.set('page_token',token);
    const raw=await getRetry(`https://data.alpaca.markets/v2/stocks/bars?${q}`);
    for(const [sym,bars] of Object.entries(raw.bars||{}))by[sym]=[...(by[sym]||[]),...bars];
    token=raw.next_page_token||'';if(!token)break;
  }
}

const now=Date.now();
const historicalNewListings=[];
for(const symbol of byDollarVolume){
  const bars=by[symbol]||[];if(bars.length<EARLY_WINDOW+FORWARD_DAYS+10)continue;
  const firstBarAgeDays=Math.round((now-new Date(bars[0].t).getTime())/86400000);
  if(firstBarAgeDays<250||firstBarAgeDays>730)continue; // not "new enough historically" or not "resolved enough since"
  historicalNewListings.push({symbol,firstBarAgeDays,bars});
}
console.log(`Identified ${historicalNewListings.length} historical new listings (first bar 250-730 days old) with enough subsequent history to score their early setups.`);

const allEpisodes=historicalNewListings.flatMap(x=>scanEarlyEpisodes(x.bars,x.symbol));
const bySetup={};
for(const setup of ['BREAKOUT','PULLBACK','TREND']){
  const xs=allEpisodes.filter(e=>e.setup===setup);
  const wins=xs.filter(e=>e.forwardReturnPct>0).length;
  bySetup[setup]={samples:xs.length,winRatePct:xs.length?round(wins/xs.length*100,1):null,avgForwardReturnPct:xs.length?round(avg(xs.map(e=>e.forwardReturnPct)),2):null,medianForwardReturnPct:xs.length?round([...xs.map(e=>e.forwardReturnPct)].sort((a,b)=>a-b)[Math.floor(xs.length/2)],2):null};
}
const overallWins=allEpisodes.filter(e=>e.forwardReturnPct>0).length;
const MIN_COHORT_SAMPLES=40;
const report={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  method:'Cross-sectional (pooled-across-many-stocks) backtest of early-stage (first 90 trading days since listing) setups, using each historical new listing’s own later bars to measure a 15-trading-day forward return with no data leakage. This is diagnostic, cross-sectional evidence -- a different and more uncertain kind of evidence than the main scanner’s same-stock repeated-history validation -- and must never be treated as equivalent to it.',
  historicalNewListingsFound:historicalNewListings.length,
  totalEarlyEpisodes:allEpisodes.length,
  overall:{samples:allEpisodes.length,winRatePct:allEpisodes.length?round(overallWins/allEpisodes.length*100,1):null,avgForwardReturnPct:allEpisodes.length?round(avg(allEpisodes.map(e=>e.forwardReturnPct)),2):null},
  bySetup,
  minimumCohortSamplesRequiredBeforeUse:MIN_COHORT_SAMPLES,
  cohortMeetsMinimumSampleBar:allEpisodes.length>=MIN_COHORT_SAMPLES,
  rules:[
    'This file is diagnostic cross-sectional evidence only. It may inform a separate, small, capped new-listing lane; it must never be merged into or treated as equivalent to the main same-stock historical validation pool.',
    'A current new listing may use this cohort evidence only when cohortMeetsMinimumSampleBar is true and only within a dedicated new-listing lane’s own size/frequency caps -- never at normal-lane size.',
    'Real Robinhood fill evidence from the new-listing lane itself, not this backtest, is what may eventually justify increasing its size -- exactly the same rule already applied to every other seed lane.',
  ],
};
await fs.writeFile('docs/data/new-listing-cohort-validation.json',JSON.stringify(report,null,2));
console.log(`New-listing cohort validation: ${historicalNewListings.length} historical listings scanned, ${allEpisodes.length} early episodes, overall winRate=${report.overall.winRatePct}%, avgForwardReturn=${report.overall.avgForwardReturnPct}%`);
