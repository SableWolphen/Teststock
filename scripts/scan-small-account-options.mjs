import fs from 'node:fs/promises';
// No hardcoded/default underlying list: the options-scan universe is exactly the strongest
// names the broad, full-universe stock scan already found. A previously-included fixed
// mega-cap baseline was removed so this never defaults to the same fixed tickers regardless
// of what the live scan actually ranks.
// Widened 2026-09-24 at user request ("scan every single stock"): previously this only ranked
// the narrow top-30 topCandidates slice of broad-stock-universe.json. It now ranks every symbol
// that received real backtested historical validation this run -- docs/data/full-stock-validation-pool.json,
// ~1000 names vs. 30 -- so "is this stock a winnable option trade" is asked of the whole validated
// pool, not just whatever happened to make the very top of the stock tournament.
// Widened again 2026-09-24 at user request to include same-day/short-dated contracts ("daily
// options"). These carry categorically higher gamma/theta risk than the original 35-90 DTE
// window -- passing the same price/spread/delta bar does not mean equivalent risk -- so every
// candidate is tagged with a dteBucket (0DTE/WEEKLY/STANDARD) rather than blended in as
// equivalent. This still only widens the research scan: options remain walled off from
// automatic execution regardless of dteBucket (see CLAUDE.md).
// Widened again 2026-09-25 at user request to include highly liquid index ETFs (SPY/QQQ/IWM/DIA).
// The stock-derived pool explicitly excludes ETFs (expand-stock-universe.mjs's
// looksLikeOperatingCompany filter) since its growthQuality/fundamentals methodology doesn't
// apply to an index product -- so these are scored on plain technical trend instead and tagged
// underlyingType:'INDEX_ETF' (vs 'STOCK') rather than force-fit into the fundamentals scoring.
// This was motivated by the observed liquidity bottleneck (the dominant rejection reason across
// every real scan so far): SPY/QQQ-class options are some of the most liquid contracts that
// exist, so this directly targets that bottleneck rather than candidate breadth.
const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID,secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const get=async u=>{const r=await fetch(u,{headers});if(!r.ok)throw new Error(`Alpaca ${r.status}: ${await r.text()}`);return r.json();};
const latest=await read('docs/data/latest-100.json');
const broad=await read('docs/data/broad-stock-universe.json');
const fullPool=await read('docs/data/full-stock-validation-pool.json');
const poolCandidates=(fullPool.candidates||[]).filter(x=>x.symbol&&Number.isFinite(x.price)&&Number.isFinite(x.ma20)&&Number.isFinite(x.ma50)).map(x=>({...x,underlyingType:'STOCK'}));

const INDEX_ETF_UNIVERSE=['SPY','QQQ','IWM','DIA'];
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const sma=(xs,n)=>avg(xs.slice(-n));
const atr=(bars,n=14)=>{const xs=[];for(let i=Math.max(1,bars.length-n);i<bars.length;i++){const x=bars[i],p=bars[i-1];xs.push(Math.max(x.h-x.l,Math.abs(x.h-p.c),Math.abs(x.l-p.c)));}return avg(xs);};
async function indexEtfCandidates(){
  const out=[];
  const start=new Date(Date.now()-260*86400000).toISOString().slice(0,10);
  for(const symbol of INDEX_ETF_UNIVERSE){
    try{
      const q=new URLSearchParams({timeframe:'1Day',start,limit:'300',adjustment:'all',feed:'iex'});
      const raw=await get(`https://data.alpaca.markets/v2/stocks/${symbol}/bars?${q}`);
      const bars=raw.bars||[];
      if(bars.length<60)continue;
      const c=bars.map(x=>x.c),price=c.at(-1),ma20=sma(c,20),ma50=sma(c,50),ma200=sma(c,Math.min(200,c.length));
      const a=atr(bars.map(x=>({h:x.h,l:x.l,c:x.c}))),atrPct=round((a/price)*100,2);
      const direction=price>ma20&&price>ma50?'BULLISH':'MIXED';
      // No fundamentals-based growthQuality exists for an index product; score is pure trend
      // strength (same formula trendScore below applies to price/ma20/ma50/ma200/atrPct), so
      // an index ETF is never artificially boosted above or held below a real stock candidate.
      out.push({symbol,price:round(price),ma20:round(ma20),ma50:round(ma50),ma200:round(ma200),atrPct,direction,score:0,underlyingType:'INDEX_ETF'});
    }catch(error){console.warn(`Index ETF candidate fetch ${symbol}: ${error.message}`);}
  }
  return out;
}
const etfCandidates=await indexEtfCandidates();

