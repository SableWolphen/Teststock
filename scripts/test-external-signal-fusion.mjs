import test from 'node:test';
import assert from 'node:assert/strict';
import {fuseResearchSignals} from './external-signal-fusion.mjs';
const now=Date.parse('2026-10-15T18:00:00Z');
const signal=(overrides={})=>({source:'edgar',symbol:'AAPL',kind:'filing',observedAt:'2026-10-15T17:59:00Z',score:0.5,verified:true,...overrides});
test('never authorizes orders',()=>{const r=fuseResearchSignals([signal()],{now});assert.equal(r.orderAuthorization,false);assert.equal(r.mode,'RESEARCH_ONLY')});
test('rejects stale, future, unverified and invalid scores',()=>{const r=fuseResearchSignals([signal({observedAt:'2026-10-14T00:00:00Z'}),signal({source:'fred',observedAt:'2026-10-16T00:00:00Z'}),signal({source:'news',verified:false}),signal({source:'prices',score:Infinity})],{now});assert.equal(r.rankings.length,0);assert.equal(r.rejected.length,4)});
test('ranks independent verified research sources without duplicate inflation',()=>{const r=fuseResearchSignals([signal(),signal(),signal({source:'fred',score:0.1}),signal({source:'news',symbol:'MSFT',score:0.8})],{now});assert.equal(r.rankings[0].symbol,'MSFT');assert.equal(r.rankings[1].sourceCount,2);assert.equal(r.rejected[0].reason,'DUPLICATE_SOURCE')});
