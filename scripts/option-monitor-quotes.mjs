// Exact-contract observations only. Never submits, cancels, or simulates an order.
import {unwrapRead} from './monitor-reconciliation.mjs';
export async function readOptionMarkets(client,positions,{now=()=>Date.now()}={}) {
 const ids=[...new Set(positions.filter(p=>Number(p.quantity)>0).map(p=>p.option_id))];
 const quotes=[];let complete=true;
 if(ids.some(id=>typeof id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))return {complete:false,quotes:[],requested:ids.length,blockers:['OPTION_QUOTES_UNVERIFIED']};
 for(let start=0;start<ids.length;start+=20) {
  const batch=ids.slice(start,start+20);
  try {
   const results=unwrapRead(await client.call('get_option_quotes',{instrument_ids:batch})).results;
   if(!Array.isArray(results))throw Error();
   for(const id of batch) {
    const rows=results.filter(r=>r?.quote?.instrument_id===id);
    if(rows.length!==1){complete=false;continue;}
    const q=rows[0].quote,age=now()-Date.parse(q.updated_at),bid=Number(q.bid_price),ask=Number(q.ask_price);
    const valid=Number.isFinite(age)&&age>=-2000&&age<=30000&&Number.isFinite(bid)&&bid>0&&Number.isFinite(ask)&&ask>=bid&&Number(q.bid_size)>0&&Number(q.ask_size)>0;
    if(!valid)complete=false;
    quotes.push({optionId:id,bid,ask,quoteAt:q.updated_at,validForMonitoring:valid,source:'ROBINHOOD'});
   }
  } catch {complete=false;}
 }
 return {complete,quotes,requested:ids.length,blockers:complete?[]:['OPTION_QUOTES_UNVERIFIED']};
}
