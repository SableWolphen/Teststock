import {calculateTradeReplay as calc, loadReplayBars} from './trade-replay-engine.mjs';
import {measuredNumber} from './performance-evidence.mjs';
import fs from 'node:fs/promises';
const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca credentials');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const num=x=>Number(x),finite=measuredNumber;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url){let last;for(let i=0;i<3;i++){try{const r=await fetch(url,{headers});if(r.ok)return r.json();last=new Error(`REPLAY_HTTP_${r.status}`);}catch(e){last=e;}await sleep(250*(2**i));}throw last;}
const [sj,cj]=await Promise.all([read('docs/data/real-trade-journal.json',{}),read('docs/data/crypto-real-trade-journal.json',{})]);
const trades=[...(sj.trades||[]),...(cj.trades||[])].filter(t=>(t?.assetClass==='CRYPTO'?t?.reconciledFromRobinhoodCryptoApi===true:t?.assetClass==='STOCK'&&t?.reconciledFromRobinhood===true)&&['WIN','LOSS','FLAT'].includes(t.outcome)&&t.entryFilledAt&&t.finalExitAt&&finite(t.actualAverageEntry)).sort((a,b)=>new Date(b.finalExitAt)-new Date(a.finalExitAt)).slice(0,30);
const results=[],errors=[];
for(const t of trades){try{const symbol=t.symbol||t.ticker;const start=new Date(t.entryFilledAt).toISOString(),end=new Date(t.finalExitAt).toISOString();let raw;if(t.assetClass==='CRYPTO'){const s=String(symbol).includes('/')?symbol:`${symbol}/USD`;const q=new URLSearchParams({symbols:s,timeframe:'1Min',start,end,limit:'10000'});raw=await loadReplayBars(get,`https://data.alpaca.markets/v1beta3/crypto/us/bars?${q}`,s);const r=calc(t,raw);if(!r)throw new Error('REPLAY_NO_VALID_BARS_OR_RISK');results.push({journalId:t.journalId,assetClass:'CRYPTO',symbol:s,setupType:t.setupType||'UNKNOWN',entryFilledAt:t.entryFilledAt,finalExitAt:t.finalExitAt,...r});}else{const q=new URLSearchParams({symbols:symbol,timeframe:'1Min',start,end,limit:'10000',feed:'iex'});raw=await loadReplayBars(get,`https://data.alpaca.markets/v2/stocks/bars?${q}`,symbol);const r=calc(t,raw);if(!r)throw new Error('REPLAY_NO_VALID_BARS_OR_RISK');results.push({journalId:t.journalId,assetClass:'STOCK',symbol,setupType:t.setupType||'UNKNOWN',entryFilledAt:t.entryFilledAt,finalExitAt:t.finalExitAt,...r});}}catch(e){errors.push(`${t.journalId||t.symbol}: ${e.message}`);}}
const avg=a=>{const x=a.filter(finite).map(num);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;};
const summary={sampleSize:results.length,averageMFER:avg(results.map(x=>x.maximumFavorableExcursionR)),averageMAER:avg(results.map(x=>x.maximumAdverseExcursionR)),averageMinutesToMFE:avg(results.map(x=>x.minutesToMFE)),averageEdgeDecayMinutes:avg(results.map(x=>x.edgeDecayMinutes))};
const out={schemaVersion:1,generatedAt:new Date().toISOString(),source:'ALPACA_1M_REPLAY_OF_ROBINHOOD_CONFIRMED_TRADES',status:errors.length||!results.length?'DEGRADED':'OK',coverage:{requestedTrades:trades.length,replayedTrades:results.length,unreplayedTrades:trades.length-results.length},errors,summary,trades:results,authority:'RESEARCH_ONLY',rules:['Only Robinhood-confirmed resolved trades are replayed.','Historical Alpaca bars estimate path-dependent MAE/MFE and alternative exits; they do not rewrite real broker fills or PnL.','Replay may improve stops, targets, time exits and ranking only after sufficient out-of-sample evidence.','Never promote a strategy from replay alone without forward/shadow validation.']};
await write('docs/data/trade-replay.json',out);
console.log(`Trade replay: ${results.length}/${trades.length} resolved trades replayed; errors=${errors.length}`);
