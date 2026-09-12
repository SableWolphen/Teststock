import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
const secUA=process.env.SEC_USER_AGENT||'';
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const alpacaHeaders={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const getJson=async(url,headers={})=>{const r=await fetch(url,{headers});if(!r.ok)throw new Error(`${r.status} ${url}: ${await r.text()}`);return r.json();};
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const broad=await read('docs/data/broad-stock-universe.json',{});
// Union with the previous cycle's actual candidate queue (2026-09-12): broad.topCandidates.slice(0,40)
// alone missed real current liveQueue/stockCandidateQueue tickers that didn't happen to rank in the
// top 40 by this stage's own score -- confirmed live (COHR/ARMK/ROG showed NEWS_UNAVAILABLE despite
// being actively held/queued). growth-plan-500.json for THIS run doesn't exist yet at this pipeline
// stage, but last cycle's queue is a reliable proxy since the same names usually persist run to run.
const priorPlan=await read('docs/data/growth-plan-500.json',{});
const priorQueueSymbols=[...(priorPlan.qualifiedCandidateQueue||[]),...(priorPlan.allocations||[])].map(x=>x.symbol||x.ticker).filter(Boolean);
const symbols=[...new Set([...(broad.topCandidates||[]).map(x=>x.symbol).filter(Boolean).slice(0,40),...priorQueueSymbols])].slice(0,60);
if(!symbols.length){console.log('No broad finalists to enrich');process.exit(0);}

// News enrichment (2026-09-12): a growthQuality/reward-risk score alone can't see a headline that
// just broke. Fetches recent Alpaca news for every finalist being enriched here -- the same
// symbols that flow into stock-tournament.json's researchFinalists/liveQueue -- so a fresh
// material catalyst is visible before this candidate is even ranked, not only at the live
// pre-trade check. Diagnostic only: never blocks eligibility by itself (crude keyword matching on
// headlines is not trustworthy enough for a hard automated gate) -- it feeds decision-intelligence
// as a warning/score input, same as the SEC fundamentals enrichment below.
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
let newsArticles=[];
for(const batch of chunks(symbols,25)){
  try{const x=await getJson(`https://data.alpaca.markets/v1beta1/news?symbols=${encodeURIComponent(batch.join(','))}&limit=50&sort=desc`,alpacaHeaders);newsArticles=[...newsArticles,...(x?.news||[])];}
  catch(e){console.warn(`News enrichment unavailable for batch [${batch.join(',')}]; continuing fail-closed at runtime: ${e.message}`);}
}
const NEWS_WINDOW_MS=72*3600e3;
function newsFor(symbol){return newsArticles.filter(n=>(n.symbols||[]).includes(symbol));}
function catalystFor(symbol){
  const recent=newsFor(symbol).filter(n=>Date.now()-new Date(n.created_at||n.updated_at||0).getTime()<=NEWS_WINDOW_MS);
  const text=recent.map(n=>String(n.headline||'')).join(' ').toLowerCase();
  const binary=/bankrupt|chapter 11|halt|offering|secondary offering|fda|merger|acquisition|earnings|guidance|lawsuit|sec investigation/.test(text);
  const positive=/beats|raises guidance|approval|contract|record revenue|buyback/.test(text);
  const negative=/misses|cuts guidance|offering|bankrupt|investigation|halt/.test(text);
  return {articleCount:recent.length,windowHours:72,binaryRisk:binary,sentimentHint:recent.length?(positive&&!negative?'POSITIVE':negative&&!positive?'NEGATIVE':'MIXED_OR_UNKNOWN'):'NO_RECENT_NEWS',headlines:recent.slice(0,3).map(n=>({headline:n.headline||null,createdAt:n.created_at||null,source:n.source||null})),source:'ALPACA_NEWS',note:'Keyword-based diagnostic only; never a hard eligibility gate. A live pre-trade news check still applies before any order.'};
}

let tickerMap={};
if(secUA){try{tickerMap=await getJson('https://www.sec.gov/files/company_tickers.json',{'User-Agent':secUA,'Accept-Encoding':'gzip, deflate'});}catch(e){console.warn('SEC ticker map unavailable; continuing without SEC fundamentals:',e.message);}}
else console.warn('SEC_USER_AGENT missing; continuing with SEC fundamentals unavailable.');
const byTicker=new Map(Object.values(tickerMap||{}).map(x=>[String(x.ticker||'').toUpperCase(),x]));
const now=new Date(),start=new Date(now.getTime()-14*86400000).toISOString().slice(0,10),end=new Date(now.getTime()+45*86400000).toISOString().slice(0,10);
let corporate={};
try{const q=new URLSearchParams({symbols:symbols.join(','),start,end,limit:'1000',data_quality:'all'});corporate=await getJson(`https://data.alpaca.markets/v1/corporate-actions?${q}`,alpacaHeaders);}catch(e){console.warn('Corporate-action enrichment unavailable; continuing fail-closed at runtime:',e.message);}
const caRows=[];for(const [type,rows] of Object.entries(corporate||{})){if(!Array.isArray(rows))continue;for(const row of rows)caRows.push({...row,_type:type});}
const caBySymbol=new Map();for(const row of caRows){const s=String(row.symbol||row.initiating_symbol||row.new_symbol||'').toUpperCase();if(!s)continue;(caBySymbol.get(s)||caBySymbol.set(s,[]).get(s)).push(row);}

function latestAnnual(facts,names){for(const name of names){const units=facts?.facts?.['us-gaap']?.[name]?.units||{};for(const arr of Object.values(units)){const rows=(arr||[]).filter(x=>x.form==='10-K'&&x.fy&&x.val!=null).sort((a,b)=>String(b.filed).localeCompare(String(a.filed)));const unique=[];for(const r of rows)if(!unique.some(x=>x.fy===r.fy))unique.push(r);if(unique.length>=1)return unique.slice(0,2);}}return[];}
function classifyFundamentals(facts){const rev=latestAnnual(facts,['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet']),ni=latestAnnual(facts,['NetIncomeLoss']),assets=latestAnnual(facts,['Assets']),liab=latestAnnual(facts,['Liabilities']);const latestRev=rev[0]?.val,prevRev=rev[1]?.val,latestNI=ni[0]?.val,latestAssets=assets[0]?.val,latestLiab=liab[0]?.val;const revenueGrowth=latestRev&&prevRev?((latestRev/prevRev)-1)*100:null,equity=latestAssets!=null&&latestLiab!=null?latestAssets-latestLiab:null;let label='MIXED',score=0;if(revenueGrowth!=null){if(revenueGrowth>8)score+=2;else if(revenueGrowth<0)score-=2;}if(latestNI!=null){if(latestNI>0)score+=2;else score-=3;}if(equity!=null){if(equity>0)score+=1;else score-=2;}if(score>=4)label='STRONG';else if(score<=-2)label='WEAK';return{label,coverage:[revenueGrowth,latestNI,equity].filter(x=>x!=null).length/3,revenueGrowthPct:revenueGrowth==null?null:round(revenueGrowth,1),latestAnnualNetIncome:latestNI??null,latestEquityEstimate:equity??null,source:'SEC_COMPANYFACTS',note:'Backward-looking SEC fundamentals only; this does not predict earnings.'};}
const enriched={};
for(const symbol of symbols){const meta=byTicker.get(symbol),events=caBySymbol.get(symbol)||[];let fundamentals={label:'UNAVAILABLE',coverage:0,source:'SEC_COMPANYFACTS'};let recentFilings=[];if(meta&&secUA){const cik=String(meta.cik_str).padStart(10,'0');try{const [facts,subs]=await Promise.all([getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,{'User-Agent':secUA}),getJson(`https://data.sec.gov/submissions/CIK${cik}.json`,{'User-Agent':secUA})]);fundamentals=classifyFundamentals(facts);const recent=subs?.filings?.recent||{},forms=recent.form||[],dates=recent.filingDate||[];recentFilings=forms.map((form,i)=>({form,filingDate:dates[i]})).filter(x=>['8-K','10-Q','10-K'].includes(x.form)&&x.filingDate>=start).slice(0,8);}catch(e){console.warn(`SEC enrichment failed for ${symbol}: ${e.message}`);}await sleep(110);}
  const materialEvents=events.filter(e=>!String(e._type).includes('dividend'));
  const corporateActions={risk:corporate&&Object.keys(corporate).length?(materialEvents.length?'REVIEW':'CLEAR'):'UNKNOWN',windowStart:start,windowEnd:end,events:events.slice(0,12).map(e=>({type:e._type,id:e.id||null,exDate:e.ex_date||null,recordDate:e.record_date||null,payableDate:e.payable_date||null})),source:'ALPACA_CORPORATE_ACTIONS',warning:'Corporate-action data can arrive late; live broker/news checks still apply.'};
  const filingRisk=recentFilings.length?recentFilings.some(x=>x.form==='8-K'&&x.filingDate>=new Date(now.getTime()-3*86400000).toISOString().slice(0,10))?'REVIEW':'CLEAR':'UNKNOWN';
  enriched[symbol]={fundamentals,corporateActions,recentFilings,filingRisk,newsCatalyst:catalystFor(symbol),earnings:{status:'UNKNOWN',note:'No reliable scheduled earnings calendar is available in this pipeline; runtime event checks must remain fail-closed when earnings timing is unknown.'}};
}

