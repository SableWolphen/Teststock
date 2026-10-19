import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {watchdog} from './monitor-watchdog.mjs';
const now=Date.parse('2026-10-16T14:00:00Z');
const healthy={at:new Date(now).toISOString(),health:'READ_ONLY_HEALTHY',brokerConnected:true,entryData:{connected:true,verifiedAt:new Date(now).toISOString()},reconciliation:{at:new Date(now).toISOString(),allAssetReconciliationComplete:true},liveEnabled:false,tradingReady:false};
function root(t){const r=fs.mkdtempSync(path.join(os.tmpdir(),'watchdog-test-'));t.after(()=>fs.rmSync(r,{recursive:true,force:true}));return r;}
const save=(r,s)=>fs.writeFileSync(path.join(r,'status.json'),JSON.stringify(s));
test('independent watchdog detects stale monitoring, persists deduplication across process restart and records recovery',t=>{
 const r=root(t);save(r,{...healthy,at:'2020-01-01'});assert.ok(watchdog(r,{now}).activeCodes.includes('MONITOR_HEARTBEAT_STALE_OR_MISSING'));
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {watchdog} from './scripts/monitor-watchdog.mjs';console.log(JSON.stringify(watchdog(process.argv[1],{now:${now}})))`,r],{encoding:'utf8'});
 assert.equal(child.status,0);assert.equal(JSON.parse(child.stdout).localEventsWritten,0);
 save(r,healthy);assert.equal(watchdog(r,{now}).localEventsWritten,1);assert.match(fs.readFileSync(path.join(r,'alerts.jsonl'),'utf8'),/RECOVERED/);
});
test('authentication/data failure and missing reconciliation generate local incidents without secrets',t=>{
 const r=root(t);save(r,{...healthy,brokerConnected:false,entryData:{connected:false,error:'SECRET'},reconciliation:{allAssetReconciliationComplete:false}});
 const report=watchdog(r,{now});assert.equal(report.activeCodes.length,3);assert.equal(report.userReceiptVerified,false);assert.doesNotMatch(fs.readFileSync(path.join(r,'alerts.jsonl'),'utf8'),/SECRET/);
});
test('missing heartbeat, STOP, future timestamps and unexpected live state cannot appear healthy',t=>{
 const r=root(t);assert.ok(watchdog(r,{now}).activeCodes.length);save(r,{...healthy,at:new Date(now+60000).toISOString(),liveEnabled:true});fs.writeFileSync(path.join(r,'STOP'),'');
 const codes=watchdog(r,{now}).activeCodes;for(const code of ['MONITOR_HEARTBEAT_STALE_OR_MISSING','UNEXPECTED_LIVE_STATE','MONITOR_STOP_REQUESTED'])assert.ok(codes.includes(code));
});
test('an overlapping watchdog fails without deleting another worker lock',t=>{const r=root(t);const owner=JSON.stringify({pid:process.pid});fs.writeFileSync(path.join(r,'watchdog.lock'),owner);assert.throws(()=>watchdog(r,{now}),/MONITOR_LOCKED/);assert.equal(fs.readFileSync(path.join(r,'watchdog.lock'),'utf8'),owner);});

// A terminated scheduled run must not permanently disable independent alerts.
test('watchdog recovers a proven dead process lock without clearing incidents',t=>{
 const r=root(t);save(r,healthy);
 const child=spawnSync(process.execPath,['-e',`require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}));`,path.join(r,'watchdog.lock')]);
 assert.equal(child.status,0);assert.equal(watchdog(r,{now}).activeCodes.length,0);
 assert.ok(fs.readdirSync(r).some(n=>n.startsWith('watchdog.lock.abandoned-')));
});

test('fresh heartbeat cannot hide stale broker or market data, or non-boolean success flags',t=>{
 const r=root(t);save(r,{...healthy,entryData:{connected:true,verifiedAt:'2020-01-01'},reconciliation:{...healthy.reconciliation,at:'2099-01-01'}});
 const codes=watchdog(r,{now}).activeCodes;
 assert.ok(codes.includes('BROKER_SNAPSHOT_STALE_OR_MISSING'));assert.ok(codes.includes('MARKET_DATA_STALE_OR_MISSING'));
 save(r,{...healthy,brokerConnected:'true',entryData:{connected:'true'}});
 const blocked=watchdog(r,{now}).activeCodes;assert.ok(blocked.includes('BROKER_MONITOR_BLOCKED'));assert.ok(blocked.includes('MARKET_DATA_BLOCKED'));
});
test('untrusted persisted codes never leak into local alerts',t=>{
 const r=root(t);save(r,healthy);fs.writeFileSync(path.join(r,'watchdog-status.json'),JSON.stringify({activeCodes:['SECRET']}));
 assert.ok(watchdog(r,{now}).activeCodes.includes('WATCHDOG_STATE_INVALID'));
 assert.doesNotMatch(fs.readFileSync(path.join(r,'alerts.jsonl'),'utf8'),/SECRET/);
});

test('read-only health does not suppress missing protection or expiring option incidents',t=>{
 const r=root(t);save(r,{...healthy,protection:{blockers:['HOLDING_PROTECTION_UNVERIFIED','OPTION_EXPIRATION_REVIEW_REQUIRED','CRYPTO_PROTECTION_UNVERIFIED','PRIVATE_HOLDING']}});
 const report=watchdog(r,{now});assert.equal(report.activeCodes.length,3);
 assert.ok(report.activeCodes.includes('OPTION_EXPIRATION_REVIEW_REQUIRED'));
 assert.doesNotMatch(fs.readFileSync(path.join(r,'alerts.jsonl'),'utf8'),/PRIVATE_HOLDING/);
});

test('session cutoff escalation remains deduplicated and cannot hide behind a matching protective stop',t=>{
 const r=root(t);save(r,{...healthy,protection:{matchedStopCount:1,blockers:['SESSION_EXIT_REVIEW_REQUIRED']}});
 assert.ok(watchdog(r,{now}).activeCodes.includes('SESSION_EXIT_REVIEW_REQUIRED'));
 assert.equal(watchdog(r,{now}).localEventsWritten,0);
 save(r,healthy);assert.equal(watchdog(r,{now}).localEventsWritten,1);
});
