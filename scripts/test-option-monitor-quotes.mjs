import test from 'node:test';
import assert from 'node:assert/strict';
import {readOptionMarkets} from './option-monitor-quotes.mjs';
const id='3e9a99b3-8654-4171-91ad-c518d26b7ce7',now=Date.now();
const quote={instrument_id:id,bid_price:'0.67',ask_price:'0.75',bid_size:1,ask_size:1,updated_at:new Date(now).toISOString()};
const client=q=>({call:async(name,args)=>{assert.equal(name,'get_option_quotes');assert.deepEqual(args.instrument_ids,[id]);return {structuredContent:{data:{results:[{quote:q}]}}}}});
test('option monitor observes exact contracts and never treats old/invalid prices as current',async()=>{
 const p=[{option_id:id,quantity:'1'}];assert.equal((await readOptionMarkets(client(quote),p,{now:()=>now})).complete,true);
 for(const patch of [{updated_at:new Date(now-30001).toISOString()},{updated_at:new Date(now+2001).toISOString()},{bid_price:'0'},{ask_price:'.5'},{bid_size:0},{instrument_id:'wrong'}])assert.equal((await readOptionMarkets(client({...quote,...patch}),p,{now:()=>now})).complete,false);
});
test('no options means no quote call; missing and duplicate results cannot verify coverage',async()=>{
 assert.equal((await readOptionMarkets({call:()=>assert.fail()},[])).complete,true);
 for(const results of [[],[{quote},{quote}]])assert.equal((await readOptionMarkets({call:async()=>({structuredContent:{data:{results}}})},[{option_id:id,quantity:1}],{now:()=>now})).complete,false);
});
