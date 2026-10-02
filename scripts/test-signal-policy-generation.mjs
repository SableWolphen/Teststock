import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('generated probability policy satisfies existing validation floors',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'policy-generation-'));
  try{fs.mkdirSync(path.join(dir,'docs/data'),{recursive:true});
    const r=spawnSync(process.execPath,[path.resolve('scripts/apply-probability-first-guards.mjs')],{cwd:dir,encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    const p=JSON.parse(fs.readFileSync(path.join(dir,'docs/data/probability-first-policy.json')));
    assert.ok(p.stocks.minHistoricalSamples>=12);assert.ok(p.stocks.minCostAdjustedConservativeExpectedR>=.35);
    assert.equal(p.stocks.bestAcceptable.sizeMultiplier,.25);assert.equal(p.stocks.dayTradeSeedLane.marginAllowed,false);
  }finally{fs.rmSync(dir,{recursive:true});}
});
test('fresh validation reuse does not manufacture a new research timestamp',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'holdout-refresh-'));
  try{fs.mkdirSync(path.join(dir,'docs/data'),{recursive:true});const file=path.join(dir,'docs/data/entry-gate-validation.json');
    const before=JSON.stringify({generatedAt:new Date().toISOString(),status:'RED_FLAG'});fs.writeFileSync(file,before);
    const r=spawnSync(process.execPath,[path.resolve('scripts/refresh-entry-validation-if-stale.mjs')],{cwd:dir,encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);assert.equal(fs.readFileSync(file,'utf8'),before);
  }finally{fs.rmSync(dir,{recursive:true});}
});
