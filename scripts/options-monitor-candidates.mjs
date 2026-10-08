// Pure, testable enforcement of probability-first-policy.json's options.seedLane -- the named
// options execution lane added 2026-09-25. This module decides whether a specific candidate
// contract WOULD be executable; it does not itself call Robinhood or the dispatch builder.
// Kept separate so the gate logic can be unit tested without live data, same split as
// crypto-monitor-candidates.mjs / test-crypto-monitoring.mjs.
//
// build-execution-dispatch.mjs evaluates independently qualified option candidates from the fresh options scan.
// Live option risk normally requires earned admission. An explicit user-authorized cash-only bootstrap may allow SHADOW_ONLY candidates, but LIVE_SUSPENDED always remains blocked and every live Robinhood guard still applies.

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
  const requiredDteBucket=seedPolicy.requiredDteBucket||'STANDARD';
  const allowedDteBuckets=Array.isArray(seedPolicy.allowedDteBuckets)&&seedPolicy.allowedDteBuckets.length
    ? seedPolicy.allowedDteBuckets
    : requiredDteBucket==='STANDARD_OR_WEEKLY'
      ? ['STANDARD','WEEKLY']
      : [requiredDteBucket];
  if(candidate&&!allowedDteBuckets.includes(candidate.dteBucket)){
    return {status:'BLOCKED_DTE_NOT_STANDARD',reason:`Candidate dteBucket is ${candidate.dteBucket}; lane permits ${allowedDteBuckets.join('/')}.`};
  }
  const bootstrapStates=Array.isArray(seedPolicy.bootstrapAllowedAdmissionStates)&&seedPolicy.bootstrapAllowedAdmissionStates.length
    ? seedPolicy.bootstrapAllowedAdmissionStates
    : ['SHADOW_ONLY'];
  const bootstrapAllowed=seedPolicy.userAuthorizedLiveCashBootstrap===true&&bootstrapStates.includes(admissionState);
  if(admissionState==='LIVE_SUSPENDED'){
    return {status:'BLOCKED_ADMISSION',reason:'Options profitability admission state is LIVE_SUSPENDED; live risk is blocked even under the user-authorized cash bootstrap.',admissionState};
  }
  if(!requiredStates.includes(admissionState)&&!bootstrapAllowed){
    return {status:'BLOCKED_ADMISSION',reason:`Options profitability admission state is ${admissionState}; requires one of ${requiredStates.join('/')} or an explicitly authorized cash-only bootstrap state.`,admissionState};
  }
  if(lastLiveTradeOutcome==='LOSS'&&seedPolicy.resetGateAfterLiveLoss){
    return {status:'BLOCKED_LOSS_RESET',reason:'The last live options trade was a loss; the gate requires a fresh independent positive shadow sample before the next live entry, not just staying above the admission threshold.'};
  }
  if(!candidate){
    return {status:'NO_CANDIDATE',reason:'No qualifying contract from the current scan.'};
  }
  const allowedTypes=seedPolicy.allowedUnderlyingTypes||['INDEX_ETF'];
  if(!allowedTypes.includes(candidate.underlyingType)){
    return {status:'BLOCKED_UNDERLYING_TYPE',reason:`Candidate underlyingType is ${candidate.underlyingType}; this lane is currently restricted to ${allowedTypes.join('/')} only.`};
  }
  const allowedKinds=seedPolicy.allowedKinds||[seedPolicy.kind||'LONG_CALL'];
  if(!allowedKinds.includes(candidate.kind)){
    return {status:'BLOCKED_OPTION_KIND',reason:`Candidate kind is ${candidate.kind}; lane permits ${allowedKinds.join('/')}.`};
  }
  const rawMaxOrderUsd=seedPolicy.maxOrderUsd;
  const maxOrderUsd=rawMaxOrderUsd===null||rawMaxOrderUsd===undefined?null:Number(rawMaxOrderUsd);
  const hasFixedPremiumCap=Number.isFinite(maxOrderUsd)&&maxOrderUsd>0;
  const premium=Number(candidate.oneContractPremiumDollars||0);
  if(!(premium>0)){
    return {status:'BLOCKED_PREMIUM_CAP',reason:'One-contract premium is missing or invalid.'};
  }
  if(hasFixedPremiumCap&&premium>maxOrderUsd){
    return {status:'BLOCKED_PREMIUM_CAP',reason:`One-contract premium ${premium} exceeds the ${maxOrderUsd} lane ceiling.`};
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
    reason:`Candidate clears every repository seed-lane gate: ${bootstrapAllowed?'user-authorized SHADOW_ONLY cash bootstrap':'earned admission'}, DTE bucket, underlying type, position limit and weekly cap. There is ${hasFixedPremiumCap?`a fixed ${maxOrderUsd} repository cap`:'no fixed repository premium cap'}; live Robinhood quote freshness, <=10% spread, real volume/open interest, tradability, whole-contract cash/unleveraged buying power, duplicate-order and session checks remain mandatory immediately before submission.`,
    admissionState,
    seedLane:{
      maxOrderUsd:hasFixedPremiumCap?maxOrderUsd:null,
      affordabilityMode:hasFixedPremiumCap?'FIXED_PREMIUM_CAP':'LIVE_UNLEVERAGED_CASH',
      userAuthorizedLiveCashBootstrap:bootstrapAllowed,
      kind:candidate.kind,
      targetMultiplier:seedPolicy.targetMultiplier,
      stopMultiplier:seedPolicy.stopMultiplier,
      breakEvenArmMultiplier:seedPolicy.breakEvenArmMultiplier,
      firstLockArmMultiplier:seedPolicy.firstLockArmMultiplier,
      firstLockFloorMultiplier:seedPolicy.firstLockFloorMultiplier,
      trailArmMultiplier:seedPolicy.trailArmMultiplier,
      trailFraction:seedPolicy.trailFraction,
      mustBeFlatBeforeMarketClose:seedPolicy.mustBeFlatBeforeMarketClose===true,
      forcedExitMinutesBeforeClose:seedPolicy.forcedExitMinutesBeforeClose,
      existingRobinhoodCashOnly:true,
      marginAllowed:false,
    },
  };
}
