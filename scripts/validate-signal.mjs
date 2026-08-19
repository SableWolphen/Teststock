import fs from 'node:fs/promises';

const file=process.argv[2]||'docs/signal.json';
const raw=await fs.readFile(file,'utf8');
let s;try{s=JSON.parse(raw);}catch{throw new Error('signal.json is not valid JSON');}
const fail=[];
const finite=n=>Number.isFinite(Number(n));
if(!Number.isInteger(s.schemaVersion)||s.schemaVersion<15)fail.push('schemaVersion');
if(s.source!=='Teststock')fail.push('source');
const generated=new Date(s.generatedAt).getTime(),age=Date.now()-generated;
if(!Number.isFinite(generated)||age< -5*60_000||age>10*60_000)fail.push('generatedAt freshness');
if(s.funding?.agentMayInitiateDeposits!==false||s.funding?.agentMayInitiateBankTransfers!==false)fail.push('funding lock');
if(!finite(s.hardAccountFloor?.noNewTradesBelowEquity)||Number(s.hardAccountFloor.noNewTradesBelowEquity)<0)fail.push('hard floor');
const tiers=s.capitalLadder?.tiers;
if(!Array.isArray(tiers)||tiers.length<5)fail.push('capital tiers');
else{
  let last=-Infinity;
  for(const t of tiers){if(!finite(t.minEquity)||Number(t.minEquity)<last)fail.push('tier ordering');last=Number(t.minEquity);for(const k of ['stockAllocationMultiplier','maxOptionRiskPct','maxPlannedStopRiskPct','maxDeployedPct'])if(!finite(t[k])||Number(t[k])<0||Number(t[k])>100)fail.push(`tier ${k}`);}
  const hundred=tiers.find(t=>Number(t.minEquity)===100);if(hundred?.label!=='PROVE')fail.push('$100 PROVE boundary');
}
for(const plan of [s.stockPlan,s.cryptoPlan])if(!plan||typeof plan!=='object')fail.push('asset plan missing');
for(const order of s.stockPlan?.stockOrders||[]){for(const k of ['minimumEntry','maximumEntry','stop','target1','target2'])if(!finite(order[k])||Number(order[k])<=0)fail.push(`stock ${k}`);if(Number(order.maximumEntry)<Number(order.minimumEntry))fail.push('stock entry range');if(Number(order.plannedStopRiskPctOfRobinhoodBuyingPower)<0||Number(order.plannedStopRiskPctOfRobinhoodBuyingPower)>100)fail.push('stock risk pct');}
for(const order of s.cryptoPlan?.cryptoOrders||[]){for(const k of ['minimumEntry','maximumEntry','stop','target1','target2'])if(!finite(order[k])||Number(order[k])<=0)fail.push(`crypto ${k}`);if(Number(order.maximumEntry)<Number(order.minimumEntry))fail.push('crypto entry range');}
const o=s.stockPlan?.eliteOption;if(o){if(!finite(o.contractReferenceMaxRiskDollars)||Number(o.contractReferenceMaxRiskDollars)<=0)fail.push('option contract risk');if(!o.wholeContractSizing?.runtimeCheckRequired)fail.push('option whole-contract runtime check');}
if(!s.systemHealth||s.systemHealth.actionOnCriticalFailure!=='NO_NEW_TRADES_MANAGE_EXITS_IF_POSSIBLE')fail.push('system health fail-closed policy');
if(!Array.isArray(s.systemHealth?.criticalDependencies)||s.systemHealth.criticalDependencies.length<4)fail.push('critical dependency list');
if(s.shadowEvidencePolicy?.automaticLooseningAllowed!==false)fail.push('shadow automatic loosening lock');
if(!finite(s.shadowEvidencePolicy?.minimumResolvedAcceptedBeforeRuleReview)||Number(s.shadowEvidencePolicy.minimumResolvedAcceptedBeforeRuleReview)<30)fail.push('shadow accepted sample floor');
if(!finite(s.shadowEvidencePolicy?.minimumResolvedRejectedBeforeRuleReview)||Number(s.shadowEvidencePolicy.minimumResolvedRejectedBeforeRuleReview)<30)fail.push('shadow rejected sample floor');
if(s.executionTelemetryPolicy?.sourceOfTruth!=='ROBINHOOD_CONFIRMED_FILLS_AND_ORDERS')fail.push('execution telemetry source');
if(!s.dailySummaryPolicy?.enabled)fail.push('daily summary policy');
if(fail.length)throw new Error(`signal validation failed: ${[...new Set(fail)].join(', ')}`);
console.log(`signal validation passed: schema v${s.schemaVersion}, generated ${s.generatedAt}`);
