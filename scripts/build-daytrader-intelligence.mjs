import fs from 'node:fs/promises';

const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const [board,adaptive,watchlist,signal]=await Promise.all([
  read('docs/data/trigger-board.json',{}),
  read('docs/data/adaptive-performance.json',{}),
  read('docs/data/execution-watchlist.json',{}),
  read('docs/signal.json',{})
]);
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca credentials');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const now=new Date(),generatedAt=now.toISOString();
const num=x=>Number(x),finite=x=>Number.isFinite(num(x));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url){let last;for(let i=0;i<3;i++){try{const r=await fetch(url,{headers});if(r.ok)return r.json();last=new Error(`${r.status} ${await r.text()}`);}catch(e){last=e;}await sleep(200*(2**i));}throw last;}
const errors=[];
const currentStocks=[...new Set((board.items||[]).filter(x=>x?.kind==='ENTRY'&&x.assetClass==='STOCK'&&x.ticker).map(x=>x.ticker))];
let active=[],movers=[];
try{const x=await get('https://data.alpaca.markets/v1beta1/screener/stocks/most-actives?by=volume&top=30');active=x?.most_actives||x?.mostActives||[];}catch(e){errors.push(`most-actives: ${e.message}`);}
try{const x=await get('https://data.alpaca.markets/v1beta1/screener/stocks/movers?top=20');movers=[...(x?.gainers||[]),...(x?.losers||[])];}catch(e){errors.push(`movers: ${e.message}`);}
const discovered=[...new Set([...active.map(x=>x.symbol),...movers.map(x=>x.symbol),...currentStocks].filter(Boolean))].slice(0,50);
let snapshots={};
if(discovered.length){try{snapshots=await get(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(discovered.join(','))}&feed=iex`);}catch(e){errors.push(`snapshots: ${e.message}`);}}
let news=[];
if(discovered.length){try{const x=await get(`https://data.alpaca.markets/v1beta1/news?symbols=${encodeURIComponent(discovered.slice(0,25).join(','))}&limit=50&sort=desc`);news=x?.news||[];}catch(e){errors.push(`news: ${e.message}`);}}
function newsFor(s){return news.filter(n=>(n.symbols||[]).includes(s));}
function catalyst(s){const ns=newsFor(s);const recent=ns.filter(n=>Date.now()-new Date(n.created_at||n.updated_at||0).getTime()<=6*3600e3);const text=recent.map(n=>String(n.headline||'')).join(' ').toLowerCase();const binary=/bankrupt|chapter 11|halt|offering|secondary offering|fda|merger|acquisition|earnings|guidance|lawsuit|sec investigation/.test(text);const positive=/beats|raises guidance|approval|contract|record revenue|buyback/.test(text);const negative=/misses|cuts guidance|offering|bankrupt|investigation|halt/.test(text);return {articleCount:recent.length,binaryRisk:binary,sentimentHint:positive&&!negative?'POSITIVE':negative&&!positive?'NEGATIVE':'MIXED_OR_UNKNOWN',headlines:recent.slice(0,3).map(n=>({headline:n.headline||null,createdAt:n.created_at||null,source:n.source||null}))};}
function snapFeatures(s){const x=snapshots?.[s]||{};const px=num(x.latestTrade?.p||x.minuteBar?.c||x.dailyBar?.c);const bid=num(x.latestQuote?.bp),ask=num(x.latestQuote?.ap);const prev=num(x.prevDailyBar?.c),open=num(x.dailyBar?.o),vol=num(x.dailyBar?.v);const gap=prev&&open?((open/prev)-1)*100:null;const day=prev&&px?((px/prev)-1)*100:null;const spread=bid>0&&ask>0&&px>0?((ask-bid)/px)*100:null;const dollarVol=vol>0&&px>0?vol*px:null;return {price:px||null,bid:bid||null,ask:ask||null,spreadPct:spread,gapPct:gap,dayChangePct:day,dollarVolume:dollarVol,volume:vol||null};}
const ranked=[];
for(const s of discovered){const f=snapFeatures(s),c=catalyst(s);let score=0;if(f.dollarVolume!=null)score+=clamp(Math.log10(Math.max(f.dollarVolume,1))-6,0,3)*12;if(f.spreadPct!=null)score+=clamp(18-f.spreadPct*40,-20,18);if(f.gapPct!=null)score+=clamp(Math.abs(f.gapPct)*2,0,18);if(f.dayChangePct!=null)score+=clamp(Math.abs(f.dayChangePct)*1.5,0,15);score+=Math.min(c.articleCount*3,12);if(c.binaryRisk)score-=8;score=Math.round(clamp(score,0,100));const liquidityPass=(f.dollarVolume==null||f.dollarVolume>=20_000_000)&&(f.spreadPct==null||f.spreadPct<=0.6);ranked.push({symbol:s,discoveryScore:score,liquidityPass,...f,catalyst:c,alreadyInResearch:currentStocks.includes(s)});}
ranked.sort((a,b)=>b.discoveryScore-a.discoveryScore);
const promote=ranked.filter(x=>x.liquidityPass&&x.discoveryScore>=55).slice(0,20).map((x,i)=>({...x,discoveryRank:i+1,status:x.alreadyInResearch?'CURRENT_RESEARCH_CANDIDATE':'PROMOTE_TO_RESEARCH',authority:'DISCOVERY_ONLY_NOT_EXECUTION_ELIGIBILITY'}));
const rejected=(board.items||[]).filter(x=>x?.kind==='ENTRY'&&!['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER','CRYPTO_SEED_LANE_BUY_TRIGGER'].includes(x.status)).map(x=>({id:x.id,ticker:x.ticker,assetClass:x.assetClass,status:x.status,observedPrice:x.observedPrice??null,intradayEdge:x.intradayEdge?{setup:x.intradayEdge.setup,adjustedScore:x.intradayEdge.adjustedScore,costAdjustedEdge:x.intradayEdge.costAdjustedEdge}:null,recordedAt:generatedAt})).slice(0,100);
const buckets=adaptive?.buckets?.bySetupType||[];
const shadow=buckets.map(b=>{const n=num(b.sampleSize??b.n??b.count)||0,exp=finite(b.shrunkAverageR)?num(b.shrunkAverageR):finite(b.averageRealizedR)?num(b.averageRealizedR):null;return {setup:b.key||b.setupType||'UNKNOWN',sampleSize:n,expectancyR:exp,promotionState:n>=30&&exp!=null&&exp>0.15?'PROMOTION_ELIGIBLE':n>=20&&exp!=null&&exp<0?'DEMOTE_OR_PAUSE':'SHADOW_COLLECTING',rule:'Promotion requires >=30 reconciled real fills and positive shrunk expectancy; live risk caps never increase automatically.'};});
const spreads=ranked.map(x=>x.spreadPct).filter(finite).sort((a,b)=>a-b),medianSpread=spreads.length?spreads[Math.floor(spreads.length/2)]:null;
const feedDegraded=errors.length>1||ranked.length===0;
const circuitBreaker={state:feedDegraded?'STOP_NEW_RISK':medianSpread!=null&&medianSpread>0.35?'REDUCE_NEW_RISK':'NORMAL',reasons:[...(feedDegraded?['discovery/feed degradation']:[]),...(medianSpread!=null&&medianSpread>0.35?[`median spread elevated ${medianSpread.toFixed(3)}%`]:[])],mayOnlyReduceRisk:true};
const activePositions=(watchlist.positions||[]).filter(p=>p?.status==='ACTIVE').length;
const allocation={mode:'EDGE_WEIGHTED_WITH_CORRELATION_AND_HEAT_RECHECK_AT_BROKER',activePositions,rule:'Allocate only among already-qualified entries after live Robinhood cash, spread, correlation, aggregate stop-risk and portfolio-heat checks. Discovery score never increases an existing risk ceiling.'};
const out={schemaVersion:1,generatedAt,source:'TESTSTOCK_LIVE_DAYTRADER_INTELLIGENCE',errors,universe:{discoveredCount:discovered.length,currentResearchCount:currentStocks.length,promoteToResearch:promote,topRanked:ranked.slice(0,30)},circuitBreaker,shadowChallengers:shadow,rejectedOpportunityTracking:rejected,missedFillAnalysis:{state:'BROKER_RECONCILIATION_REQUIRED',rule:'Only Robinhood-confirmed submitted/working/cancelled/filled orders may be used to judge missed fills or execution quality.'},portfolioAllocation:allocation,timeOfDayLearning:{enabled:true,buckets:['OPEN_0930_1030_ET','MIDDAY_1030_1500_ET','POWER_HOUR_1500_1600_ET','CRYPTO_US_DAY','CRYPTO_OVERNIGHT_WEEKEND'],authority:'May reorder/reduce/disable after sufficient real-fill evidence; may not create eligibility.'},walkForward:{enabled:true,rule:'Strategy changes require out-of-sample or forward shadow evidence before promotion; never optimize solely on the same period used to design the rule.'},policy:'Find more opportunities aggressively, but discovery/catalyst/liquidity intelligence may only promote symbols into research, reorder, reduce, or block. It never directly creates broker execution eligibility.'};
await write('docs/data/daytrader-intelligence.json',out);
console.log(`Daytrader intelligence: ${discovered.length} discovered, ${promote.length} promote-to-research, circuit=${circuitBreaker.state}, errors=${errors.length}`);
