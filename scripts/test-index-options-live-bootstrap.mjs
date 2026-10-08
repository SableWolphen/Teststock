import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';

const exec=promisify(execFile);
const builder=new URL('./build-execution-dispatch.mjs',import.meta.url).pathname.replace(/^\/(.:)/,'$1');
const validator=new URL('./validate-execution-dispatch.mjs',import.meta.url).pathname.replace(/^\/(.:)/,'$1');

async function fixture({stale=false}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'teststock-index-live-'));
  const data=path.join(dir,'docs','data');await fs.mkdir(data,{recursive:true});
  const now=Date.now();
  const board={publishedAt:new Date(now).toISOString(),monitorHealth:'OK',marketSession:{calendarAvailable:true,regularSession:true,entryAllowed:true,minutesToClose:120},events:[]};
  const researchAt=new Date(now-(stale?30:1)*60_000).toISOString();
  const research={generatedAt:researchAt,sourceOptionsScanGeneratedAt:researchAt,candidates:[{indexSymbol:'XND',proxySymbol:'QQQ',proxyBias:'BULLISH',proxyPrice:756,proxyScore:9,researchStatus:'BROKER_SHADOW_SAMPLE_READY',brokerContractResolutionRequired:true,brokerResolution:{chainSymbol:'XND',allowedKinds:['LONG_CALL']},settlement:{cashSettled:true,exerciseStyle:'EUROPEAN',settleOnOpen:false}}]};
  const admission={state:'LIVE_MICRO_BOOTSTRAP',sizeMultiplier:.05,executionAuthorized:true};
  const policy={enabled:true,mode:'USER_AUTHORIZED_LIVE_MICRO_BOOTSTRAP',maxOrderUsd:null,affordabilityMode:'LIVE_UNLEVERAGED_CASH',maxNewPositionsPerNyDay:1,maxConcurrentPositions:1,minDte:3,maxDte:45,entryCutoffMinutesBeforeClose:45,forcedExitMinutesBeforeClose:10,mustBeFlatBeforeMarketClose:true};
  const boardPath=path.join(dir,'board.json'),signalPath=path.join(dir,'signal.json'),outPath=path.join(dir,'out.json');
  await Promise.all([
    fs.writeFile(boardPath,JSON.stringify(board)),
    fs.writeFile(signalPath,JSON.stringify({})),
    fs.writeFile(path.join(data,'index-options-research.json'),JSON.stringify(research)),
    fs.writeFile(path.join(data,'index-options-profitability-admission.json'),JSON.stringify(admission)),
    fs.writeFile(path.join(data,'index-options-live-policy.json'),JSON.stringify(policy)),
  ]);
  await exec(process.execPath,[builder,boardPath,signalPath,outPath],{cwd:dir});
  await exec(process.execPath,[validator,outPath],{cwd:dir});
  return JSON.parse(await fs.readFile(outPath,'utf8'));
}

test('LIVE_MICRO_BOOTSTRAP publishes one cash-affordable XND broker-resolution request',async()=>{
  const out=await fixture();
  assert.equal(out.chatgptShouldRun,true);
  assert.equal(out.executionNeeded,true);
  assert.equal(out.indexOptionsLane.status,'LIVE_MICRO_BOOTSTRAP');
  assert.equal(out.indexOptionsLane.resolutionRequestPublished,true);
  assert.equal(out.indexOptionResolutionRequests.length,1);
  const x=out.indexOptionResolutionRequests[0];
  assert.equal(x.ticker,'XND');
  assert.equal(x.trigger,'INDEX_OPTION_RESOLUTION_REQUEST');
  assert.equal(x.maxOrderUsd,null);
  assert.equal(x.affordabilityMode,'LIVE_UNLEVERAGED_CASH');
  assert.equal(x.maxNewPositionsPerNyDay,1);
  assert.equal(x.maxConcurrentPositions,1);
  assert.deepEqual(x.allowedKinds,['LONG_CALL']);
  assert.equal(x.brokerContractResolutionRequired,true);
});

test('stale index research cannot wake live bootstrap execution',async()=>{
  const out=await fixture({stale:true});
  assert.equal(out.indexOptionsLane.status,'STALE_RESEARCH');
  assert.equal(out.indexOptionResolutionRequests.length,0);
  assert.equal(out.chatgptShouldRun,false);
});
