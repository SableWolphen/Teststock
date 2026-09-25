import fs from 'node:fs/promises';

const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const round=(n,d=4)=>Number(Number(n||0).toFixed(d));
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID,secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const get=async u=>{const r=await fetch(u,{headers});if(!r.ok)throw new Error(`Alpaca ${r.status}: ${await r.text()}`);return r.json();};

const scan=await read('docs/data/small-account-options.json',{candidates:[]});
const existing=await read('docs/data/options-historical-replay.json',{schemaVersion:1,contracts:[]});
const contracts=Array.isArray(existing.contracts)?existing.contracts:[];
const tracked=new Set(contracts.map(x=>x.contract));
const candidates=(scan.candidates||[]).filter(x=>x.contract&&!tracked.has(x.contract)).slice(0,100);

async function replay(c){
  const end=new Date().toISOString();
  const start=new Date(Date.now()-120*86400000).toISOString();
  const q=new URLSearchParams({start,end,timeframe:'1Day',limit:'1000',feed:process.env.ALPACA_OPTIONS_FEED||'indicative',sort:'asc'});
  const raw=await get(`https://data.alpaca.markets/v1beta1/options/bars?symbols=${encodeURIComponent(c.contract)}&${q}`);
  const rows=raw.bars?.[c.contract]||raw.bars?.[c.contract.toUpperCase()]||[];
  if(!rows.length)return null;
  const first=rows[0], last=rows.at(-1);
  const entry=Number(first.c??first.close??0), exit=Number(last.c??last.close??0);
  if(!(entry>0&&exit>0))return null;
  const ret=round((exit-entry)/entry,4);
  return {contract:c.contract,underlying:c.underlying,underlyingType:c.underlyingType||'STOCK',kind:c.kind,expiry:c.expiry,dteBucket:c.dteBucket,firstObservedAt:first.t??first.timestamp??null,lastObservedAt:last.t??last.timestamp??null,firstClose:round(entry),lastClose:round(exit),historicalReturnPct:round(ret*100,2),barsObserved:rows.length,source:'ALPACA_HISTORICAL_OPTIONS_BARS',modelOnly:true};
}

const results=[];
for(let i=0;i<candidates.length;i++){
  try{const x=await replay(candidates[i]);if(x)results.push(x);}
  catch(e){console.warn(`Historical options replay failed ${candidates[i].contract}: ${e.message}`);}
}
const all=[...contracts,...results].slice(-5000);
const resolved=all.filter(x=>Number.isFinite(x.historicalReturnPct));
const wins=resolved.filter(x=>x.historicalReturnPct>0).length;
const stats={contractsTested:resolved.length,positivePct:resolved.length?round(wins/resolved.length*100,1):null,averageHistoricalReturnPct:resolved.length?round(resolved.reduce((s,x)=>s+x.historicalReturnPct,0)/resolved.length,2):null};
const out={schemaVersion:1,generatedAt:new Date().toISOString(),lookbackDays:120,objective:'Historical replay of many real listed stock/ETF option contracts to supplement forward shadow learning. This is research evidence only and never authorizes a live order.',contracts:all,summary:stats,rules:['Historical results are not forward guarantees.','Historical replay is supplementary evidence; current live option-chain checks and forward shadow outcomes remain mandatory.','No historical result can override the hard account-loss cap, cash-only rule, no-exercise rule, or broker recheck.']};
await fs.writeFile('docs/data/options-historical-replay.json',JSON.stringify(out,null,2)+'\n');
console.log(`Options historical replay: added ${results.length} contracts; total=${all.length}; ${JSON.stringify(stats)}`);