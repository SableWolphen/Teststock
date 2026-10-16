import test from 'node:test';import assert from 'node:assert/strict';import {backtest,walkForward} from './strategy-backtester.mjs';
const bars=Array.from({length:180},(_,i)=>({time:new Date(Date.UTC(2025,0,1,14,i)).toISOString(),open:100+i*.05,high:101+i*.05,low:99+i*.05,close:100+i*.05,volume:1000,vwap:99+i*.05}));
test('backtester runs with completed bars only',()=>{const r=backtest(bars,{strategyId:'opening-range-breakout'});assert.equal(r.initialCash,1000);assert.ok(Number.isFinite(r.endingCash));});
test('walk forward isolates later bars',()=>{const r=walkForward(bars,{strategyId:'vwap-pullback'});assert.equal(r.test.outOfSample,true)});
test('reject unsorted bars',()=>assert.throws(()=>backtest([...bars].reverse(),{strategyId:'mean-reversion'}),/CHRONOLOGICAL/));
