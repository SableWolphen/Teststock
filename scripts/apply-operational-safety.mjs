import fs from 'node:fs/promises';

const signalFile='docs/signal.json';
const signal=JSON.parse(await fs.readFile(signalFile,'utf8'));
const stockOrders=signal.stockPlan?.stockOrders||[];

signal.liveTradeStatePolicy={
  enabled:true,
  sourceOfTruth:'ROBINHOOD_RUNTIME_ONLY',
  publicDashboardIsPlanningOnly:true,
  fields:['ticker','liveQuantity','averageEntry','currentPrice','protectionMode','brokerProtectionVerified','syntheticMonitorHealthy','target1Completed','target2Completed','runnerPct','nextAction','lastBrokerReconciledAt'],
  instructions:'Never infer live holdings from Teststock planning data. Claude must populate/report live state only from confirmed Robinhood balances, positions, orders and fills. If live state is unknown or contradictory, open no new risk.'
};

signal.portfolioHeatPolicy={
  enabled:true,
  maxConcurrentPositions:4,
  measures:['deployedCashPct','plannedStopRiskPctOfEquity','largestCorrelationClusterExposurePct','syntheticOnlyExposurePct','unprotectedExposurePct'],
  hardRules:{
    unprotectedExposurePctMax:0,
    syntheticOnlyNewExposureRequiresHealthyMonitor:true,
    correlationGuardRequired:true,
    accountLevelStopRiskUsesSmallestApplicableTierCap:true
  },
  instructions:'Portfolio heat is calculated from live Robinhood positions plus saved Teststock invalidations. Missing live quantities/prices means UNKNOWN and blocks new entries. Never hide correlated or synthetic exposure by treating each ticker independently.'
};

signal.signalDriftPolicy={
  enabled:true,
  reference:'CURRENT_SIGNAL_ENTRY_RANGE_AND_EXPECTANCY',
  maxPriceDriftPctFromSignalReferenceBeforeRevalidation:1.0,
  maxFractionOfEntryToStopDistanceConsumed:0.25,
  action:'REVALIDATE_OR_SKIP',
  instructions:'Immediately before a buy compare the live executable price with the fresh signal reference. Even inside maximumEntry, revalidate or skip when drift exceeds 1% or consumes more than 25% of the original entry-to-stop distance. Never widen the stop or chase to preserve a trade.'
};

signal.automationKillSwitch={
  enabled:true,
  modeOnFailure:'MANAGE_EXITS_ONLY',
  triggers:[
    'latest Teststock workflow failed/cancelled/timed out or signal is stale',
    'Robinhood balances, positions, orders or fills are contradictory/unknown',
    'required broker protection disappears or cannot be verified',
    'synthetic monitor misses its required heartbeat',
    'fractional-only position is unprotected during regular session',
    'critical probability/holdout/correlation/exit-policy dependency is stale or unavailable',
    'real execution slippage/protection reliability crosses encoded live brakes'
  ],
  resetRule:'Only resume new entries after the triggering condition is positively verified healthy. Time passing alone does not clear the kill switch.',
  instructions:'Kill switch never liquidates blindly. Manage existing exits using the safest supported path, but open no new positions until the fault is resolved.'
};

signal.smallAccountAccessPolicy={
  enabled:true,
  objective:'PRESERVE_ACCESS_TO_THE_BEST_QUALIFIED_SETUP_WITHOUT_FORCING_CHEAP_STOCKS',
  fractionalSharesAllowed:true,
  wholeShareIsTieBreakerOnly:true,
  rankingPrecedence:['eligibility','probability/expectancy','growthQuality','rewardRisk','executionQuality','correlation/portfolio fit','whole-share protectability tie-breaker'],
  tieDefinition:{
    maxPortfolioOpportunityScoreDifference:3,
    maxCostAdjustedConservativeExpectedRDifference:0.10,
    bothMustAlreadyPassAllEntryGates:true
  },
  instructions:'A cheaper whole-share stock may not replace a materially stronger fractional candidate merely because it is cheaper. Whole-share protectability is only a late tie-breaker between already-qualified, genuinely comparable candidates. Fractional access remains important for small accounts.'
};

