import fs from 'node:fs/promises';

const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca credentials');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let requestGate=Promise.resolve(),lastRequestAt=0;
async function throttle(){const prev=requestGate;let release;requestGate=new Promise(r=>release=r);await prev;const wait=Math.max(0,250-(Date.now()-lastRequestAt));if(wait)await sleep(wait);lastRequestAt=Date.now();release();}
async function get(u){let e;for(let i=0;i<6;i++){try{await throttle();const r=await fetch(u,{headers});if(r.ok)return r.json();const body=await r.text();e=new Error(`${r.status} ${body}`);const retryAfter=Number(r.headers.get('retry-after'));if(r.status===429){await sleep(Number.isFinite(retryAfter)?retryAfter*1000:1000*(2**i));continue;}}catch(x){e=x;}await sleep(350*(2**i));}throw e;}
const broad=await read('docs/data/broad-stock-universe.json');
const full=await read('docs/data/full-stock-validation-pool.json');
const web=await read('docs/data/web-market-history-learning.json');

const maxSymbols=Math.max(120,Math.min(400,Number(process.env.TESTSTOCK_INTRADAY_SYMBOLS||240)));
const syms=[...new Set([
  ...(broad.topCandidates||[]).map(x=>x.symbol),
  ...(full.candidates||[]).slice(0,maxSymbols).map(x=>x.symbol)
])].filter(Boolean).slice(0,maxSymbols);
const days=Math.max(20,Math.min(180,Number(process.env.TESTSTOCK_INTRADAY_DAYS||90)));
const start=new Date(Date.now()-days*86400000).toISOString();
const end=new Date().toISOString();

const stats={};
const add=(k,r15,r30,r60,mfe30,mae30)=>{
  const s=stats[k]??={n:0,w30:0,sum15:0,sum30:0,sum60:0,mfe30:0,mae30:0};
  s.n++; s.sum15+=r15; s.sum30+=r30; s.sum60+=r60; s.mfe30+=mfe30; s.mae30+=mae30;
  if(r30>0)s.w30++;
};
const pct=(a,b)=>b?((a/b)-1)*100:null;
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
const nyMinute=t=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(t));const h=Number(p.find(x=>x.type==='hour')?.value||0),m=Number(p.find(x=>x.type==='minute')?.value||0);return h*60+m;};

let barsProcessed=0,errors=[];
for(const batch of chunks(syms,20)){
  try{
    let token='',by={};
    for(let page=0;page<45;page++){
      const q=new URLSearchParams({symbols:batch.join(','),timeframe:'5Min',start,end,limit:'10000',feed:'iex'});
      if(token)q.set('page_token',token);
      const raw=await get(`https://data.alpaca.markets/v2/stocks/bars?${q}`);
      for(const [s,b] of Object.entries(raw.bars||{}))by[s]=[...(by[s]||[]),...b];
      token=raw.next_page_token||'';
      if(!token)break;
    }

    for(const bars0 of Object.values(by)){
      const daysMap=new Map();
      for(const b of bars0){
        const d=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(b.t));
        if(!daysMap.has(d))daysMap.set(d,[]);
        daysMap.get(d).push(b);
      }

      for(const bars of daysMap.values()){
        bars.sort((a,b)=>String(a.t).localeCompare(String(b.t)));
        barsProcessed+=bars.length;
        if(bars.length<26)continue;

        let pv=0,vol=0,orHigh=-Infinity,orLow=Infinity,prevVwap=null,prevClose=null;
        for(let i=0;i<bars.length-12;i++){
          const b=bars[i],typ=(b.h+b.l+b.c)/3;
          pv+=typ*b.v; vol+=b.v;
          const vwap=vol?pv/vol:null;

          if(i<6){
            orHigh=Math.max(orHigh,b.h); orLow=Math.min(orLow,b.l);
            prevVwap=vwap; prevClose=b.c;
            continue;
          }

          const r15=pct(bars[i+3].c,b.c),r30=pct(bars[i+6].c,b.c),r60=pct(bars[i+12].c,b.c);
          if(![r15,r30,r60].every(Number.isFinite)){prevVwap=vwap;prevClose=b.c;continue;}
          const next30=bars.slice(i+1,i+7),mfe30=Math.max(...next30.map(x=>pct(x.h,b.c))),mae30=Math.min(...next30.map(x=>pct(x.l,b.c)));
          const mom5=pct(b.c,bars[Math.max(0,i-1)].c);
          const mom15=pct(b.c,bars[Math.max(0,i-3)].c);
          const base=bars.slice(Math.max(0,i-12),i);
          const relVol=b.v/Math.max(1,base.reduce((s,x)=>s+x.v,0)/Math.max(1,base.length));
          const minTime=nyMinute(b.t);
          const bullish=[];
          const bearish=[];

          if(b.c>orHigh&&relVol>=1.2)bullish.push('OPENING_RANGE_BREAKOUT');
          if(b.c<orLow&&relVol>=1.2)bearish.push('OPENING_RANGE_BREAKDOWN');
          if(b.c>vwap&&mom15>0)bullish.push('VWAP_MOMENTUM_CONTINUATION');
          if(b.c<vwap&&mom15<0)bearish.push('VWAP_WEAKNESS');
          if(prevClose!=null&&prevVwap!=null&&prevClose<=prevVwap&&b.c>vwap&&mom5>0)bullish.push('VWAP_RECLAIM');
          if(prevClose!=null&&prevVwap!=null&&prevClose>=prevVwap&&b.c<vwap&&mom5<0)bearish.push('VWAP_REJECTION');
          const recent3=bars.slice(Math.max(0,i-3),i);
          if(b.c>vwap&&mom5>0&&recent3.some(x=>x.l<=vwap*1.002))bullish.push('VWAP_PULLBACK_CONTINUATION');
          if(b.c<orHigh&&prevClose!=null&&prevClose>orHigh&&mom5<0)bearish.push('FAILED_BREAKOUT');
          if(relVol>=1.8&&mom15>0)bullish.push('RELATIVE_VOLUME_MOMENTUM');
          if(relVol>=1.8&&mom15<0)bearish.push('RELATIVE_VOLUME_DOWNSIDE');

          const session=minTime<660?'TIME_OPEN':minTime<840?'TIME_MIDDAY':'TIME_LATE';
          for(const t of bullish)add(t,r15,r30,r60,mfe30,mae30);
          for(const t of bearish)add(t,-r15,-r30,-r60,-mae30,-mfe30);
          add(session,r15,r30,r60,mfe30,mae30);

          prevVwap=vwap; prevClose=b.c;
        }
      }
    }
  }catch(e){errors.push({batch:batch.slice(0,3),error:String(e?.message||e)});}
}

