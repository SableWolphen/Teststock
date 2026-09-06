import test from 'node:test';
import assert from 'node:assert/strict';
import {ageMinutes,entryState,loopState,stockState} from '../docs/desk.mjs';
const now=Date.parse('2026-09-08T15:00:00Z'),stamp=new Date(now).toISOString();
test('expired snapshots cannot present a trigger as ready',()=>{
 const event={assetClass:'CRYPTO',trigger:'BUY_TRIGGER',stateChangedAt:stamp};
 assert.match(entryState(event,{board:{publishedAt:'2020-01-01'},health:{generatedAt:stamp,newRiskPermission:'ALLOWED'}},now),/stale/);
 assert.equal(ageMinutes(null,now),Infinity);
 assert.equal(ageMinutes('2099-01-01',now),Infinity);
});
test('a successful verification job never implies a live loop',()=>{
 assert.equal(loopState({status:'completed',conclusion:'success'},[{name:'live',steps:[{name:'Run 45-second intraday decision loop',conclusion:'skipped'}]}]).label,'Verification only');
 assert.equal(loopState({status:'in_progress'},[{name:'live',status:'in_progress',steps:[{name:'Run 45-second intraday decision loop',status:'in_progress'}]}]).label,'Loop running');
});
test('calendar evidence and entry cutoff are distinct from open hours',()=>{
 assert.equal(stockState({publishedAt:stamp,marketSession:{calendarAvailable:false}},now),'Session unverified');
 assert.equal(stockState({publishedAt:stamp,marketSession:{calendarAvailable:true,regularSession:true,entryAllowed:false}},now),'Exits / entry cutoff');
});
test('fresh trigger still requires broker checks and stock entry window',()=>{
 const data={board:{publishedAt:stamp,monitorHealth:'OK',marketSession:{entryAllowed:false}},health:{generatedAt:stamp,newRiskPermission:'ALLOWED'}};
 assert.match(entryState({assetClass:'STOCK',trigger:'BUY_TRIGGER',stateChangedAt:stamp},data,now),/not verified open/);
 assert.equal(entryState({assetClass:'CRYPTO',trigger:'BUY_TRIGGER',stateChangedAt:stamp},data,now),'Live broker checks required');
});
