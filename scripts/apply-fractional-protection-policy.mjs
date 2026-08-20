import fs from 'node:fs/promises';
import path from 'node:path';

const signalFile=path.resolve('docs/signal.json');
const signal=JSON.parse(await fs.readFile(signalFile,'utf8'));

signal.fractionalProtectionPolicy={
  enabled:true,
  schemaVersion:1,
  runtimeEvidenceSource:'ROBINHOOD_AGENTIC_RUNTIME_ERROR',
  observedPlatformConstraint:{
    fractionalTriggeredSellOrdersSupported:false,
    observedError:'Invalid trigger for fractional order',
    interpretation:'The connected Robinhood Agentic order path rejected stop-market and stop-limit trigger orders for fractional share quantities. Do not keep retrying unsupported triggered fractional orders.'
  },
  protectionHierarchy:[
    'For whole-share quantity, prefer a verified broker-resident persistent stop/stop-limit when the runtime accepts it.',
    'For a mixed position, protect the whole-share portion with a broker-resident stop when supported and treat only the fractional remainder as synthetic-stop exposure.',
    'For a position below one full share, no broker trigger may be assumed. Fractional protection is agent-managed synthetic protection only when active monitoring is healthy.',
    'Never describe a synthetic stop as broker-resident, guaranteed, or equivalent to a persistent stop.'
  ],
  fractionalSyntheticStop:{
    allowed:true,
    maximumPlannedStopRiskPctOfLiveEquity:0.75,
    requiresActiveMonitoring:true,
    maximumMonitoringIntervalMinutesDuringRegularSession:5,
    triggerRule:'When a reliable live Robinhood price at or below the saved Teststock stop/invalidation is observed, submit a fractional market sell for the protected fractional quantity immediately when runtime permissions allow. Re-read position/order status after submission and never infer a fill.',
    monitoringFailureRule:'If active monitoring cannot be verified during the regular session, do not open new fractional stock exposure. Existing synthetic-only fractional exposure is DEGRADED/UNPROTECTED; do not add risk. If runtime permissions allow automatic risk reduction, exit the synthetic-only fractional quantity rather than knowingly leaving it unattended.',
    marketClosedRule:'Do not pretend an agent-managed stop can execute while monitoring/order routing is unavailable. Re-check immediately when the regular session becomes actionable. Gap/slippage can exceed the planned stop.',
    executionType:'FRACTIONAL_MARKET_SELL_ON_OBSERVED_TRIGGER',
    slippageWarning:'A synthetic stop is not a resting broker order. Detection latency, outages, usage limits, gaps, fast markets, and market-order slippage can produce losses materially larger than planned.'
  },
  wholeShareStop:{
    preferred:true,
    action:'PLACE_AND_VERIFY_PERSISTENT_BROKER_STOP_WHEN_SUPPORTED'
  },
  mixedQuantity:{
    enabled:true,
    rule:'Let wholeQty=floor(live share quantity) and fractionalRemainder=live quantity-wholeQty. When supported, protect wholeQty with a broker-resident stop and protect only fractionalRemainder synthetically. Before any sell, reconcile open sell orders so combined sell quantity cannot exceed the live position.'
  },
  targetManagement:{
    target1:'Fractional partial profit may use the supported fractional sell path. After target1, whole shares should retain/tighten broker protection when supported; any fractional remainder remains subject to synthetic monitoring rules.',
    target2:'Apply runnerContinuationPolicy, but a fractional runner is allowed only while active monitoring satisfies this policy. If monitoring is not healthy, leave no synthetic-only fractional runner.',
    runner:'A fractional runner may never survive solely because continuation is strong. Both continuation evidence AND active synthetic-stop monitoring must pass.'
  },
  existingFractionalPositionResponse:{
    firstAction:'Inspect live quantity, open orders, saved Teststock stop/invalidation, current price, and runtime monitoring capability.',
    ifStopBreached:'Submit the supported fractional market sell immediately when permitted, then verify the fill/remaining quantity.',
    ifStopNotBreachedButMonitoringHealthy:'Keep the saved invalidation as a synthetic trigger, apply the reduced synthetic-risk policy to any future entries, and monitor at the required interval.',
    ifMonitoringNotHealthy:'Mark protection DEGRADED, open no additional fractional risk, and prefer reducing/closing synthetic-only exposure when automatic risk reduction is permitted rather than pretending it is protected.'
  },
  instructions:'Fractional-share protection is a degraded fallback forced by the observed broker limitation, not an upgrade. New fractional entries are allowed only when active monitoring can enforce the saved invalidation at least every 5 minutes during the regular session and planned stop risk is no more than 0.75% of live equity. Otherwise skip the fractional entry. Whole-share broker protection remains preferred.'
};

