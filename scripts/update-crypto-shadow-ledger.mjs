import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir=path.resolve('docs/data');
const ledgerFile=path.join(dataDir,'crypto-shadow-trades.json');
const planFile=path.join(dataDir,'crypto-plan-100.json');
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const round=(n,d=6)=>Number(Number(n||0).toFixed(d));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const day=x=>String(x||'').slice(0,10);

// User-requested fix (2026-08-23): the crypto day-trade model resolves against 4-hour setups with
// 3R/5R targets meant to play out over hours to a few days -- but this ledger was resolving against
// once-a-day Alpaca crypto bars over a 20-DAY window. Over 500 candidate rows had accumulated with
// zero ever reaching status RESOLVED, because a trade created today could not even be tested for
// entry until a full calendar day had passed. That silently meant crypto could never earn the
// forward-shadow evidence needed to leave SHADOW_ONLY, regardless of how good the setups actually
// were. This now resolves against the same Crypto.com public 4-hour candlestick feed
// generate-crypto-picks.mjs uses to build the entry/stop/target levels being tested -- consistent
// with the 2026-08-22/23 decision to drop Alpaca's crypto feed entirely (unreliable volume figures,
// unreliable native 4-hour candles) -- on the timeframe the setup actually trades on. HOLD_BARS is in
// 4-hour units, not days.
const CC='https://api.crypto.com/exchange/v1/public';
const HOLD_BARS=30; // 30 x 4h = 5 days: covers the day-trade/short-swing horizon while giving a setup
                    // that hasn't been chased yet a real chance to still be reached.
async function cget(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error(`Crypto.com ${r.status}: ${await r.text()}`);
  const j=await r.json();
  if(j.code!==undefined&&j.code!==0)throw new Error(`Crypto.com code ${j.code}: ${j.message||j.msg||''}`);
  return j.result??j;
}
function toRows(data){
  return (data||[]).map(x=>({
    t:x.t!=null?new Date(Number(x.t)).toISOString():(x.timestamp||null),
    o:Number(x.o??x.open??0),h:Number(x.h??x.high??0),l:Number(x.l??x.low??0),c:Number(x.c??x.close??0),
  })).filter(x=>x.t&&x.c>0).sort((a,b)=>new Date(a.t)-new Date(b.t));
}
async function candles4h(symbol,count=300){
  const instrument=symbol.replace('/','_');
  const q=new URLSearchParams({instrument_name:instrument,timeframe:'4h',interval:'4h',count:String(count)});
  const j=await cget(`${CC}/get-candlestick?${q}`);
  return toRows(j.data||j.candles||[]);
}

function resolveTrade(t,xs){
  if(t.status!=='OPEN')return t;
  const entry=Number(t.entry),stop=Number(t.stop),target=Number(t.target2||t.target1),risk=Math.max(1e-8,entry-stop);
  if(!(entry>stop&&target>entry))return {...t,status:'UNKNOWN',notes:'Invalid shadow geometry'};
  const createdAtMs=new Date(t.createdAt||`${t.createdDate}T00:00:00Z`).getTime();
  const forward=xs.filter(b=>new Date(b.t).getTime()>createdAtMs);
  let entered=false,count=0,current=t;
  for(const b of forward){
    if(count>=HOLD_BARS)break;
    count++;
    if(!entered){
      if(!(b.l<=entry&&b.h>=entry))continue;
      entered=true;
      current={...current,entryTouchedAt:b.t};
    }
    const stopHit=b.l<=stop,targetHit=b.h>=target;
    if(stopHit&&targetHit)return {...current,status:'AMBIGUOUS',resolvedAt:b.t,realizedR:null};
    if(stopHit)return {...current,status:'RESOLVED',outcome:'LOSS',resolvedAt:b.t,realizedR:-1};
    if(targetHit)return {...current,status:'RESOLVED',outcome:'WIN',resolvedAt:b.t,realizedR:round((target-entry)/risk,4)};
  }
  if(entered&&count>=HOLD_BARS){
    const last=forward.slice(0,HOLD_BARS).at(-1);
    if(last){
      const r=clamp((Number(last.c)-entry)/risk,-1,(target-entry)/risk);
      return {...current,status:'RESOLVED',outcome:r>0?'WIN':r<0?'LOSS':'FLAT',resolvedAt:last.t,realizedR:round(r,4)};
    }
  }
  if(!entered&&forward.length>=HOLD_BARS){
    // Price never returned to the entry zone within the day-trade/short-swing window. Mark it closed
    // so it stops being retried and reported as misleadingly "OPEN" forever, but this stays out of
    // admission's WIN/LOSS accounting -- apply-crypto-profitability-admission.mjs only counts
    // status==='RESOLVED', so EXPIRED rows are excluded exactly like unresolved OPEN rows were.
    return {...current,status:'EXPIRED',resolvedAt:forward[HOLD_BARS-1]?.t||null,notes:'Price never returned to the entry zone within the day-trade/short-swing window.'};
  }
  return current;
}
function summary(rows){const done=rows.filter(x=>x.status==='RESOLVED'&&Number.isFinite(Number(x.realizedR))),stats={};for(const decision of ['ACCEPTED','REJECTED']){const xs=done.filter(x=>x.decision===decision),wins=xs.filter(x=>Number(x.realizedR)>0).length;stats[decision]={resolved:xs.length,winRatePct:xs.length?round(wins/xs.length*100,1):null,averageR:xs.length?round(xs.reduce((s,x)=>s+Number(x.realizedR),0)/xs.length,2):null};}const a=stats.ACCEPTED.averageR,r=stats.REJECTED.averageR;return {...stats,opportunityCostSignal:a!=null&&r!=null?(r>a?'REJECTED_OUTPERFORMED_ACCEPTED':'ACCEPTED_OUTPERFORMED_REJECTED'):'NOT_ENOUGH_DATA',note:'Diagnostic only. Shadow outcomes may support profitability admission but must never loosen a hard live-money gate.'};}

