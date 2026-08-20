import fs from 'node:fs/promises';
const file=process.argv[2]||'docs/signal.json',raw=await fs.readFile(file,'utf8');let s;try{s=JSON.parse(raw);}catch{throw new Error('signal.json is not valid JSON');}
const fail=[],finite=n=>Number.isFinite(Number(n));
if(!Number.isInteger(s.schemaVersion)||s.schemaVersion<21)fail.push('schemaVersion');if(s.source!=='Teststock')fail.push('source');
const generated=new Date(s.generatedAt).getTime(),age=Date.now()-generated;if(!Number.isFinite(generated)||age< -5*60_000||age>10*60_000)fail.push('generatedAt freshness');
if(s.funding?.agentMayInitiateDeposits!==false||s.funding?.agentMayInitiateBankTransfers!==false)fail.push('funding lock');
const tiers=s.capitalLadder?.tiers;if(!Array.isArray(tiers)||tiers.length<5)fail.push('capital tiers');else{let last=-Infinity;for(const t of tiers){if(!finite(t.minEquity)||Number(t.minEquity)<last)fail.push('tier ordering');last=Number(t.minEquity);}if(tiers.find(t=>Number(t.minEquity)===100)?.label!=='PROVE')fail.push('$100 PROVE boundary');}
for(const plan of [s.stockPlan,s.cryptoPlan])if(!plan||typeof plan!=='object')fail.push('asset plan missing');
for(const order of s.stockPlan?.stockOrders||[]){for(const k of ['minimumEntry','maximumEntry','stop','target1','target2'])if(!finite(order[k])||Number(order[k])<=0)fail.push(`stock ${k}`);if(Number(order.maximumEntry)<Number(order.minimumEntry))fail.push('stock entry range');if(Number(order.rewardRisk||0)>0&&Number(order.rewardRisk)<2.5)fail.push('stock target2 reward-risk gate');if(order.exitPlan?.target1SellPctOfOriginal!==25)fail.push('stock target1 scale-out');if(Number(order.exitPlan?.maxRunnerPctOfOriginal||0)>25)fail.push('stock runner too large');}
for(const order of s.cryptoPlan?.cryptoOrders||[]){for(const k of ['minimumEntry','maximumEntry','stop','target1','target2'])if(!finite(order[k])||Number(order[k])<=0)fail.push(`crypto ${k}`);}
const o=s.stockPlan?.eliteOption;if(o&&!o.wholeContractSizing?.runtimeCheckRequired)fail.push('option whole-contract runtime check');
if(s.systemHealth?.actionOnCriticalFailure!=='NO_NEW_TRADES_MANAGE_EXITS_IF_POSSIBLE')fail.push('system health fail-closed policy');
if(!s.entryGateRobustness?.secondHoldoutStart||!s.entryGateRobustness?.secondHoldout)fail.push('second untouched holdout');
if(!s.entryGateRobustness?.regimeEntryProfiles)fail.push('regime entry profiles');
if(Number(s.tradeFrequencyGuard?.maxNewPositionsPerSevenDays||0)<7)fail.push('multi-position weekly capacity');
if(Number(s.tradeFrequencyGuard?.maxNewPositionsPerDay||0)>4)fail.push('daily position cap too high');
if(Number(s.portfolioGuard?.maxConcurrentTeststockPositions||0)>4)fail.push('concurrent portfolio cap too high');
if(Number(s.executionQuality?.maxStockSpreadPct||99)>.35)fail.push('stock spread cap');
if(!s.executionQuality?.gapRiskGuard?.enabled)fail.push('gap-risk guard');
if(!s.executionQuality?.liquidityRanking?.enabled)fail.push('liquidity ranking');
if(!s.symbolProbationPolicy?.enabled)fail.push('symbol probation');
if(!s.probabilityFirstPolicy||s.probabilityFirstPolicy.status==='UNAVAILABLE')fail.push('probability-first policy');
if(Number(s.probabilityFirstPolicy?.stocks?.minHistoricalSamples||0)<20)fail.push('probability stock sample floor');
if(Number(s.probabilityFirstPolicy?.stocks?.minCostAdjustedConservativeExpectedR||0)<.5)fail.push('cost-adjusted stock expectancy floor');
if(s.probabilityFirstPolicy?.stocks?.rewardRiskQualificationTarget!=='TARGET2')fail.push('target2 reward-risk qualification');
if(Number(s.probabilityFirstPolicy?.options?.liveEvidenceMinimumResolvedTrades||0)<10)fail.push('option real-fill evidence floor');
if(Number(s.probabilityFirstPolicy?.crypto?.liveEvidenceMinimumResolvedTrades||0)<10)fail.push('crypto real-fill evidence floor');
if(!s.crossAssetOpportunityRanking||s.crossAssetOpportunityRanking.status==='UNAVAILABLE')fail.push('cross-asset opportunity ranking');
if(s.systemHealth?.crossAssetRanking?.required!==true)fail.push('cross-asset ranking health dependency');
if(s.shadowEvidencePolicy?.automaticLooseningAllowed!==false)fail.push('shadow automatic loosening lock');
if(s.executionTelemetryPolicy?.sourceOfTruth!=='ROBINHOOD_CONFIRMED_FILLS_AND_ORDERS')fail.push('execution telemetry source');if(!s.dailySummaryPolicy?.enabled)fail.push('daily summary policy');
if(s.runnerContinuationPolicy?.enabled!==true)fail.push('runner policy');
if(Number(s.runnerContinuationPolicy?.target1SellPctOfOriginal)!==25)fail.push('runner target1 allocation');
if(Number(s.runnerContinuationPolicy?.maximumRunnerPctOfOriginal)!==25)fail.push('runner max allocation');
if(Number(s.runnerContinuationPolicy?.moderateRunnerPctOfOriginal)!==15)fail.push('runner moderate allocation');
if(Number(s.runnerContinuationPolicy?.noSignalRunnerPctOfOriginal)!==0)fail.push('runner fail-closed allocation');
if(s.runnerContinuationPolicy?.otherwise?.action!=='EXIT_REMAINDER_AT_OR_AFTER_TARGET2')fail.push('runner weak-signal exit');
if(s.dataFreshness?.status!=='GENERATED_THIS_RUN')fail.push('data freshness status');
const lastSuccess=new Date(s.dataFreshness?.lastSuccessfulGeneration||0).getTime();if(!Number.isFinite(lastSuccess)||Math.abs(Date.now()-lastSuccess)>10*60_000)fail.push('last successful generation freshness');
if(Number(s.dataFreshness?.expectedRefreshCadenceMinutes||0)!==10)fail.push('refresh cadence metadata');
if(s.dataFreshness?.failClosed!==true)fail.push('freshness fail-closed');
if(Number(s.dataFreshness?.cryptoAgeMinutes??999)>25)fail.push('crypto data stale at generation');
if(Number(s.dataFreshness?.entryGateValidationAgeMinutes??999)>120)fail.push('entry-gate validation stale');
if(!s.generatorIntegrity?.lastKnownGoodFallback)fail.push('last-known-good fallback metadata');
for(const k of ['dualUntouchedHoldouts','regimeSpecificEntryProfiles','wholeContractOptionSizing','setupClusterAndSymbolRealFillLearning','staleDataFailClosed','costAdjustedExpectancy','target2RewardRiskQualification','crossAssetOpportunityRanking','conditionalRunnerExit'])if(s.generatorIntegrity?.traceableFeatures?.[k]!==true)fail.push(`integrity feature ${k}`);
if(fail.length)throw new Error(`signal validation failed: ${[...new Set(fail)].join(', ')}`);console.log(`signal validation passed: schema v${s.schemaVersion}, generated ${s.generatedAt}`);