const patterns=Object.fromEntries(
  Object.entries(stats)
    .filter(([,s])=>s.n>=75)
    .map(([k,s])=>[k,{
      samples:s.n,
      avgForward15mPct:Number((s.sum15/s.n).toFixed(4)),
      avgForward30mPct:Number((s.sum30/s.n).toFixed(4)),
      avgForward60mPct:Number((s.sum60/s.n).toFixed(4)),
      hitRate30mPct:Number((s.w30/s.n*100).toFixed(1)),
      avgMfe30mPct:Number((s.mfe30/s.n).toFixed(4)),
      avgMae30mPct:Number((s.mae30/s.n).toFixed(4))
    }])
    .sort((a,b)=>b[1].samples-a[1].samples)
);

const out={
  schemaVersion:2,
  generatedAt:new Date().toISOString(),
  source:'ALPACA_5MIN_HISTORICAL',
  authority:'RESEARCH_ONLY',
  coverage:{daysRequested:days,symbolsRequested:syms.length,barsProcessed,errorBatches:errors.length,dailyHistoryGeneratedAt:web.generatedAt||null},
  patterns,
  errors,
  acceleration:{
    goal:'Increase the number of independently evidenced quality setups without lowering the live execution bar.',
    expandedUniverseSymbols:maxSymbols,
    setupFamilies:['OPENING_RANGE_BREAKOUT','OPENING_RANGE_BREAKDOWN','VWAP_MOMENTUM_CONTINUATION','VWAP_RECLAIM','VWAP_REJECTION','VWAP_PULLBACK_CONTINUATION','FAILED_BREAKOUT','RELATIVE_VOLUME_MOMENTUM','RELATIVE_VOLUME_DOWNSIDE'],
    horizonsMinutes:[15,30,60],
    directionAware:true
  },
  policy:{
    use:'Intraday pattern priors may rank, route, shadow-test, or reduce candidates and may help discover more quality opportunities.',
    cannot:'Historical research alone cannot create live eligibility, increase hard risk limits, bypass profitability admission, or override Robinhood.',
    promotion:'A newly discovered setup must earn forward/shadow evidence and then real-fill confirmation before it can increase live risk.'
  }
};
await fs.writeFile('docs/data/intraday-history-learning.json',JSON.stringify(out,null,2));
console.log(`Intraday history v2: ${syms.length} symbols, ${barsProcessed} 5m bars, ${Object.keys(patterns).length} pattern buckets`);
