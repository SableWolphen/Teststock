import fs from 'node:fs/promises';
import {buildIndexOptionsResearch,INDEX_OPTION_DEFINITIONS} from './index-options-research-engine.mjs';

const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const get=async u=>{const r=await fetch(u,{headers});if(!r.ok)throw new Error(`Alpaca ${r.status}: ${await r.text()}`);return r.json();};
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const sma=(a,n)=>avg(a.slice(-Math.min(n,a.length)));
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));

const now=new Date();
const start=new Date(now.getTime()-5*86400000).toISOString();
const rows=[];
const errors=[];

for(const def of INDEX_OPTION_DEFINITIONS){
  try{
    const q=new URLSearchParams({timeframe:'15Min',start,limit:'250',adjustment:'all',feed:'iex'});
    const raw=await get(`https://data.alpaca.markets/v2/stocks/${def.proxySymbol}/bars?${q}`);
    const bars=raw.bars||[];
    if(bars.length<50)throw new Error(`Only ${bars.length} 15-minute bars returned`);
    const closes=bars.map(x=>Number(x.c)).filter(Number.isFinite);
    const price=closes.at(-1),ma20=sma(closes,20),ma50=sma(closes,50);
    const fourBarsAgo=closes.at(-5)??price;
    const momentumPct=fourBarsAgo>0?(price/fourBarsAgo-1)*100:0;
    const direction=price>ma20&&ma20>ma50&&momentumPct>0?'BULLISH':price<ma20&&ma20<ma50&&momentumPct<0?'BEARISH':'MIXED';
    const trendDistancePct=ma50>0?(price/ma50-1)*100:0;
    const score=round(Math.abs(trendDistancePct)*10+Math.abs(momentumPct)*20,1);
    rows.push({symbol:def.proxySymbol,price:round(price),ma20:round(ma20),ma50:round(ma50),ma200:null,atrPct:null,direction,optionBias:direction,score,momentumPct:round(momentumPct,3),underlyingType:'INDEX_ETF',source:'ALPACA_15MIN_PROXY'});
  }catch(error){
    errors.push({proxySymbol:def.proxySymbol,error:String(error?.message||error)});
  }
}

const out=buildIndexOptionsResearch({optionsScan:{generatedAt:now.toISOString(),indexEtfResearch:rows},generatedAt:now.toISOString()});
out.proxyRefresh={source:'ALPACA_IEX_15MIN',generatedAt:now.toISOString(),rows,errors};
if(errors.length)out.rules.push('One or more proxy refreshes failed; affected index rows remain WAIT/UNKNOWN and cannot create eligibility.');
await fs.writeFile('docs/data/index-options-research.json',JSON.stringify(out,null,2)+'\n');
console.log('Fresh index-options proxy research: '+out.candidates.map(x=>x.indexSymbol+':'+x.proxyBias).join(', ')+(errors.length?` errors=${errors.length}`:''));
