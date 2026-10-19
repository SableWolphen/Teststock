import test from 'node:test';
import assert from 'node:assert/strict';
import {readCalendarSession,sessionOutputs} from './alpaca-session-gate.mjs';
const now=new Date('2026-10-19T15:00:00Z');
const env={ALPACA_API_KEY:'test-key',ALPACA_API_SECRET:'test-secret'};
const calendar=[{date:'2026-10-19',open:'09:30',close:'16:00'}];
const read=(transport,extra={})=>readCalendarSession({env,now,transport,...extra});
test('calendar authentication, timeout and malformed data fail closed without leaking provider text',async()=>{
  for(const transport of [async()=>({ok:false,status:401}),async()=>{throw Error('test-secret')},async()=>({ok:true,json:async()=>({secret:'test-secret'})}),async()=>({ok:true,json:async()=>[{...calendar[0],open:'99:99'}]}),async()=>({ok:true,json:async()=>[{...calendar[0],date:'2026-10-18'}]})]){
    const s=await read(transport);assert.equal(s.stocks,false);assert.equal(s.entryAllowed,false);assert.equal(s.calendarAvailable,false);assert.doesNotMatch(JSON.stringify(s),/test-secret/);assert.match(sessionOutputs(s),/stocks=false/);
  }
});
test('missing credentials do not call the provider',async()=>{
  const s=await read(()=>assert.fail('must not fetch'),{env:{}});assert.equal(s.code,'ALPACA_CREDENTIALS_MISSING');
});
test('authoritative holiday is distinct from authentication failure',async()=>{
  const s=await read(async()=>({ok:true,json:async()=>[]}));assert.equal(s.stocks,false);assert.equal(s.calendarAvailable,true);assert.equal(s.code,'MARKET_CLOSED');
});
test('valid paper calendar gates regular session, premarket and early close',async()=>{
  const transport=async(url,options)=>{assert.equal(url.hostname,'paper-api.alpaca.markets');assert.equal(options.redirect,'error');assert.ok(options.signal);return{ok:true,json:async()=>calendar}};
  assert.equal((await read(transport)).entryAllowed,true);
  assert.equal((await read(transport,{now:new Date('2026-10-19T12:00:00Z')})).stocks,false);
  const early=await read(async()=>({ok:true,json:async()=>[{...calendar[0],close:'13:00'}]}),{now:new Date('2026-10-19T16:51:00Z')});
  assert.equal(early.entryAllowed,false);assert.equal(early.forcedExitDue,true);
});
