import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow=fs.readFileSync('.github/workflows/live-intraday-runner.yml','utf8');
const helper=fs.readFileSync('scripts/check-alpaca-market-session.mjs','utf8');

test('live runner uses authoritative Alpaca market clock',()=>{
  assert.match(workflow,/scripts\/check-alpaca-market-session\.mjs/);
  assert.doesNotMatch(workflow,/TZ=America\/New_York date/);
  assert.match(helper,/paper-api\.alpaca\.markets\/v2\/clock/);
  assert.match(helper,/clock\?\.is_open===true/);
});

test('market clock fails closed without credentials or on errors',()=>{
  assert.match(helper,/API credentials are missing/);
  assert.match(helper,/process\.exit\(2\)/);
  assert.match(helper,/process\.exit\(1\)/);
});
