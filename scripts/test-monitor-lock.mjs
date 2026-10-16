import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {acquireMonitorLock} from './monitor-lock.mjs';
function root(t){const r=fs.mkdtempSync(path.join(os.tmpdir(),'lock-test-'));t.after(()=>fs.rmSync(r,{recursive:true,force:true}));return r;}
test('restart archives a proven dead process lock and acquires its own',t=>{
 const r=root(t),lock=path.join(r,'monitor.lock');
 const child=spawnSync(process.execPath,['-e',`require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid}));`,lock]);assert.equal(child.status,0);
 acquireMonitorLock(lock);assert.equal(JSON.parse(fs.readFileSync(lock)).pid,process.pid);assert.ok(fs.readdirSync(r).some(n=>n.startsWith('monitor.lock.abandoned-')));
 assert.throws(()=>acquireMonitorLock(lock),/MONITOR_LOCKED/);
});
test('invalid owners and concurrent recovery never permit lock theft',t=>{
 const lock=path.join(root(t),'monitor.lock');fs.writeFileSync(lock,'{}');assert.throws(()=>acquireMonitorLock(lock),/OWNER_UNVERIFIED/);assert.equal(fs.readFileSync(lock,'utf8'),'{}');
 fs.writeFileSync(lock+'.recovery','owned');assert.throws(()=>acquireMonitorLock(lock),/EEXIST/);assert.equal(fs.readFileSync(lock+'.recovery','utf8'),'owned');
});
