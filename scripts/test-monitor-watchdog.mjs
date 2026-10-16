import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {watchdog} from './monitor-watchdog.mjs';
const now=Date.parse('2026-10-16T14:00:00Z');
const healthy={at:new Date(now).toISOString(),health:'READ_ONLY_HEALTHY',brokerConnected:true,entryData:{connected:true},reconciliation:{allAssetReconciliationComplete:true},liveEnabled:false,tradingReady:false};
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
test('an overlapping watchdog fails without deleting another worker lock',t=>{const r=root(t);fs.writeFileSync(path.join(r,'watchdog.lock'),'owned');assert.throws(()=>watchdog(r,{now}),/EEXIST/);assert.equal(fs.readFileSync(path.join(r,'watchdog.lock'),'utf8'),'owned');});
