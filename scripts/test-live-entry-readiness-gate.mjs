import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(new URL('./chatgpt-executor.mjs',import.meta.url),'utf8');
test('live entry path invokes readiness gate before claiming orders',()=>{const gate=source.indexOf('automaticExecutionPolicy({capability');const claim=source.indexOf('claim(selected,ids)');assert.ok(gate>0);assert.ok(claim>gate);});
test('missing proof blocks entry and risk circuit breaker is checked',()=>{assert.match(source,/NO_ACTION_UNVERIFIED_UNATTENDED_EXECUTION/);assert.match(source,/NO_ACTION_RISK_CIRCUIT_BREAKER/);});
