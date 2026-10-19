import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('fresh research and a green runner cannot hide the live deployment lock',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'teststock-health-'));
  try {
    await fs.mkdir(path.join(dir,'docs/data'),{recursive:true});
    const now=new Date().toISOString();
    const fixtures={
      'docs/signal.json':{generatedAt:now},
      'docs/data/trigger-board.json':{publishedAt:now,monitorHealth:'OK',events:[]},
      'docs/data/intraday-edge.json':{generatedAt:now},
      'docs/data/daytrader-intelligence.json':{generatedAt:now,circuitBreaker:{state:'NORMAL'}},
      'docs/data/trade-quality-intelligence.json':{generatedAt:now},
      'docs/data/execution-dispatch.json':{riskCreationBlockedByExecutor:false,executorCapability:{verifiedAt:now,liveOrderSubmission:true,liveEquityExitSubmission:true,liveOptionExitSubmission:true,liveOptionExitVerifiedThisSession:true}},
      'runs.json':{workflow_runs:[{status:'completed',conclusion:'success',updated_at:now}]},
    };
    for(const [name,value] of Object.entries(fixtures))await fs.writeFile(path.join(dir,name),JSON.stringify(value));
    const build=()=>{execFileSync(process.execPath,[fileURLToPath(new URL('./build-live-trading-health.mjs',import.meta.url))],{cwd:dir,env:{...process.env,TESTSTOCK_RUNNER_RUNS_FILE:path.join(dir,'runs.json'),TESTSTOCK_RUNNER_HEARTBEAT_FILE:''}});};
    build();let health=JSON.parse(await fs.readFile(path.join(dir,'docs/data/live-trading-health.json'),'utf8'));
    assert.equal(health.runner.healthy,true);assert.equal(health.newRiskPermission,'BLOCKED');assert.ok(health.reasons.includes('canonical live deployment lock'));
    await fs.writeFile(path.join(dir,'docs/data/execution-dispatch.json'),'{}');
    build();health=JSON.parse(await fs.readFile(path.join(dir,'docs/data/live-trading-health.json'),'utf8'));
    assert.ok(health.reasons.includes('broker entry / same-session exit capability unverified'));
    assert.ok(health.reasons.includes('dispatch or trigger monitor blocked'));
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