signal.fractionalProtectionPolicy={...(signal.fractionalProtectionPolicy||{}),
  preferredArchitecture:'WHOLE_SHARE_TIE_BREAKER_WHEN_GENUINELY_COMPARABLE',
  wholeShareTieBreaker:{
    enabled:true,
    rule:'Only after eligibility and opportunity quality are effectively tied, prefer the candidate whose live allowed allocation can purchase at least 1 whole share so broker-resident protection may be available.',
    maxPortfolioOpportunityScoreDifference:3,
    maxCostAdjustedConservativeExpectedRDifference:0.10,
    qualityMayNotBeSacrificed:true,
    mayNotLoosenEntryGates:true,
    mayNotOverrideHigherExpectedEdge:true,
    runtimeCheckRequired:true
  },
  fractionalOnlyFallback:{
    allowedOnlyWithVerifiedFastMonitor:true,
    maximumMonitorIntervalMinutes:5,
    preferredMonitorIntervalMinutes:1,
    maximumPlannedStopRiskPctOfLiveEquity:0.75,
    ifNoFastMonitor:'SKIP_NEW_FRACTIONAL_ENTRY',
    ifMonitorFailsWhileOpen:'MANAGE_EXIT_OR_REDUCE_SYNTHETIC_EXPOSURE; NO_NEW_RISK',
    note:'A synthetic stop cannot guarantee the planned stop price and is not equivalent to a broker-resident order.'
  },
  existingFractionalPositionEmergencyPlan:{
    actionAtOrBelowInvalidation:'SUBMIT_SUPPORTED_FRACTIONAL_MARKET_SELL_IMMEDIATELY_WHEN_DETECTED_AND_PERMITTED',
    requireFillVerification:true,
    noRepeatedUnsupportedTriggerAttempts:true
  }
};

delete signal.fractionalProtectionPolicy.wholeShareFirst;

for(const order of stockOrders){
  const entry=Number(order.minimumEntry||order.entry||0),stop=Number(order.stop||0);
  const riskDistancePct=entry>stop?((entry-stop)/entry)*100:null;
  order.operationalSafety={
    signalReferencePrice:entry||null,
    entryToStopDistancePct:riskDistancePct==null?null:Number(riskDistancePct.toFixed(3)),
    wholeShareRuntimeCheckRequired:true,
    wholeShareProtectabilityIsTieBreakerOnly:true,
    smallAccountAccessPolicyRef:'signal.smallAccountAccessPolicy',
    signalDriftPolicyRef:'signal.signalDriftPolicy',
    portfolioHeatPolicyRef:'signal.portfolioHeatPolicy',
    killSwitchRef:'signal.automationKillSwitch'
  };
}

signal.systemHealth={...(signal.systemHealth||{}),runtimeLiveTradeState:{status:'RUNTIME_CHECK_REQUIRED',required:true},runtimePortfolioHeat:{status:'RUNTIME_CHECK_REQUIRED',required:true},runtimeKillSwitch:{status:'RUNTIME_CHECK_REQUIRED',required:true}};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),liveTradeStatePolicy:true,portfolioHeatPolicy:true,signalDriftPolicy:true,automationKillSwitch:true,wholeShareTieBreaker:true,smallAccountAccessPolicy:true}};
signal.schemaVersion=Math.max(26,Number(signal.schemaVersion||0));
await fs.writeFile(signalFile,JSON.stringify(signal,null,2));
await fs.writeFile('docs/data/claude-signal.json',JSON.stringify(signal,null,2));
console.log('Applied operational safety: live-state, portfolio heat, signal drift, kill switch, small-account access, whole-share tie-breaker protection.');
