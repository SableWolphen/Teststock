import fs from 'node:fs/promises';
import {openNewShadowTrades,resolveOptionShadowTrade,summarizeShadowTrades,newYorkSession} from './options-shadow-engine.mjs';

// Phase 1 of the options shadow-evidence pipeline (2026-09-25, user-requested: a real,
// properly-gated options-execution policy). This script never places an order and never
// touches Robinhood -- it only paper-tracks what would have happened to the best STANDARD
// (non-0DTE/weekly) candidate small-account-options.json finds each day, using real live
// Alpaca option quotes to resolve outcomes. Live execution is a separate, later, deliberate
// step gated on this evidence -- see docs/data/options-profitability-admission.json.
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID,secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const get=async u=>{
  let lastError;
  for(let attempt=0;attempt<5;attempt++){
    const r=await fetch(u,{headers});
    if(r.ok)return r.json();
    const body=await r.text();
    lastError=new Error(`Alpaca ${r.status}: ${body}`);
    if(r.status!==429&&r.status<500)throw lastError;
    const retryAfter=Number(r.headers.get('retry-after')||0);
    const waitMs=retryAfter>0?retryAfter*1000:Math.min(20000,1000*(2**attempt));
    console.warn(`Alpaca ${r.status} on option snapshot fetch; retrying in ${waitMs}ms (attempt ${attempt+1}/5)`);
    await sleep(waitMs);
  }
  throw lastError;
};
const feed=process.env.ALPACA_OPTIONS_FEED||'indicative';
const snapshotCache=new Map();

async function liveSnapshotFor(underlying,contract){
  try{
    let raw=snapshotCache.get(underlying);
    if(!raw){
      const q=new URLSearchParams({feed,limit:'1000'});
      raw=await get(`https://data.alpaca.markets/v1beta1/options/snapshots/${underlying}?${q}`);
      snapshotCache.set(underlying,raw);
    }
    const s=(raw.snapshots||{})[contract];
    if(!s)return null;
    const qx=s.latestQuote||s.latest_quote||{};
    const bid=Number(qx.bp??qx.bid_price??0),ask=Number(qx.ap??qx.ask_price??0);
    return bid>0&&ask>0?{bid,ask}:null;
  }catch(error){
    console.warn(`Options shadow ledger snapshot lookup ${underlying} ${contract}: ${error.message}`);
    return null;
  }
}

const scan=await read('docs/data/small-account-options.json',{candidates:[]});
let ledger=await read('docs/data/options-shadow-trades.json',{schemaVersion:1,generatedAt:null,trades:[]});
ledger.trades=Array.isArray(ledger.trades)?ledger.trades:[];

const nowIso=new Date().toISOString(),todayIso=nowIso.slice(0,10);
const marketSession=newYorkSession(nowIso);

const openTrades=ledger.trades.filter(x=>x.status==='OPEN');
for(const trade of openTrades){
  const snapshot=await liveSnapshotFor(trade.underlying,trade.contract);
  const resolved=resolveOptionShadowTrade(trade,snapshot,nowIso,marketSession);
  const idx=ledger.trades.findIndex(x=>x.id===trade.id);
  if(idx>=0)ledger.trades[idx]=resolved;
}

const newTrades=openNewShadowTrades({candidates:scan.candidates||[],existingTrades:ledger.trades,todayIso:marketSession.date,nowIso,maxNewPerUtcDay:25,marketSession});
ledger.trades.push(...newTrades);

const terminalOptionTrades=ledger.trades.filter(t=>t.status!=='OPEN').slice(-20000);const openOptionTrades=ledger.trades.filter(t=>t.status==='OPEN').slice(-3000);ledger.trades=[...terminalOptionTrades,...openOptionTrades];
ledger.generatedAt=nowIso;
ledger.summary=summarizeShadowTrades(ledger.trades);
ledger.rules=[
  'Paper-only: no order is ever placed by this script. Tracks the top 25 STANDARD-DTE candidates small-account-options.json finds each UTC day, up to 25 new shadow positions per day.',
  'Resolution uses real live Alpaca option quotes for the exact same contract, re-queried on every run -- never fabricates an outcome from missing data. If a contract has no snapshot data at/after its expiry, it is marked UNKNOWN rather than guessed WIN/LOSS.',
  'Entries use the displayed ask and exits use the executable bid. Midpoint marks never count as realized shadow performance.',
  'The intraday profit floor moves to break-even after +20%, locks +15% after +35%, then trails 20% below the executable bid high-water mark after +50%. It never moves down.',
  'New shadow entries stop at 15:30 New York time and open positions resolve at the executable bid from 15:50 onward; any missed close is reconciled on the next quote and flagged.',
  'This evidence may unlock a capped, reduced-size shadow-to-live seed lane once independent sample/win-rate thresholds pass -- see options-profitability-admission.json. It can never create or loosen a hard execution gate on its own, and does not itself authorize any live order.',
];
await fs.writeFile('docs/data/options-shadow-trades.json',JSON.stringify(ledger,null,2)+'\n');
console.log(`Options shadow ledger: ${ledger.trades.length} trade(s), ${newTrades.length} new, ${JSON.stringify(ledger.summary)}`);

