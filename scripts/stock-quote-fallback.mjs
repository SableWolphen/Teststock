import {alpacaVault,AlpacaDataReader} from './alpaca-data-client.mjs';
const fresh=(q,now)=>{
 const bid=Number(q?.bid),ask=Number(q?.ask),bAge=now-Date.parse(q?.bidAt),aAge=now-Date.parse(q?.askAt);
 return Number.isFinite(bid)&&bid>0&&Number.isFinite(ask)&&ask>=bid&&[bAge,aAge].every(age=>Number.isFinite(age)&&age>=-2000&&age<=30000);
};
export async function selectStockQuotes({symbols,primary,secondary,now}={}) {
 if(!Array.isArray(symbols)||symbols.length>20||symbols.some(s=>! /^[A-Z][A-Z0-9.-]{0,14}$/.test(s)))throw Error('INVALID_SYMBOLS');
 const selected=new Map(),attempts=[];
 for(const [source,read] of [['ROBINHOOD',primary],['ALPACA_IEX',secondary]]) {
  const needed=[...new Set(symbols)].filter(s=>!selected.has(s));if(!needed.length)break;
  try {
   const rows=await read(needed);if(!Array.isArray(rows))throw Error();
   for(const symbol of needed) {
    const matches=rows.filter(q=>q?.symbol===symbol);
    if(matches.length===1&&fresh(matches[0],now??Date.now()))selected.set(symbol,{...matches[0],source,quoteOnly:true});
   }
   attempts.push({source,status:'READ_COMPLETED'});
  }catch {attempts.push({source,status:'UNAVAILABLE'});}
 }
 const missing=[...new Set(symbols)].filter(s=>!selected.has(s));
 return {quotes:[...selected.values()],attempts,missing,complete:missing.length===0&&symbols.length>0,executionAuthorized:false,note:'Monitoring quotes only. IEX is one exchange; quotes do not replace intraday bars, broker reconciliation or order validation.'};
}
export async function readAlpacaQuotes(root,symbols) {
 const reader=new AlpacaDataReader({credentials:alpacaVault(root).load()});
 const raw=await reader.read('quotes',{symbols:symbols.join(','),feed:'iex'});
 return Object.entries(raw.quotes||{}).map(([symbol,q])=>({symbol,bid:q.bp,ask:q.ap,bidAt:q.t,askAt:q.t}));
}
