import test from 'node:test';import assert from 'node:assert/strict';
import {decideTick,isKilled,sessionFor,sendAlert,dispatchFresh} from './trading-service.mjs';
const env={TESTSTOCK_RUNTIME_STATE_DIR:'/nonexistent-teststock'};
const tue=new Date('2026-10-13T15:00:00Z'); // 11:00 New York, Tuesday
test('runs during regular hours',()=>assert.equal(decideTick({now:tue,env}).run,true));
test('idle before the open',()=>assert.equal(decideTick({now:new Date('2026-10-13T12:00:00Z'),env}).state,'IDLE'));
test('idle after the close',()=>assert.equal(decideTick({now:new Date('2026-10-13T20:30:00Z'),env}).state,'IDLE'));
test('idle on weekends',()=>assert.equal(sessionFor(new Date('2026-10-17T15:00:00Z'),env).open,false));
test('holiday list closes the market',()=>assert.equal(decideTick({now:tue,env:{...env,TESTSTOCK_HOLIDAYS:'2026-10-13'}}).run,false));
test('kill env stops everything',()=>{assert.equal(isKilled({...env,TESTSTOCK_KILL:'1'}).killed,true);assert.equal(decideTick({now:tue,env:{...env,TESTSTOCK_KILL:'1'}}).state,'KILLED');});
test('repeated failures halt the service',()=>assert.equal(decideTick({now:tue,env,consecutiveFailures:3}).state,'HALTED'));
test('invalid clock halts',()=>assert.equal(decideTick({now:new Date('x'),env}).run,false));
test('fresh dispatch passes',()=>assert.equal(dispatchFresh({generatedAt:'2026-10-13T14:55:00Z'},tue).fresh,true));
test('stale dispatch is rejected',()=>assert.equal(dispatchFresh({generatedAt:'2026-10-13T14:00:00Z'},tue).fresh,false));
test('missing or future dispatch time is rejected',()=>{assert.equal(dispatchFresh({},tue).fresh,false);assert.equal(dispatchFresh({generatedAt:'2026-10-13T16:00:00Z'},tue).fresh,false);});
test('alert without webhook reports not sent',async()=>assert.equal((await sendAlert('x',env)).sent,false));
test('alert posts to webhook',async()=>{let hit;const r=await sendAlert('x',{...env,TESTSTOCK_ALERT_WEBHOOK_URL:'https://example.test/h'},async(u,o)=>{hit=[u,o.body];return {ok:true,status:200};});assert.equal(r.sent,true);assert.match(hit[1],/Teststock: x/);});
