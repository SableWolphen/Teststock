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
    fs.writeFile(path.join(data,'executor-capabilities.json'),JSON.stringify({verifiedAt:new Date(now).toISOString(),liveOrderSubmission:true,liveEquityEntrySubmission:true,liveEquityExitSubmission:true,liveOptionEntrySubmission:true,liveOptionExitSubmission:true,liveOptionExitVerifiedThisSession:true})),
  ]);
  await exec(process.execPath,[builder,boardPath,signalPath,outPath],{cwd:dir});
  await exec(process.execPath,[validator,outPath],{cwd:dir});
  return JSON.parse(await fs.readFile(outPath,'utf8'));
}

test('legacy LIVE_MICRO_BOOTSTRAP flags cannot publish an execution request',async()=>{
  const out=await fixture();
  assert.equal(out.chatgptShouldRun,false);
  assert.equal(out.executionNeeded,false);
  assert.equal(out.indexOptionsLane.resolutionRequestPublished,false);
  assert.deepEqual(out.indexOptionResolutionRequests,[]);
});

test('stale index research cannot wake live bootstrap execution',async()=>{
  const out=await fixture({stale:true});
  assert.equal(out.indexOptionsLane.researchFresh,false);
  assert.equal(out.indexOptionResolutionRequests.length,0);
  assert.equal(out.chatgptShouldRun,false);
});
