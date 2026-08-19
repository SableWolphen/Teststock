import fs from 'node:fs/promises';
import path from 'node:path';

const signalFile=path.resolve('docs/signal.json');
const validationFile=path.resolve('docs/data/entry-gate-validation.json');
const shadowFile=path.resolve('docs/data/shadow-trades.json');
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const signal=await read(signalFile);if(!signal)throw new Error('signal.json missing after build');
const gateValidation=await read(validationFile),shadow=await read(shadowFile);
const now=Date.now();
const ageMinutes=v=>{const t=new Date(v||0).getTime();return Number.isFinite(t)?Math.max(0,Math.round((now-t)/60000)):null;};
const o=signal.stockPlan?.eliteOption;
if(o){
  const previouslyEligible=o.action==='AUTO_BUY_ELIGIBLE';
  o.wholeContractSizing={runtimeCheckRequired:true,smallestTradableQuantity:1,actualOneContractMaxRiskDollars:Number(o.contractReferenceMaxRiskDollars||0),rule:'Before an option can become executable, compute liveAllowedOptionRiskDollars = live Agentic-account equity × min(eliteOption.maxRiskPctOfRobinhoodBuyingPower, active capital-tier maxOptionRiskPct) / 100. Then compare the ACTUAL dollar max risk/premium of the smallest tradable contract quantity (normally 1 contract) against that live dollar cap. If one contract exceeds the cap, SKIP THE OPTION. Never treat a percentage allocation as fractional-contract sizing.',runtimeEligibleOnlyIf:'actualOneContractMaxRiskDollars <= liveAllowedOptionRiskDollars AND all other option gates pass'};
  if(previouslyEligible)o.action='RUNTIME_WHOLE_CONTRACT_CHECK_REQUIRED';
  if(signal.stockPlan?.overallAction==='AUTO_BUY_OPTION_ELIGIBLE'){signal.stockPlan.overallAction='OPTION_RUNTIME_RISK_CHECK_REQUIRED';signal.stockPlan.reason='An elite option passed research gates, but it is not executable until the live whole-contract dollar risk fits the active Robinhood capital-tier cap.';}
}
signal.entryGateRobustness=gateValidation?{reportUrl:'https://sablewolphen.github.io/Teststock/data/entry-gate-validation.json',status:gateValidation.status,generatedAt:gateValidation.generatedAt,holdoutStart:gateValidation.holdoutStart,gatesUnderReview:gateValidation.gatesUnderReview,requiredDiversityRegimes:gateValidation.requiredDiversityRegimes,failedRequiredRegimes:gateValidation.failedRequiredRegimes,development:gateValidation.development,holdout:gateValidation.holdout,runtimePolicy:gateValidation.runtimePolicy,instructions:gateValidation.instructions,interpretation:'The fixed gates are measured separately on a development period and a chronological untouched holdout beginning 2024-01-01. Runtime regime policy may reduce or block risk; it may never loosen the base gates. This remains historical evidence, not a guarantee.'}:{status:'UNAVAILABLE',instructions:'Historical holdout/multi-regime validation report is unavailable. Do not increase risk on the assumption that the entry gates are robust.'};
signal.shadowDiagnostics=shadow?{reportUrl:'https://sablewolphen.github.io/Teststock/data/shadow-trades.json',generatedAt:shadow.generatedAt,summary:shadow.summary,modelOnly:true,instructions:'Accepted/rejected shadow outcomes are diagnostic opportunity-cost data only. Never treat them as Robinhood fills, real P&L, or automatic permission to loosen live-money gates.'}:{status:'UNAVAILABLE',modelOnly:true};
signal.shadowEvidencePolicy={minimumResolvedAcceptedBeforeRuleReview:30,minimumResolvedRejectedBeforeRuleReview:30,automaticLooseningAllowed:false,instructions:'Do not change or loosen live-money gates from shadow results until at least 30 ACCEPTED and 30 REJECTED shadow decisions are resolved. Even after that threshold, shadow data may justify a review only; it may never automatically increase live risk.'};
signal.systemHealth={
  generatedAt:new Date().toISOString(),
  signalAgeMinutes:ageMinutes(signal.generatedAt),
  entryGateValidation:{status:signal.entryGateRobustness?.status||'UNAVAILABLE',ageMinutes:ageMinutes(gateValidation?.generatedAt),required:true},
  shadowLedger:{status:shadow?'AVAILABLE':'UNAVAILABLE',ageMinutes:ageMinutes(shadow?.generatedAt),requiredForTrading:false},
  runtimeBroker:{status:'RUNTIME_CHECK_REQUIRED',required:true},
  runtimeJournalPersistence:{status:'RUNTIME_CHECK_REQUIRED',requiredForRiskIncrease:true},
  runtimeProtectiveExitCapability:{status:'RUNTIME_CHECK_REQUIRED',requiredForNewStockOrOption:true},
  actionOnCriticalFailure:'NO_NEW_TRADES_MANAGE_EXITS_IF_POSSIBLE',
  criticalDependencies:['fresh Teststock signal','live Robinhood equity/cash','known order/position state','verified protective-exit capability for a new stock/option','journal reconciliation or reliable Robinhood-history reconstruction'],
  instructions:'At runtime, any missing, stale, contradictory, or unknown CRITICAL dependency means no new position. Cash is preferred to guessing. Existing exposure should still be protected or exited when possible.'
};
signal.performanceScalingGuard={
  mode:'REAL_FILL_PROOF_BEFORE_HIGHER_RISK',
  appliesAfterEquityTierSelection:true,
  defaultMaximumRiskTierWithoutProof:'PROVE',
  scaleUnlock:{
    minimumResolvedRealTrades:20,
    minimumAverageRealizedR:0.20,
    minimumWinRatePct:45,
    maximumReliableObservedDrawdownPct:6,
    requirements:'SCALE risk may be used only when all available reliable real-fill metrics meet these minimums and no real-fill, slippage, protection, circuit-breaker, health, or persistence guard is blocking risk.'
  },
  growthUnlock:{
    minimumResolvedRealTrades:30,
    minimumAverageRealizedR:0.30,
    minimumWinRatePct:48,
    maximumReliableObservedDrawdownPct:6,
    requirements:'GROWTH risk may be used only when all available reliable real-fill metrics meet these stronger minimums and no real-fill, slippage, protection, circuit-breaker, health, or persistence guard is blocking risk.'
  },
  instructions:'Account equity alone must never unlock more aggressive risk. First select the normal capitalLadder tier from live equity, then cap the EFFECTIVE RISK TIER by proven real-money performance. Before SCALE proof, never use risk settings above PROVE even if the user manually deposits more or profits lift equity. Before GROWTH proof, never use risk settings above SCALE. Missing, ambiguous, or non-persistent performance evidence cannot unlock a higher risk tier. This guard can only reduce risk, never increase it above the equity-based capital tier.'
};
signal.dailySummaryPolicy={enabled:true,oncePerCalendarDay:true,preferredLocalHour:8,fields:['account value','cash buying power','open positions','open planned risk','realized P&L','trades today','current regime','blocked setups','system health','journal persistence','equity tier','effective risk tier'],instructions:'Claude should emit one concise daily health/performance summary on the first scheduled run at or after 08:00 local time when local time is available; otherwise use the first run of each UTC calendar day. Do not spam repeated daily summaries.'};
signal.executionTelemetryPolicy={enabled:true,sourceOfTruth:'ROBINHOOD_CONFIRMED_FILLS_AND_ORDERS',track:['submitted order type','submitted limit/stop price','bid/ask spread at submission when available','actual average fill','time to fill','adverse entry slippage','protective-order creation latency','protective-order verification status','exit reference','actual exit fill','adverse exit slippage'],instructions:'Record only observed values from Robinhood/runtime tools. Never invent unavailable telemetry. Repeated bad execution may only reduce or block risk under the real-fill learning policy.'};
signal.strategyChangeLogUrl='https://sablewolphen.github.io/Teststock/strategy-changelog.txt';
signal.schemaVersion=16;
signal.hardRules=[...(signal.hardRules||[]),
  'WHOLE-CONTRACT OPTIONS CHECK: option percentages are not fractional-contract sizing. Before any option order, calculate the live dollar risk cap from current Agentic-account equity and the active tier, then compare it with the actual max dollar risk/premium of one whole contract. If one contract exceeds the cap, skip the option.',
  'HOLDOUT + REGIME VALIDATION: inspect entryGateRobustness before new risk. Weak holdout regimes may reduce or block new positions. Never loosen the 52% win-rate, 2.5:1 reward/risk, 15-sample, or 0.5R conservative-expected-value gates because a recent slice looks favorable.',
  'EVENT RISK: obey any stockPlan.policy event blackout and advanced guard. Never bypass an encoded earnings/filing/corporate-action block to force a trade.',
  'SHADOW DATA: shadowDiagnostics is model-only. Never count it as real P&L or use it to automatically increase live-money risk.',
  'CRITICAL DEPENDENCY FAIL-CLOSED: if the Teststock signal, Robinhood account/order/position state, protective-exit capability, or journal/history reconciliation is stale, missing, contradictory, or unknown, open no new position. Manage existing exposure only.',
  'EXECUTION TELEMETRY: record confirmed order/fill/spread/slippage/protection timing when available. Missing telemetry may never be guessed, and bad observed execution may only make sizing more conservative.',
  'PERFORMANCE-GATED SCALING: live equity determines the normal capital tier, but real-money evidence caps the effective risk tier. Do not use SCALE risk before at least 20 resolved real trades with average realized R >= 0.20 and win rate >= 45%. Do not use GROWTH risk before at least 30 resolved real trades with average realized R >= 0.30 and win rate >= 48%. Reliable drawdown must remain below 6% and all other guards must pass. Missing or ambiguous evidence cannot unlock higher risk.'
];
await fs.writeFile(signalFile,JSON.stringify(signal,null,2));
await fs.writeFile(path.resolve('docs/data/claude-signal.json'),JSON.stringify(signal,null,2));
console.log(`Augmented signal schema v16; performance-gated scaling enabled; robustness=${signal.entryGateRobustness.status}`);
