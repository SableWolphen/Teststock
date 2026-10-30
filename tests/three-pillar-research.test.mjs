import test from 'node:test';import assert from 'node:assert/strict';import {ema,rsi,scoreResearch} from '../scripts/three-pillar-research.mjs';
test('rejects missing history without generating trade',()=>{const x=scoreResearch({symbol:'ABC',closes:[1,2]});assert.equal(x.executionEligible,false);assert.equal(x.status,'INSUFFICIENT_DATA');});
test('valid scores remain research-only',()=>{const closes=Array.from({length:220},(_,i)=>100+i*.2);const x=scoreResearch({symbol:'ABC',closes,macroScore:1,asOf:'2026-10-27'});assert.equal(x.executionEligible,false);assert.equal(x.decision,'WATCH');assert.equal(x.scores.total,5);});
test('missing macro fails closed',()=>{const x=scoreResearch({closes:Array.from({length:220},(_,i)=>100+i),asOf:'2026-10-27'});assert.equal(x.status,'INCOMPLETE');assert.equal(x.scores.total,null);});
test('indicators handle insufficient data',()=>{assert.equal(ema([1,2],3),null);assert.equal(rsi([1,2]),null);});
