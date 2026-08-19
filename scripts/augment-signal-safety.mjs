import fs from 'node:fs/promises';
import path from 'node:path';

const signalFile=path.resolve('docs/signal.json');
const validationFile=path.resolve('docs/data/entry-gate-validation.json');
const shadowFile=path.resolve('docs/data/shadow-trades.json');
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const signal=await read(signalFile);if(!signal)throw new Error('signal.json missing after build');
const gateValidation=await read(validationFile),shadow=await read(shadowFile);
const o=signal.stockPlan?.eliteOption;
if(o){
  const previouslyEligible=o.action==='AUTO_BUY_ELIGIBLE';
  o.wholeContractSizing={runtimeCheckRequired:true,smallestTradableQuantity:1,actualOneContractMaxRiskDollars:Number(o.contractReferenceMaxRiskDollars||0),rule:'Before an option can become executable, compute liveAllowedOptionRiskDollars = live Agentic-account equity × min(eliteOption.maxRiskPctOfRobinhoodBuyingPower, active capital-tier maxOptionRiskPct) / 100. Then compare the ACTUAL dollar max risk/premium of the smallest tradable contract quantity (normally 1 contract) against that live dollar cap. If one contract exceeds the cap, SKIP THE OPTION. Never treat a percentage allocation as fractional-contract sizing.',runtimeEligibleOnlyIf:'actualOneContractMaxRiskDollars <= liveAllowedOptionRiskDollars AND all other option gates pass'};
  if(previouslyEligible)o.action='RUNTIME_WHOLE_CONTRACT_CHECK_REQUIRED';
  if(signal.stockPlan?.overallAction==='AUTO_BUY_OPTION_ELIGIBLE'){signal.stockPlan.overallAction='OPTION_RUNTIME_RISK_CHECK_REQUIRED';signal.stockPlan.reason='An elite option passed research gates, but it is not executable until the live whole-contract dollar risk fits the active Robinhood capital-tier cap.';}
}
signal.entryGateRobustness=gateValidation?{reportUrl:'https://sablewolphen.github.io/Teststock/data/entry-gate-validation.json',status:gateValidation.status,generatedAt:gateValidation.generatedAt,holdoutStart:gateValidation.holdoutStart,gatesUnderReview:gateValidation.gatesUnderReview,requiredDiversityRegimes:gateValidation.requiredDiversityRegimes,failedRequiredRegimes:gateValidation.failedRequiredRegimes,development:gateValidation.development,holdout:gateValidation.holdout,runtimePolicy:gateValidation.runtimePolicy,instructions:gateValidation.instructions,interpretation:'The fixed gates are measured separately on a development period and a chronological untouched holdout beginning 2024-01-01. Runtime regime policy may reduce or block risk; it may never loosen the base gates. This remains historical evidence, not a guarantee.'}:{status:'UNAVAILABLE',instructions:'Historical holdout/multi-regime validation report is unavailable. Do not increase risk on the assumption that the entry gates are robust.'};
signal.shadowDiagnostics=shadow?{reportUrl:'https://sablewolphen.github.io/Teststock/data/shadow-trades.json',generatedAt:shadow.generatedAt,summary:shadow.summary,modelOnly:true,instructions:'Accepted/rejected shadow outcomes are diagnostic opportunity-cost data only. Never treat them as Robinhood fills, real P&L, or automatic permission to loosen live-money gates.'}:{status:'UNAVAILABLE',modelOnly:true};
signal.strategyChangeLogUrl='https://sablewolphen.github.io/Teststock/strategy-changelog.txt';
signal.schemaVersion=14;
signal.hardRules=[...(signal.hardRules||[]),
  'WHOLE-CONTRACT OPTIONS CHECK: option percentages are not fractional-contract sizing. Before any option order, calculate the live dollar risk cap from current Agentic-account equity and the active tier, then compare it with the actual max dollar risk/premium of one whole contract. If one contract exceeds the cap, skip the option.',
  'HOLDOUT + REGIME VALIDATION: inspect entryGateRobustness before new risk. Weak holdout regimes may reduce or block new positions. Never loosen the 52% win-rate, 2.5:1 reward/risk, 15-sample, or 0.5R conservative-expected-value gates because a recent slice looks favorable.',
  'EVENT RISK: obey any stockPlan.policy event blackout and advanced guard. Never bypass an encoded earnings/filing/corporate-action block to force a trade.',
  'SHADOW DATA: shadowDiagnostics is model-only. Never count it as real P&L or use it to automatically increase live-money risk.'
];
await fs.writeFile(signalFile,JSON.stringify(signal,null,2));
await fs.writeFile(path.resolve('docs/data/claude-signal.json'),JSON.stringify(signal,null,2));
console.log(`Augmented signal schema v14; option whole-contract check=${Boolean(o)}; robustness=${signal.entryGateRobustness.status}`);
