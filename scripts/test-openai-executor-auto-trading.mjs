import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const executor=fs.readFileSync('scripts/chatgpt-executor.mjs','utf8');
const prompt=fs.readFileSync('scripts/chatgpt-executor-prompt.md','utf8');

test('live executor exposes automatic stock and option buy/sell tools',()=>{
  for(const name of [
    'place_equity_order','cancel_equity_order',
    'place_option_order','cancel_option_order',
    'get_equity_orders','get_option_orders',
    'get_equity_quotes','get_option_quotes',
    'get_option_chains','get_option_instruments'
  ]) assert.match(executor,new RegExp("'"+name+"'"));
});

test('unattended executor remains explicitly gated and paper-first',()=>{
  assert.match(executor,/TESTSTOCK_EXECUTION_MODE\|\|'paper'/);
  assert.match(executor,/I_UNDERSTAND_REAL_ORDERS/);
  assert.match(executor,/require_approval:'never'/);
  assert.match(prompt,/explicitly authorized unattended automatic buys and sells/i);
  assert.match(prompt,/broker-enforced confirmation/i);
});

test('distinct client ids are reserved for primary protection and replacement orders',()=>{
  assert.match(executor,/primary:refId\(fingerprint\)/);
  assert.match(executor,/protection:refId\(fingerprint\+'\:protection'\)/);
  assert.match(executor,/replacement:refId\(fingerprint\+'\:replacement'\)/);
  assert.match(prompt,/never reuse one ref ID for two distinct broker orders/i);
});
