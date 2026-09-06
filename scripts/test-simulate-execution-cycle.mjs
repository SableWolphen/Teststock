import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateExecution} from './simulate-execution-cycle.mjs';

test('exit events take priority over buys',()=>{
  const r=simulateExecution({events:[{action:'BUY',symbol:'AAA',amount:20},{action:'TARGET1',symbol:'OLD'}]});
  assert.equal(r.status,'EXIT_ONLY'); assert.deepEqual(r.orders,[{side:'SELL',symbol:'OLD',reason:'TARGET1'}]);
});
test('qualified buys are sequenced within buying power',()=>{
  const r=simulateExecution({events:[{action:'BUY',symbol:'AAA',amount:20},{action:'BUY',symbol:'BBB',amount:20}],broker:{authenticated:true,tradable:true,buyingPower:30,spreadPct:.1}});
  assert.equal(r.status,'BUY_READY'); assert.equal(r.orders.length,2); assert.equal(r.orders[1].amount,10); assert.equal(r.orders[0].protectionRequired,true);
});
test('unsafe broker state fails closed',()=>{
  assert.equal(simulateExecution({events:[{action:'BUY',symbol:'AAA',amount:20}],broker:{authenticated:false}}).reason,'BROKER_AUTH_UNAVAILABLE');
  assert.equal(simulateExecution({events:[{action:'BUY',symbol:'AAA',amount:20}],broker:{authenticated:true,tradable:true,buyingPower:50,spreadPct:1}}).reason,'SPREAD_TOO_WIDE');
});
