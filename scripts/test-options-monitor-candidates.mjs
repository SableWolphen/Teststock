import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateOptionsSeedLaneCandidate} from './options-monitor-candidates.mjs';

const seedPolicy={enabled:true,maxOrderUsd:15,maxConcurrentPositions:1,maxNewPositionsPerUtcWeek:1,requiredAdmissionStates:['MICRO_PROBATION','PROBATION','LIVE_ADMITTED'],requiredDteBucket:'STANDARD',allowedUnderlyingTypes:['STOCK','INDEX_ETF'],kind:'LONG_CALL',targetMultiplier:1.5,stopMultiplier:0.6,forcedExitDaysToExpiry:3,resetGateAfterLiveLoss:true};
const goodCandidate={underlying:'SPY',underlyingType:'INDEX_ETF',dteBucket:'STANDARD',oneContractPremiumDollars:12};

test('SHADOW_ONLY with zero evidence blocks every candidate, however good it looks',()=>{
  const state=evaluateOptionsSeedLaneCandidate({candidate:goodCandidate,admission:{state:'SHADOW_ONLY'},seedPolicy});
  assert.equal(state.status,'BLOCKED_ADMISSION');
});

test('a real MICRO_PROBATION admission with a qualifying candidate fires the trigger',()=>{
  const state=evaluateOptionsSeedLaneCandidate({candidate:goodCandidate,admission:{state:'MICRO_PROBATION'},seedPolicy});
  assert.equal(state.status,'OPTION_SEED_LANE_BUY_TRIGGER');
  assert.equal(state.seedLane.maxOrderUsd,15);
});

test('LIVE_SUSPENDED never qualifies regardless of everything else',()=>{
  const state=evaluateOptionsSeedLaneCandidate({candidate:goodCandidate,admission:{state:'LIVE_SUSPENDED'},seedPolicy});
  assert.equal(state.status,'BLOCKED_ADMISSION');
});

test('0DTE and WEEKLY are never eligible, even at full admission',()=>{
  const zeroDte=evaluateOptionsSeedLaneCandidate({candidate:{...goodCandidate,dteBucket:'0DTE'},admission:{state:'LIVE_ADMITTED'},seedPolicy});
  assert.equal(zeroDte.status,'BLOCKED_DTE_NOT_STANDARD');
  const weekly=evaluateOptionsSeedLaneCandidate({candidate:{...goodCandidate,dteBucket:'WEEKLY'},admission:{state:'LIVE_ADMITTED'},seedPolicy});
  assert.equal(weekly.status,'BLOCKED_DTE_NOT_STANDARD');
});

test('qualified stock options are eligible for the live lane',()=>{
  const state=evaluateOptionsSeedLaneCandidate({candidate:{...goodCandidate,underlying:'CRWD',underlyingType:'STOCK'},admission:{state:'LIVE_ADMITTED'},seedPolicy});
  assert.equal(state.status,'OPTION_SEED_LANE_BUY_TRIGGER');
});

test('a candidate priced above the lane cap is blocked even if it qualified for the wider research scan',()=>{
  const state=evaluateOptionsSeedLaneCandidate({candidate:{...goodCandidate,oneContractPremiumDollars:34},admission:{state:'LIVE_ADMITTED'},seedPolicy});
  assert.equal(state.status,'BLOCKED_PREMIUM_CAP');
});

test('one open option position blocks a second one',()=>{
  const state=evaluateOptionsSeedLaneCandidate({candidate:goodCandidate,admission:{state:'LIVE_ADMITTED'},seedPolicy,openOptionPositions:1});
  assert.equal(state.status,'BLOCKED_POSITION_LIMIT');
});

test('the weekly new-entry cap blocks a second entry the same UTC week',()=>{
  const state=evaluateOptionsSeedLaneCandidate({candidate:goodCandidate,admission:{state:'LIVE_ADMITTED'},seedPolicy,newEntriesThisUtcWeek:1});
  assert.equal(state.status,'BLOCKED_WEEKLY_CAP');
});

test('a live loss resets the gate even while admission state stays high',()=>{
  const state=evaluateOptionsSeedLaneCandidate({candidate:goodCandidate,admission:{state:'LIVE_ADMITTED'},seedPolicy,lastLiveTradeOutcome:'LOSS'});
  assert.equal(state.status,'BLOCKED_LOSS_RESET');
});

test('a disabled seed lane blocks everything regardless of admission or candidate quality',()=>{
  const state=evaluateOptionsSeedLaneCandidate({candidate:goodCandidate,admission:{state:'LIVE_ADMITTED'},seedPolicy:{...seedPolicy,enabled:false}});
  assert.equal(state.status,'OPTIONS_SEED_LANE_DISABLED');
});

test('no candidate at all is a clean no-op, not an error',()=>{
  const state=evaluateOptionsSeedLaneCandidate({candidate:null,admission:{state:'LIVE_ADMITTED'},seedPolicy});
  assert.equal(state.status,'NO_CANDIDATE');
});