const plan=await read(planFile,{});
let ledger=await read(ledgerFile,{schemaVersion:1,generatedAt:null,trades:[],summary:{}});
ledger.trades=Array.isArray(ledger.trades)?ledger.trades:[];

const openSymbols=[...new Set(ledger.trades.filter(x=>x.status==='OPEN').map(x=>x.symbol))];
for(const symbol of openSymbols){
  try{
    const xs=await candles4h(symbol,300);
    ledger.trades=ledger.trades.map(t=>t.symbol===symbol?resolveTrade({...t},xs):t);
  }catch(error){console.warn(`Crypto shadow update ${symbol}: ${error.message}`);}
}

const today=new Date().toISOString().slice(0,10);
const acceptedSymbols=new Set((plan.allocations||[]).map(x=>x.symbol));
const candidates=(plan.ranked||[]).slice(0,10);
for(const r of candidates){
  if(!(Number(r.entry)>0&&Number(r.stop)>0&&Number(r.target1)>0))continue;
  const decision=acceptedSymbols.has(r.symbol)?'ACCEPTED':'REJECTED';
  const id=`${today}-${r.symbol}-${decision}-${round(r.entry,6)}-${round(r.stop,6)}`;
  if(ledger.trades.some(x=>x.id===id))continue;
  ledger.trades.push({
    id,
    createdDate:today,
    createdAt:new Date().toISOString(),
    decision,
    symbol:r.symbol,
    setupGrade:r.setupGrade,
    btcTrendSupport:r.btcTrendSupport===true,
    entry:round(r.entry,6),
    stop:round(r.stop,6),
    target1:round(r.target1,6),
    target2:round(r.target2,6),
    growthQuality:r.growthQuality,
    rewardRisk1:r.rewardRisk1,
    rewardRisk2:r.rewardRisk2,
    status:'OPEN',
    outcome:null,
    realizedR:null,
    modelOnly:true,
  });
}

ledger.trades=ledger.trades.slice(-2000);
ledger.generatedAt=new Date().toISOString();
ledger.summary=summary(ledger.trades);
ledger.rules=[
  'Tracks accepted (would-have-bought) and rejected crypto model candidates for opportunity-cost diagnostics and shadow-first profitability admission.',
  'Uses future Crypto.com 4-hour candles only after the decision timestamp; never uses future data to create the decision. A trade resolves WIN/LOSS/FLAT within 30 four-hour bars (5 days) of being created, matching the day-trade/short-swing horizon it was generated for; if price never returns to the entry zone within that window it is marked EXPIRED rather than left open indefinitely.',
  'Shadow evidence may unlock reduced-size live probation via scripts/apply-crypto-profitability-admission.mjs; it may never automatically increase maximum live risk or loosen a hard gate.',
  'Robinhood Crypto API-confirmed real-fill history (crypto-real-trade-journal.json) remains authoritative for actual-money performance and full admission.',
];
await fs.writeFile(ledgerFile,JSON.stringify(ledger,null,2)+'\n');
console.log(`Crypto shadow ledger: ${ledger.trades.length} records; ${JSON.stringify(ledger.summary)}`);