signal.systemHealth={...(signal.systemHealth||{}),runtimeFractionalProtection:{status:'RUNTIME_CHECK_REQUIRED',requiredForNewFractionalStock:true},criticalDependencies:[...new Set([...(signal.systemHealth?.criticalDependencies||[]),'active <=5-minute monitoring for any new fractional stock exposure'])]};

signal.executionTelemetryPolicy={...(signal.executionTelemetryPolicy||{}),track:[...new Set([...(signal.executionTelemetryPolicy?.track||[]),'protection mode BROKER/HYBRID/SYNTHETIC/UNPROTECTED','synthetic-stop observation timestamp','synthetic-stop trigger price','synthetic-stop market-sell submission/fill','synthetic-stop detection-to-submit latency'])]};

signal.exitAutomation={...(signal.exitAutomation||{}),stockProtection:'Determine the live stock quantity. For whole-share quantity, create and verify a broker-resident persistent protective stop when Robinhood accepts it. Do not retry unsupported trigger orders for a fractional remainder. Fractional quantity may use only signal.fractionalProtectionPolicy synthetic monitoring, and only while its monitoring/risk requirements pass.',noProtectionNoEntry:'Whole-share stock or option entries still require verified broker-resident protection when supported. A fractional stock entry may proceed only under signal.fractionalProtectionPolicy with active <=5-minute regular-session monitoring and the smaller 0.75%-of-live-equity planned-stop-risk cap. If those synthetic-protection requirements are not verifiably available, do not open the fractional entry.'};

if(signal.runnerContinuationPolicy){
  signal.runnerContinuationPolicy.protection={...(signal.runnerContinuationPolicy.protection||{}),fractionalRunnerRule:'A fractional runner requires both continuation authorization and healthy active synthetic-stop monitoring under signal.fractionalProtectionPolicy. Without that monitoring, exit the fractional runner instead of leaving it unattended.'};
}

if(signal.stockPlan?.stockOrders)for(const order of signal.stockPlan.stockOrders){
  order.protectionPlan={
    determineFromLiveQuantity:true,
    wholeShares:'BROKER_PERSISTENT_STOP_WHEN_SUPPORTED',
    fractionalRemainder:'SYNTHETIC_STOP_ONLY_IF_ACTIVE_MONITORING_PASSES',
    fractionalMaxPlannedStopRiskPctOfLiveEquity:0.75,
    syntheticMonitoringMaxMinutes:5,
    policyRef:'signal.fractionalProtectionPolicy'
  };
}

signal.hardRules=[...(signal.hardRules||[]),
  'FRACTIONAL STOP LIMITATION: the connected Robinhood Agentic runtime has rejected triggered stop orders for fractional share quantities with Invalid trigger for fractional order. Do not repeatedly retry unsupported stop-market/stop-limit fractional orders.',
  'FRACTIONAL SYNTHETIC PROTECTION: a new fractional stock entry is permitted only if active regular-session monitoring can be verified at intervals of 5 minutes or less and planned stop risk is capped at 0.75% of live equity. When the saved invalidation is observed as breached, submit the supported fractional market sell immediately when permitted and verify the result.',
  'WHOLE/HYBRID PROTECTION: use a verified broker-resident stop for whole-share quantity when supported; for mixed quantities, reconcile the whole-share broker stop with the synthetic fractional remainder so combined sell orders can never exceed the live position.',
  'SYNTHETIC STOP HONESTY: an agent-managed fractional stop is not persistent broker protection and cannot guarantee the planned exit. If monitoring becomes unavailable, do not add fractional risk and do not keep a fractional runner unattended.'
];

if(signal.generatorIntegrity?.traceableFeatures)signal.generatorIntegrity.traceableFeatures.fractionalSyntheticProtection=true;
signal.schemaVersion=Math.max(Number(signal.schemaVersion||0),22);
await fs.writeFile(signalFile,JSON.stringify(signal,null,2));
await fs.writeFile(path.resolve('docs/data/claude-signal.json'),JSON.stringify(signal,null,2));
console.log('Applied fractional-share protection policy; signal schema v22');