for(const budget of [50,100,200,500]){const file=`docs/data/latest-${budget}.json`,data=await read(file);if(!data)continue;data.recommendations=(data.recommendations||[]).map(r=>enriched[r.symbol]?{...r,...enriched[r.symbol]}:r);data.finalistEnrichment={generatedAt:new Date().toISOString(),symbolsEnriched:Object.keys(enriched).length,sources:['SEC company facts/submissions when available','Alpaca corporate actions when available'],earningsCalendar:'UNKNOWN_FAIL_CLOSED'};await fs.writeFile(file,JSON.stringify(data,null,2));}
if(Array.isArray(broad.topCandidates))broad.topCandidates=broad.topCandidates.map(r=>enriched[r.symbol]?{...r,...enriched[r.symbol]}:r);broad.finalistEnrichment={generatedAt:new Date().toISOString(),symbolsEnriched:Object.keys(enriched).length};await fs.writeFile('docs/data/broad-stock-universe.json',JSON.stringify(broad,null,2));
console.log(`Enriched ${Object.keys(enriched).length} stock finalists; unavailable sources remain UNKNOWN instead of breaking the scan.`);

// Refresh the live defined-risk options chain scan now that the broad stock universe is finalized for
// this run. This is the only live source of real option contracts (docs/data/small-account-options.json);
// without it stockPlan.eliteOption downstream has nothing to evaluate. Failure here must never fail this
// enrichment step or the wider signal build -- options remain exceptional/optional, stocks are primary.
try{
  execFileSync('node',['scripts/scan-small-account-options.mjs'],{stdio:'inherit'});
}catch(e){
  console.warn('Options chain scan unavailable this run; continuing without it (eliteOption will be NO OPTION):',e.message);
}
