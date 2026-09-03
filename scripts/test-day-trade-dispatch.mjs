import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';

const exec=promisify(execFile);
const script=new URL('./build-execution-dispatch.mjs',import.meta.url).pathname.replace(/^\/(.:)/,'$1');
const validator=new URL('./validate-execution-dispatch.mjs',import.meta.url).pathname.replace(/^\/(.:)/,'$1');
const signal={stockPlan:{policy:{maxConcurrentNewPositions:1}}};
const lane={eligible:true,maxOrderUsd:20,maxConcurrentPositions:1,maxNewPositionsPerUtcDay:1,requiresPerOrderApproval:false,requiresBrokerResidentStop:true,existingRobinhoodCashOnly:true,agentMayInitiateDeposits:false,agentMayInitiateBankTransfers:false,marginAllowed:false,mustBeFlatBeforeMarketClose:true,entryCutoffMinutesBeforeClose:30,forcedExitStartMinutesBeforeClose:15};

async function build(events,dir=null){
  dir=dir||await fs.mkdtemp(path.join(os.tmpdir(),'teststock-day-dispatch-'));
  const boardPath=path.join(dir,'board.json'),signalPath=path.join(dir,'signal.json'),outPath=path.join(dir,'out.json');
  await fs.writeFile(boardPath,JSON.stringify({publishedAt:new Date().toISOString(),monitorHealth:'OK',events}));
  await fs.writeFile(signalPath,JSON.stringify(signal));
  await exec(process.execPath,[script,boardPath,signalPath,outPath]);
  await exec(process.execPath,[validator,outPath]);
  return {out:JSON.parse(await fs.readFile(outPath,'utf8')),dir};
}

test('promotes a same-day seed candidate with exact bounds',async()=>{
  const now=new Date().toISOString();
  const {out}=await build([{id:'ENTRY:STOCK:TEST',assetClass:'STOCK',ticker:'TEST',trigger:'STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER',stateChangedAt:now,dayTradeSeedLane:lane,observedPrice:10,minimumEntry:9,maximumEntry:11,stop:8,target1:12,target2:13}]);
  assert.equal(out.claudeShouldRun,true);assert.equal(out.seedLaneCandidates.length,1);assert.equal(out.seedLaneCandidates[0].maxOrderUsd,20);assert.equal(out.seedLaneCandidates[0].mustBeFlatBeforeMarketClose,true);
});

test('forced same-day exit blocks all new buys and remains highest priority',async()=>{
  const now=new Date().toISOString();
  const {out}=await build([{id:'POSITION:STOCK:TEST',assetClass:'STOCK',ticker:'TEST',trigger:'STOCK_DAY_TRADE_FORCED_EXIT',stateChangedAt:now,dayTradeSeedLane:true,observedPrice:10},{id:'ENTRY:STOCK:OTHER',assetClass:'STOCK',ticker:'OTHER',trigger:'STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER',stateChangedAt:now,dayTradeSeedLane:lane,observedPrice:10}]);
  assert.equal(out.pendingAction.trigger,'STOCK_DAY_TRADE_FORCED_EXIT');assert.equal(out.pendingAction.priority,100);assert.equal(out.seedLaneCandidates.length,0);assert.equal(out.automaticStockCandidates.length,0);
});

test('forced exit gets a new claim on a later published board until flat',async()=>{
  const event={id:'POSITION:STOCK:TEST',assetClass:'STOCK',ticker:'TEST',trigger:'STOCK_DAY_TRADE_FORCED_EXIT',stateChangedAt:'2026-09-03T19:45:00Z',dayTradeSeedLane:true,observedPrice:10};
  const first=await build([event]);
  await new Promise(resolve=>setTimeout(resolve,20));
  const second=await build([event],first.dir);
  assert.notEqual(second.out.pendingAction.fingerprint,first.out.pendingAction.fingerprint);
});