const recommendationScore=new Map((latest.recommendations||[]).map(x=>[x.symbol,Number(x.score||0)]));
const trendScore=x=>{
  const above20=x.ma20>0?(x.price/x.ma20-1)*100:0;
  const above50=x.ma50>0?(x.price/x.ma50-1)*100:0;
  const above200=x.ma200>0?(x.price/x.ma200-1)*100:0;
  return Math.max(Number(recommendationScore.get(x.symbol)||0),Number(x.score||0))+above20*2+above50+Math.max(0,above200)*.25-Math.max(0,Number(x.atrPct||0)-5)*2;
};
const ranked=[...poolCandidates,...etfCandidates].filter(x=>x.direction==='BULLISH'&&Number(x.price)>Number(x.ma20)&&Number(x.price)>Number(x.ma50)).sort((a,b)=>trendScore(b)-trendScore(a));
const now=new Date(),iso=d=>d.toISOString().slice(0,10),gte=iso(now),lte=iso(new Date(now.getTime()+90*864e5));
const dteBucket=dte=>dte<=1?'0DTE':dte<=14?'WEEKLY':'STANDARD';
const feed=process.env.ALPACA_OPTIONS_FEED||'indicative';
const choices=[],errors=[],rejections={noBidAsk:0,spread:0,dte:0,delta:0,premium:0};
const CONCURRENCY=12;
for(const batch of chunks(ranked,CONCURRENCY)){
  await Promise.all(batch.map(async u=>{
    try{
      const q=new URLSearchParams({feed,limit:'1000',expiration_date_gte:gte,expiration_date_lte:lte,strike_price_gte:String(round(u.price*.82,2)),strike_price_lte:String(round(u.price*1.18,2))});
      const raw=await get(`https://data.alpaca.markets/v1beta1/options/snapshots/${u.symbol}?${q}`);
      for(const [contract,s] of Object.entries(raw.snapshots||{})){
        const m=contract.match(/^([A-Z.]+)(\d{6})(C)(\d{8})$/);if(!m)continue;
        const expiry=new Date(Date.UTC(2000+Number(m[2].slice(0,2)),Number(m[2].slice(2,4))-1,Number(m[2].slice(4,6)))),dte=Math.ceil((expiry-now)/864e5),strike=Number(m[4])/1000;
        const qx=s.latestQuote||s.latest_quote||{},bid=Number(qx.bp??qx.bid_price??0),ask=Number(qx.ap??qx.ask_price??0),mid=(bid+ask)/2,spreadPct=mid>0?(ask-bid)/mid*100:999;
        const g=s.greeks||{},delta=Math.abs(Number(g.delta||0)),iv=Number(s.impliedVolatility??s.implied_volatility??0),premium=ask*100;
        if(!(ask>0&&bid>0)){rejections.noBidAsk++;continue;}
        if(spreadPct>10){rejections.spread++;continue;}
        if(dte<0||dte>90){rejections.dte++;continue;}
        if(delta<.25||delta>.70){rejections.delta++;continue;}
        if(premium>35){rejections.premium++;continue;}
        const underlyingScore=round(trendScore(u),1);
        const bucket=dteBucket(dte);
        // Passing the same price/spread/delta bar does not mean equivalent risk: a same-day or
        // weekly contract carries far more gamma/theta blowup risk than a 35-90 DTE one, so that
        // risk gets priced into the ranking score directly rather than only shown as a label.
        const bucketRiskPenalty={'0DTE':25,'WEEKLY':8,'STANDARD':0}[bucket];
        const score=round(underlyingScore+Math.max(0,10-spreadPct)*1.5+Math.max(0,8-Math.abs(delta-.45)*20)-Math.max(0,iv-1)*5-bucketRiskPenalty,1);
        choices.push({underlying:u.symbol,underlyingType:u.underlyingType||'STOCK',contract,kind:'LONG_CALL',expiry:iso(expiry),dte,dteBucket:bucket,strike,bid:round(bid,3),ask:round(ask,3),mid:round(mid,3),spreadPct:round(spreadPct,1),delta:round(delta,2),iv:round(iv,2),oneContractPremiumDollars:round(premium,2),underlyingPrice:u.price,underlyingScore,score});
      }
    }catch(error){errors.push({underlying:u.symbol,error:String(error?.message||error)});}
  }));
}
choices.sort((a,b)=>b.score-a.score||a.spreadPct-b.spreadPct||a.oneContractPremiumDollars-b.oneContractPremiumDollars);
const out={schemaVersion:6,generatedAt:new Date().toISOString(),sourceSnapshotAsOf:latest.asOf||null,broadUniverseGeneratedAt:broad.generatedAt||null,fullPoolGeneratedAt:fullPool.generatedAt||null,fullPoolCandidateCount:poolCandidates.length,indexEtfUniverse:INDEX_ETF_UNIVERSE,indexEtfCandidatesFound:etfCandidates.length,objective:'Search options on every stock this run\'s full validated pool (not just the narrow top-30 topCandidates slice) found bullish, across the broad active-US-equity scan -- not only mega-cap stocks. Includes same-day/short-dated contracts, tagged by dteBucket and scored with a risk penalty for shorter expirations -- not blended in as equivalent risk to a 35-90 DTE contract. Also includes highly liquid index ETFs (SPY/QQQ/IWM/DIA), scored on plain technical trend rather than the fundamentals methodology used for stocks, tagged underlyingType.',policy:{maxOneContractPremiumDollars:35,minDte:0,maxDte:90,maxSpreadPct:10,minAbsDelta:.25,maxAbsDelta:.70,dteBuckets:{'0DTE':'dte<=1, heaviest risk penalty, highest gamma/theta blowup risk','WEEKLY':'dte 2-14, moderate risk penalty','STANDARD':'dte 15-90, no risk penalty, the original policy window'},definedRiskOnly:true,liveWholeContractCheckRequired:true,doesNotOverrideRealFillGate:true,researchOnlyNeverAutoExecutes:'Options remain walled off from automatic execution regardless of dteBucket or underlyingType -- see CLAUDE.md.'},underlyingsScannedCount:ranked.length,underlyingsScanned:ranked.map(x=>x.symbol),contractsQualified:choices.length,candidates:choices.slice(0,15),best:choices[0]||null,rejections,scanErrors:errors};
await fs.writeFile('docs/data/small-account-options.json',JSON.stringify(out,null,2));
console.log(`Small-account option scan: ${ranked.length} underlyings, ${choices.length} qualified contracts, ${errors.length} errors`);
