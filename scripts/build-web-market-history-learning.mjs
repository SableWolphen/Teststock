import fs from 'node:fs/promises';

const OUT='docs/data/web-market-history-learning.json';
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca credentials');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const years=Math.max(3,Math.min(20,Number(process.env.TESTSTOCK_HISTORY_YEARS||10)));
const startDate=new Date(Date.now()-years*365.25*86400000).toISOString().slice(0,10);
const endDate=new Date().toISOString().slice(0,10);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const round=(x,d=4)=>Number(Number(x).toFixed(d));
const pct=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b!==0?((a/b)-1)*100:null;
async function get(url,attempts=5){let err;for(let i=0;i<attempts;i++){try{const r=await fetch(url,{headers});if(r.ok)return r.json();err=new Error(`${r.status} ${await r.text()}`);}catch(e){err=e;}await sleep(350*(2**i));}throw err;}
function operatingCompany(a){
  const name=String(a?.name||'').trim();
  if(!name||!a?.symbol)return false;
  if(String(a.exchange||'').toUpperCase()==='OTC')return false;
  return !/(\bETF\b|\bETN\b|exchange.?traded|index fund|mutual fund|closed.end fund|\bfund\b|\bportfolio\b|\bproshares\b|\bishares\b|\bspdr\b|\bdirexion\b|\binvesco\b|\bwisdomtree\b|\bvaneck\b|\bglobal x\b|\bfirst trust\b|\bwarrant\b|\bright(s)?\b|\bunit(s)?\b|preferred|depositary shares|\b2x\b|\b3x\b|ultra|inverse)/i.test(name);
}
function sma(xs,n,i){if(i+1<n)return null;let s=0;for(let j=i-n+1;j<=i;j++)s+=Number(xs[j]||0);return s/n;}
function atr(bars,n,i){if(i<n)return null;let s=0,c=0;for(let j=i-n+1;j<=i;j++){if(j<=0)continue;const x=bars[j],p=bars[j-1];const tr=Math.max(Number(x.h)-Number(x.l),Math.abs(Number(x.h)-Number(p.c)),Math.abs(Number(x.l)-Number(p.c)));if(Number.isFinite(tr)){s+=tr;c++;}}return c?s/c:null;}
function bucketGap(x){return x>=3?'GAP_UP_3P':x>=1?'GAP_UP_1_3':x<=-3?'GAP_DOWN_3P':x<=-1?'GAP_DOWN_1_3':'GAP_FLAT';}
function bucketTrend(c,m20,m50,m200){if(c>m20&&m20>m50&&m50>m200)return'UPTREND';if(c<m20&&m20<m50&&m50<m200)return'DOWNTREND';return'MIXED';}
function bucketMom(m20){return m20>=10?'MOMENTUM_STRONG_UP':m20>=3?'MOMENTUM_UP':m20<=-10?'MOMENTUM_STRONG_DOWN':m20<=-3?'MOMENTUM_DOWN':'MOMENTUM_FLAT';}
function bucketVol(x){return x>=5?'VOL_HIGH':x>=2.5?'VOL_MEDIUM':'VOL_LOW';}
function stat(){return {n:0,sum1:0,sum5:0,sum20:0,w1:0,w5:0,w20:0};}
function add(s,r1,r5,r20){s.n++;for(const [k,v] of [['1',r1],['5',r5],['20',r20]]){if(Number.isFinite(v)){s['sum'+k]+=v;if(v>0)s['w'+k]++;}}}
function finish(s){return {samples:s.n,avgReturn1dPct:round(s.sum1/Math.max(1,s.n),3),hitRate1dPct:round(s.w1/Math.max(1,s.n)*100,1),avgReturn5dPct:round(s.sum5/Math.max(1,s.n),3),hitRate5dPct:round(s.w5/Math.max(1,s.n)*100,1),avgReturn20dPct:round(s.sum20/Math.max(1,s.n),3),hitRate20dPct:round(s.w20/Math.max(1,s.n)*100,1)};}

const assets=await get('https://paper-api.alpaca.markets/v2/assets?asset_class=us_equity');
const universe=(assets||[]).filter(operatingCompany);
const active=universe.filter(a=>a.status==='active'&&a.tradable===true);
const inactive=universe.filter(a=>a.status!=='active');
const symbols=[...new Set(universe.map(a=>a.symbol))].sort();
const patternStats=new Map(),symbolStats={},errors=[];
let symbolsWithHistory=0,totalBars=0,totalObservations=0;

