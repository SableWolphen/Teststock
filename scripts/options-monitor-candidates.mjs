// Pure, testable enforcement of probability-first-policy.json's options.seedLane -- the named
// options execution lane added 2026-09-25. This module decides whether a specific candidate
// contract WOULD be executable; it does not itself call Robinhood or the dispatch builder.
// Kept separate so the gate logic can be unit tested without live data, same split as
// crypto-monitor-candidates.mjs / test-crypto-monitoring.mjs.
//
// This lane is currently unwired into build-execution-dispatch.mjs -- defining and testing the
// gate here is a deliberate, separate step from making it capable of actually firing a live
// order. That wiring is a further decision, not implied by this file existing.

export function evaluateOptionsSeedLaneCandidate({
  candidate,
  admission,
  seedPolicy,
  openOptionPositions=0,
  newEntriesThisUtcWeek=0,
  lastLiveTradeOutcome=null,
}={}){
  if(!seedPolicy?.enabled){
    return {status:'OPTIONS_SEED_LANE_DISABLED',reason:'probability-first-policy.json options.seedLane is not enabled.'};
  }
  const admissionState=admission?.state||'SHADOW_ONLY';
  const requiredStates=seedPolicy.requiredAdmissionStates||['MICRO_PROBATION','PROBATION','LIVE_ADMITTED'];
  if(!requiredStates.includes(admissionState)){
    return {status:'BLOCKED_ADMISSION',reason:`Options profitability admission state is ${admissionState}; requires one of ${requiredStates.join('/')}. Zero real shadow evidence still means zero live triggers, regardless of how attractive a candidate looks today.`,admissionState};
  }
  if(lastLiveTradeOutcome==='LOSS'&&seedPolicy.resetGateAfterLiveLoss){
    return {status:'BLOCKED_LOSS_RESET',reason:'The last live options trade was a loss; the gate requires a fresh independent positive shadow sample before the next live entry, not just staying above the admission threshold.'};
  }
  if(!candidate){
    return {status:'NO_CANDIDATE',reason:'No qualifying contract from the current scan.'};
  }
  if(candidate.dteBucket!==(seedPolicy.requiredDteBucket||'STANDARD')){
    return {status:'BLOCKED_DTE_NOT_STANDARD',reason:`Candidate dteBucket is ${candidate.dteBucket}; this lane only ever considers ${seedPolicy.requiredDteBucket||'STANDARD'} contracts, at any admission state.`};
  }
  const allowedTypes=seedPolicy.allowedUnderlyingTypes||['INDEX_ETF'];
  if(!allowedTypes.includes(candidate.underlyingType)){
    return {status:'BLOCKED_UNDERLYING_TYPE',reason:`Candidate underlyingType is ${candidate.underlyingType}; this lane is currently restricted to ${allowedTypes.join('/')} only.`};
  }
  const maxOrderUsd=Number(seedPolicy.maxOrderUsd||0);
  const premium=Number(candidate.oneContractPremiumDollars||0);
  if(!(premium>0&&premium<=maxOrderUsd)){
    return {status:'BLOCKED_PREMIUM_CAP',reason:`One-contract premium $${premium} exceeds the $${maxOrderUsd} lane ceiling (or is invalid).`};
  }
  const maxConcurrent=Number(seedPolicy.maxConcurrentPositions??1);
  if(Number(openOptionPositions)>=maxConcurrent){
    return {status:'BLOCKED_POSITION_LIMIT',reason:`${openOptionPositions} option position(s) already open; lane cap is ${maxConcurrent}.`};
  }
  const maxPerWeek=Number(seedPolicy.maxNewPositionsPerUtcWeek??1);
  if(Number(newEntriesThisUtcWeek)>=maxPerWeek){
    return {status:'BLOCKED_WEEKLY_CAP',reason:`${newEntriesThisUtcWeek} new option position(s) already opened this UTC week; lane cap is ${maxPerWeek}.`};
  }
  return {
    status:'OPTION_SEED_LANE_BUY_TRIGGER',
    reason:'Candidate clears every seed-lane gate: admission state, DTE bucket, underlying type, premium cap, position limit and weekly cap. Live guard recheck (spread, quote freshness, cash, duplicate order) still required immediately before any submission.',
    admissionState,
    seedLane:{
      maxOrderUsd,
      kind:seedPolicy.kind||'LONG_CALL',
      targetMultiplier:seedPolicy.targetMultiplier,
      stopMultiplier:seedPolicy.stopMultiplier,
      forcedExitDaysToExpiry:seedPolicy.forcedExitDaysToExpiry,
      existingRobinhoodCashOnly:true,
      marginAllowed:false,
    },
  };
}
