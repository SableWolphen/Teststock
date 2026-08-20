import fs from 'node:fs/promises';

const signalFile='docs/signal.json';
const reportFile='docs/data/exit-policy-validation.json';
const signal=JSON.parse(await fs.readFile(signalFile,'utf8'));
let report=null;try{report=JSON.parse(await fs.readFile(reportFile,'utf8'));}catch{}
const age=report?(Date.now()-new Date(report.generatedAt||0).getTime())/60000:Infinity;
const valid=report&&Number.isFinite(age)&&age<=180&&report.recommendedPolicy;
const policyId=valid?report.recommendedPolicy:'T1_25_T2_75';
const map={
  ALL_T2:{target1Pct:0,target2Pct:100,maxRunnerPct:0,moderateRunnerPct:0},
  T1_25_T2_75:{target1Pct:25,target2Pct:75,maxRunnerPct:0,moderateRunnerPct:0},
  T1_25_T2_60_RUN15:{target1Pct:25,target2Pct:60,maxRunnerPct:15,moderateRunnerPct:15},
  T1_25_T2_50_RUN25:{target1Pct:25,target2Pct:50,maxRunnerPct:25,moderateRunnerPct:15}
};
const chosen=map[policyId]||map.T1_25_T2_75;
signal.exitPolicyValidation={status:valid?'AVAILABLE':'UNAVAILABLE_FAILSAFE_BASELINE',generatedAt:report?.generatedAt||null,recommendedPolicy:policyId,recommendationReason:report?.recommendationReason||'Missing/stale exit-policy evidence; use no-runner baseline.',reportUrl:'https://raw.githubusercontent.com/SableWolphen/Teststock/main/docs/data/exit-policy-validation.json',automaticRiskIncreaseAllowed:false};
if(signal.runnerContinuationPolicy){signal.runnerContinuationPolicy.validationBackedPolicy=policyId;signal.runnerContinuationPolicy.target1SellPctOfOriginal=chosen.target1Pct;signal.runnerContinuationPolicy.maximumRunnerPctOfOriginal=chosen.maxRunnerPct;signal.runnerContinuationPolicy.moderateRunnerPctOfOriginal=Math.min(chosen.moderateRunnerPct,chosen.maxRunnerPct);signal.runnerContinuationPolicy.noSignalRunnerPctOfOriginal=0;signal.runnerContinuationPolicy.target2BaseSellPctOfOriginal=chosen.target2Pct;signal.runnerContinuationPolicy.instructions=`Exit shape is constrained by exitPolicyValidation. ${policyId} is currently authorized. Missing/stale validation falls back to T1_25_T2_75 with no runner. A continuation signal may only REDUCE the authorized runner; it may never exceed the validated maximum.`;}
for(const order of signal.stockPlan?.stockOrders||[]){const q=Number(order.growthQuality||0),exp=Number(order.expectancy?.costAdjustedConservativeExpectedR??order.expectancy?.conservativeExpectedR??-99),regimeOk=signal.entryGateRobustness?.runtimePolicy?.allowNewStocks!==false;let continuation='NONE',runnerPct=0;if(chosen.maxRunnerPct>0&&regimeOk&&q>=97&&exp>=.9){continuation='STRONG';runnerPct=chosen.maxRunnerPct;}else if(chosen.maxRunnerPct>0&&regimeOk&&q>=92&&exp>=.5){continuation='MODERATE';runnerPct=Math.min(chosen.moderateRunnerPct,chosen.maxRunnerPct);}order.exitPlan={...(order.exitPlan||{}),validatedPolicy:policyId,target1SellPctOfOriginal:chosen.target1Pct,target2BaseSellPctOfOriginal:chosen.target2Pct,maxRunnerPctOfOriginal:chosen.maxRunnerPct,runnerSignal:continuation,runnerPctOfOriginal:runnerPct,runnerAction:runnerPct>0?`KEEP_UP_TO_${runnerPct}_PCT_IF_LIVE_GUARDS_PASS`:'EXIT_REMAINDER_AT_TARGET2'};}
signal.tradeFrequencyGuard={...(signal.tradeFrequencyGuard||{}),maxNewPositionsPerDay:4,maxNewPositionsPerSevenDays:10,instructions:'Up to four independently qualified new positions per day and 10 per rolling 7 days. These are ceilings, never quotas; all smaller cash, risk, event, correlation, execution, protection, and real-fill limits override them.'};
signal.modelSizingPolicy={modelOrShadowHistoryMayIncreaseLiveSize:false,maximumModelOnlySizeMultiplier:1,liveScalingAuthority:'CONFIRMED_ROBINHOOD_REAL_FILLS_UNDER_PERFORMANCE_SCALING_GUARD',instructions:'Backtests, scanner history, and shadow data may rank or reduce risk but never increase live allocation.'};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),exitPolicyHoldoutValidation:true,modelSizingLock:true}};
signal.schemaVersion=Math.max(23,Number(signal.schemaVersion||0));
await fs.writeFile(signalFile,JSON.stringify(signal,null,2));await fs.writeFile('docs/data/claude-signal.json',JSON.stringify(signal,null,2));console.log(`Applied exit-policy evidence: ${policyId}, validation ${valid?'fresh':'failsafe'}; 4/day 10/rolling-7 frequency standardized.`);