for(const batch of chunks(symbols,40)){
  const by={}; let token='';
  try{
    for(let page=0;page<80;page++){
      const q=new URLSearchParams({symbols:batch.join(','),timeframe:'1Day',start:startDate,end:endDate,limit:'10000',adjustment:'all',feed:'iex'});
      if(token)q.set('page_token',token);
      const raw=await get(`https://data.alpaca.markets/v2/stocks/bars?${q}`);
      for(const [sym,bars] of Object.entries(raw.bars||{}))by[sym]=[...(by[sym]||[]),...bars];
      token=raw.next_page_token||''; if(!token)break;
    }
  }catch(e){errors.push({batch:batch.slice(0,5),count:batch.length,error:String(e?.message||e)});continue;}

  for(const sym of batch){
    const bars=(by[sym]||[]).filter(b=>Number.isFinite(Number(b.c))&&Number.isFinite(Number(b.o))).sort((a,b)=>String(a.t).localeCompare(String(b.t)));
    if(bars.length<260)continue;
    symbolsWithHistory++; totalBars+=bars.length;
    const closes=bars.map(b=>Number(b.c));
    const ss=stat();
    for(let i=200;i<bars.length-21;i+=5){
      const c=closes[i], prev=closes[i-1], m20=sma(closes,20,i),m50=sma(closes,50,i),m200=sma(closes,200,i);
      const a=atr(bars,14,i); if(![c,prev,m20,m50,m200,a].every(Number.isFinite)||c<=0)continue;
      const gap=pct(Number(bars[i].o),prev),mom20=pct(c,closes[i-20]),atrPct=a/c*100;
      const r1=pct(closes[i+1],c),r5=pct(closes[i+5],c),r20=pct(closes[i+20],c);
      const keys=[
        `TREND:${bucketTrend(c,m20,m50,m200)}`,
        `MOMENTUM:${bucketMom(mom20)}`,
        `VOLATILITY:${bucketVol(atrPct)}`,
        `GAP:${bucketGap(gap||0)}`,
        `COMBO:${bucketTrend(c,m20,m50,m200)}|${bucketMom(mom20)}|${bucketVol(atrPct)}|${bucketGap(gap||0)}`
      ];
      for(const k of keys){if(!patternStats.has(k))patternStats.set(k,stat());add(patternStats.get(k),r1,r5,r20);}
      add(ss,r1,r5,r20); totalObservations++;
    }
    symbolStats[sym]=finish(ss);
  }
}

const patterns=Object.fromEntries([...patternStats.entries()].filter(([,s])=>s.n>=100).sort((a,b)=>b[1].n-a[1].n).map(([k,s])=>[k,finish(s)]));
const out={
  schemaVersion:1,generatedAt:new Date().toISOString(),source:'ALPACA_WEB_HISTORICAL_MARKET_DATA',authority:'RESEARCH_ONLY',
  coverage:{yearsRequested:years,startDate,endDate,operatingCompanyAssets:universe.length,activeTradableAssets:active.length,inactiveAssetsIncluded:inactive.length,symbolsRequested:symbols.length,symbolsWithAtLeast260DailyBars:symbolsWithHistory,totalDailyBarsProcessed:totalBars,totalNonOverlappingObservations:totalObservations,errorBatches:errors.length},
  methodology:{barTimeframe:'1Day',feed:'IEX',adjustment:'all',sampling:'Every fifth eligible trading day after 200 days of lookback; forward 1/5/20-day closes',features:['20/50/200-day trend structure','20-day momentum','14-day ATR volatility','opening gap'],antiLeakage:'Features use bars at or before the observation timestamp; outcomes use only later bars.',survivorshipMitigation:'Requests both active and inactive US-equity assets available from the provider and reports coverage separately.',liveAuthority:'Historical priors may support research/ranking only. They cannot create execution eligibility, loosen risk gates, or override live Robinhood state.'},
  patterns,symbolStats,errors:errors.slice(0,50),
  cautions:['Provider coverage is not literally every security ever listed and IEX coverage is not the full consolidated tape.','Historical relationships can decay and are not guarantees of future profit.','Inactive-asset inclusion reduces but does not eliminate survivorship bias.','Daily-bar learning complements, but does not replace, separate intraday 1m/5m validation and Robinhood-confirmed real-fill learning.']
};
await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log(`Web history learning: ${symbolsWithHistory}/${symbols.length} symbols, ${totalBars} daily bars, ${totalObservations} observations, ${Object.keys(patterns).length} pattern buckets, errors=${errors.length}`);
