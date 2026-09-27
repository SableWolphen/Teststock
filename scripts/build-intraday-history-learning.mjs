import fs from 'node:fs/promises';

const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca credentials');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(u){let e;for(let i=0;i<4;i++){try{const r=await fetch(u,{headers});if(r.ok)return r.json();e=new Error(`${r.status} ${await r.text()}`);}catch(x){e=x;}await sleep(250*(2**i));}throw e;}
const broad=await read('docs/data/broad-stock-universe.json');
const full=await read('docs/data/full-stock-validation-pool.json');
const web=await read('docs/data/web-market-history-learning.json');
const syms=[...new Set([...(broad.topCandidates||[]).map(x=>x.symbol),...(full.candidates||[]).slice(0,120).map(x=>x.symbol)])].filter(Boolean).slice(0,120);
const days=Math.max(20,Math.min(120,Number(process.env.TESTSTOCK_INTRADAY_DAYS||60)));
const start=new Date(Date.now()-days*86400000).toISOString();
const end=new Date().toISOString();
const stats={};
const add=(k,r)=>{const s=stats[k]??={n:0,sum:0,w:0};s.n++;s.sum+=r;if(r>0)s.w++;};
const pct=(a,b)=>b?((a/b)-1)*100:null;
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
let barsProcessed=0,errors=[];
for(const batch of chunks(syms,20)){
  try{
    let token='',by={};
    for(let page=0;page<30;page++){
      const q=new URLSearchParams({symbols:batch.join(','),timeframe:'5Min',start,end,limit:'10000',feed:'iex'});if(token)q.set('page_token',token);
      const raw=await get(`https://data.alpaca.markets/v2/stocks/bars?${q}`);
      for(const [s,b] of Object.entries(raw.bars||{}))by[s]=[...(by[s]||[]),...b];
      token=raw.next_page_token||'';if(!token)break;
    }
    for(const [sym,bars0] of Object.entries(by)){
      const daysMap=new Map();
      for(const b of bars0){const d=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(b.t));if(!daysMap.has(d))daysMap.set(d,[]);daysMap.get(d).push(b);}
      for(const bars of daysMap.values()){
        bars.sort((a,b)=>String(a.t).localeCompare(String(b.t)));barsProcessed+=bars.length;if(bars.length<20)continue;
        let pv=0,vol=0,orHigh=-Infinity,orLow=Infinity;
        for(let i=0;i<bars.length-6;i++){
          const b=bars[i],typ=(b.h+b.l+b.c)/3;pv+=typ*b.v;vol+=b.v;const vwap=vol?pv/vol:null;
          if(i<6){orHigh=Math.max(orHigh,b.h);orLow=Math.min(orLow,b.l);continue;}
          const fwd=bars[Math.min(i+6,bars.length-1)].c,r=pct(fwd,b.c);if(!Number.isFinite(r))continue;
          const mom=pct(b.c,bars[Math.max(0,i-3)].c);
          const relVol=b.v/Math.max(1,bars.slice(Math.max(0,i-12),i).reduce((s,x)=>s+x.v,0)/Math.max(1,Math.min(12,i)));
          const tags=[];
          if(b.c>orHigh&&relVol>=1.2)tags.push('OPENING_RANGE_BREAKOUT');
          if(b.c>vwap&&mom>0)tags.push('VWAP_MOMENTUM_CONTINUATION');
          if(b.c<vwap&&mom<0)tags.push('VWAP_WEAKNESS');
          if(relVol>=2)tags.push('VOLUME_SPIKE');
          const hour=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hour12:false}).format(new Date(b.t));
          tags.push(Number(hour)<11?'TIME_OPEN':Number(hour)<14?'TIME_MIDDAY':'TIME_LATE');
          for(const t of tags)add(t,r);
        }
      }
    }
  }catch(e){errors.push({batch:batch.slice(0,3),error:String(e?.message||e)});}
}
const patterns=Object.fromEntries(Object.entries(stats).filter(([,s])=>s.n>=50).map(([k,s])=>[k,{samples:s.n,avgForward30mPct:Number((s.sum/s.n).toFixed(4)),hitRatePct:Number((s.w/s.n*100).toFixed(1))}]).sort((a,b)=>b[1].samples-a[1].samples));
const out={schemaVersion:1,generatedAt:new Date().toISOString(),source:'ALPACA_5MIN_HISTORICAL',authority:'RESEARCH_ONLY',coverage:{daysRequested:days,symbolsRequested:syms.length,barsProcessed,errorBatches:errors.length,dailyHistoryGeneratedAt:web.generatedAt||null},patterns,errors,policy:{use:'Intraday pattern priors may rank/reduce candidates and inform exit research only.',cannot:'Cannot create live eligibility, increase hard risk limits, bypass profitability admission, or override Robinhood.',promotion:'Changes suggested by this history require forward/shadow or real-fill confirmation before increasing live risk.'}};
await fs.writeFile('docs/data/intraday-history-learning.json',JSON.stringify(out,null,2));
console.log(`Intraday history: ${syms.length} symbols, ${barsProcessed} 5m bars, ${Object.keys(patterns).length} pattern buckets`);
