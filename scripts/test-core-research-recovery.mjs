import test from 'node:test';
import assert from 'node:assert/strict';
import {coreResearchRecovery} from './core-research-recovery.mjs';
const now=Date.parse('2026-10-19T15:00:00Z');
const packet={mode:'RESEARCH_ONLY',liveOrdersEnabled:false,generatedAt:new Date(now-60000).toISOString(),expiresAt:new Date(now+240000).toISOString(),diagnostics:{scope:{name:'CURRENT_ACCESS_CORE'}}};
const run=patch=>coreResearchRecovery({now,control:{enabled:true},packet,runs:[],...patch});
test('expired or missing core research is recovered without treating it as a live signal',()=>{
 assert.equal(run().dispatch,false);
 for(const p of [null,{...packet,expiresAt:new Date(now).toISOString()},{...packet,generatedAt:new Date(now+1000).toISOString()},{...packet,liveOrdersEnabled:true},{...packet,diagnostics:{scope:{name:'BROAD'}}}])assert.equal(run({packet:p}).dispatch,true);
});
test('disabled or malformed controls and in-flight research never create another run',()=>{
 for(const control of [null,{}, {enabled:false},{enabled:'true'}])assert.equal(run({control}).dispatch,false);
 for(const status of ['queued','in_progress','waiting','requested','pending'])assert.equal(run({packet:null,runs:[{status}]}).dispatch,false);
 assert.equal(run({packet:null,runs:null}).dispatch,false);
 assert.equal(run({packet:null,now:NaN}).dispatch,false);
});
test('recovery respects the existing research window and cannot trust arbitrarily long packet expiry',()=>{
 assert.equal(run({now:Date.parse('2026-10-19T03:00:00Z'),packet:null}).dispatch,false);
 assert.equal(run({now:Date.parse('2026-10-18T15:00:00Z'),packet:null}).dispatch,false);
 assert.equal(run({packet:{...packet,expiresAt:new Date(now+86400000).toISOString()}}).dispatch,true);
});
