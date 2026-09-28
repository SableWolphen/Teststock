import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stockExecutionPolicyFailures } from './stock-execution-policy-validation.mjs';
import { evaluateOptionsSeedLaneCandidate } from './options-monitor-candidates.mjs';

const scripts=path.dirname(fileURLToPath(import.meta.url));
const run=(cwd,name)=>spawnSync(process.execPath,[path.join(scripts,name)],{cwd,encoding:'utf8'});
const write=(cwd,file,value)=>fs.writeFile(path.join(cwd,file),JSON.stringify(value));
const read=(cwd,file)=>fs.readFile(path.join(cwd,file),'utf8').then(JSON.parse);

test('fresh stock-only policy passes the admission and broker validators without a crypto tournament',async t=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'teststock-stock-policy-'));
  t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  await fs.mkdir(path.join(cwd,'docs/data'),{recursive:true});
  await write(cwd,'docs/signal.json',{
    schemaVersion:44,autopilot:{requiresPerOrderApproval:false},
    generatorIntegrity:{traceableFeatures:{shadowFirstProfitabilityAdmission:true,evidenceFirstDayTrading:true,bTierMicroProbation:true}}
  });
  const tournament={profitabilityAdmissionPolicy:{mode:'EVIDENCE_FIRST_DAY_TRADING'},liveQueue:[],researchFinalists:[{ticker:'ABC'}]};
  await write(cwd,'docs/data/stock-tournament.json',tournament);
  const optionShadow={state:'SHADOW_ONLY',sizeMultiplier:0,executionAuthorized:false};
  await write(cwd,'docs/data/options-profitability-admission.json',optionShadow);
  for(const script of ['apply-chatgpt-unattended-execution-policy.mjs','apply-robinhood-executable-universe.mjs','validate-profitability-admission.mjs','validate-robinhood-executable-universe.mjs','validate-unattended-execution-policy.mjs','validate-chatgpt-hourly-approval-policy.mjs']){
    const result=run(cwd,script);assert.equal(result.status,0,`${script}: ${result.stderr}`);
  }
  const signal=await read(cwd,'docs/signal.json');
  assert.equal(signal.autopilot.automaticQualifiedBuys,undefined,'legacy cross-asset flag is unnecessary');
  assert.deepEqual(stockExecutionPolicyFailures(signal),[]);
  assert.deepEqual(await read(cwd,'docs/data/chatgpt-signal.json'),signal);
  assert.deepEqual(await read(cwd,'docs/data/options-profitability-admission.json'),optionShadow);
  assert.equal(evaluateOptionsSeedLaneCandidate({candidate:{underlying:'ABC'},admission:optionShadow,seedPolicy:{enabled:true}}).status,'BLOCKED_ADMISSION');

  // The legacy flag cannot compensate for a missing/disabled stock authorization,
  // weakened live guards, or a re-enabled crypto path.
  for(const [keys,value] of [
    [['autopilot','automaticQualifiedStockBuys'],undefined],
    [['autopilot','automaticQualifiedStockBuys'],false],
    [['autopilot','requiresPerOrderApproval'],true],
    [['autopilot','automaticQualifiedCryptoBuys'],true],
    [['autopilot','automaticQualifiedCryptoBuys'],undefined],
    [['autopilot','directGitHubBrokerExecution'],true],
    [['chatgptExecutionPolicy','stockBuys','requireLiveBrokerRecheck'],false],
    [['chatgptExecutionPolicy','stockBuys','requireRobinhoodTradingMcp'],false],
    [['chatgptExecutionPolicy','generationMatchRequired'],false],
    [['chatgptExecutionPolicy','brokerExecutionContract','duplicateProtectionRequired'],false],
    [['chatgptExecutionPolicy','brokerExecutionContract','neverAssumeFill'],false],
    [['chatgptExecutionPolicy','brokerExecutionContract','protectionRequiredAfterEntry'],false],
    [['executionArchitecture','crossAssetSelection'],true],
    [['executionArchitecture','tournaments','crypto','enabled'],true],
  ]){
    const broken=structuredClone(signal);broken.autopilot.automaticQualifiedBuys=true;
    const parent=keys.slice(0,-1).reduce((object,key)=>object[key],broken);
    if(value===undefined)delete parent[keys.at(-1)];else parent[keys.at(-1)]=value;
    await write(cwd,'docs/signal.json',broken);
    assert.notEqual(run(cwd,'validate-profitability-admission.mjs').status,0,keys.join('.'));
  }
  await write(cwd,'docs/signal.json',signal);
  for(const row of [
    {ticker:'ABC',entryTier:'A',adaptiveSizeMultiplier:.5,profitabilityAdmission:{state:'MICRO_PROBATION',historicalEvidenceIsDiagnosticOnly:true,sizeMultiplier:.5,shadow:{samples:100,distinctTradingDays:20,winRatePct:55,averageR:.2,profitFactor:1.4}}},
    {ticker:'ABC',action:'AUTO_BUY_ELIGIBLE',profitabilityAdmission:{state:'LIVE_SUSPENDED',historicalEvidenceIsDiagnosticOnly:true}},
    {ticker:'ABC',entryTier:'A',seedLane:{eligible:true},profitabilityAdmission:{state:'SHADOW_ONLY',historicalEvidenceIsDiagnosticOnly:true}},
  ]){
    await write(cwd,'docs/data/stock-tournament.json',{...tournament,liveQueue:[row]});
    assert.notEqual(run(cwd,'validate-profitability-admission.mjs').status,0,'unsafe profitability row must fail');
  }
});
