import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {installReadOnlyBundle,MONITOR_BUNDLE_FILES} from './monitor-runtime-bundle.mjs';
const temp=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-bundle-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
test('fixed read-only bundle runs offline independently of a repository checkout',t=>{
 const root=temp(t),bundle=installReadOnlyBundle(process.cwd(),root);
 assert.equal(bundle.fileCount,10);assert.ok(!MONITOR_BUNDLE_FILES.includes('chatgpt-executor.mjs'));
 const run=spawnSync(process.execPath,[bundle.monitorRunner,'--state-dir',root,'--once'],{encoding:'utf8',cwd:os.tmpdir(),env:{...process.env,ROBINHOOD_MCP_OAUTH_TOKEN:''}});
 assert.equal(run.status,2,run.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'status.json'))).tradingReady,false);
 const audit=spawnSync(process.execPath,[bundle.protectionAudit,'--state-dir',root],{encoding:'utf8',cwd:os.tmpdir()});assert.equal(audit.status,2,audit.stderr);
 assert.equal(JSON.parse(audit.stdout).allowRealMoneyOrders,false);
});
test('same content reuses a bundle; corrupted content is refused rather than overwritten',t=>{
 const root=temp(t),bundle=installReadOnlyBundle(process.cwd(),root);
 assert.deepEqual(installReadOnlyBundle(process.cwd(),root),bundle);
 fs.appendFileSync(bundle.monitorRunner,'\n// corruption');assert.throws(()=>installReadOnlyBundle(process.cwd(),root),/INTEGRITY_FAILURE/);
});
test('bundle paths must be absolute',t=>{assert.throws(()=>installReadOnlyBundle('.',temp(t)),/ABSOLUTE/);});
