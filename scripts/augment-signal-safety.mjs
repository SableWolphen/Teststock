import fs from 'node:fs/promises';
import path from 'node:path';

const signalFile=path.resolve('docs/signal.json');
const validationFile=path.resolve('docs/data/entry-gate-validation.json');
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const signal=await read(signalFile);if(!signal)throw new Error('signal.json missing after build');
const gateValidation=await read(validationFile);
const o=signal.stockPlan?.eliteOption;
if(o){
  const previouslyEligible=o.action==='AUTO_BUY_ELIGIBLE';
  o.wholeContractSizing={
    runtimeCheckRequired:true,
    smallestTradableQuantity:1,
    actualOneContractMaxRiskDollars:Number(o.contractReferenceMaxRiskDollars||0),
    rule:'Before an option can become executable, compute liveAllowedOptionRiskDollars = live Agentic-account equity × min(eliteOption.maxRiskPctOfRobinhoodBuyingPower, active capital-tier maxOptionRiskPct) / 100. Then compare the ACTUAL dollar max risk/premium of the smallest tradable contract quantity (normally 1 contract) against that live dollar cap. If one contract exceeds the cap, SKIP THE OPTION. Never treat a percentage allocation as fractional-contract sizing.',
    runtimeEligibleOnlyIf:'actualOneContractMaxRiskDollars <= liveAllowedOptionRiskDollars AND all other option gates pass'
  };
  if(previouslyEligible)o.action='RUNTIME_WHOLE_CONTRACT_CHECK_REQUIRED';
  if(signal.stockPlan?.overallAction==='AUTO_BUY_OPTION_ELIGIBLE'){
    signal.stockPlan.overallAction='OPTION_RUNTIME_RISK_CHECK_REQUIRED';
    signal.stockPlan.reason='An elite option passed research gates, but it is not executable until the live whole-contract dollar risk fits the active Robinhood capital-tier cap.';
  }
}
signal.entryGateRobustness=gateValidation?{
  reportUrl:'https://sablewolphen.github.io/Teststock/data/entry-gate-validation.json',
  status:gateValidation.status,
  generatedAt:gateValidation.generatedAt,
  gatesUnderReview:gateValidation.gatesUnderReview,
  requiredDiversityRegimes:gateValidation.requiredDiversityRegimes,
  failedRequiredRegimes:gateValidation.failedRequiredRegimes,
  instructions:gateValidation.instructions,
  interpretation:'This is a walk-forward-like historical robustness check across calm, volatile, and trending-down regimes. It is evidence, not a guarantee. A RED_FLAG must be surfaced and must never be used to justify increasing risk.'
}: {status:'UNAVAILABLE',instructions:'Historical multi-regime validation report is unavailable. Do not increase risk on the assumption that the entry gates are robust.'};
signal.strategyChangeLogUrl='https://sablewolphen.github.io/Teststock/strategy-changelog.txt';
signal.schemaVersion=13;
signal.hardRules=[...(signal.hardRules||[]),
  'WHOLE-CONTRACT OPTIONS CHECK: option percentages are not fractional-contract sizing. Before any option order, calculate the live dollar risk cap from current Agentic-account equity and the active tier, then compare it with the actual max dollar risk/premium of one whole contract. If one contract exceeds the cap, skip the option.',
  'MULTI-REGIME VALIDATION: inspect entryGateRobustness before new risk. If it is RED_FLAG or unavailable, surface that fact and never increase risk because of the historical model; keep other Teststock gates fully intact.'
];
await fs.writeFile(signalFile,JSON.stringify(signal,null,2));
await fs.writeFile(path.resolve('docs/data/claude-signal.json'),JSON.stringify(signal,null,2));
console.log(`Augmented signal schema v13; option whole-contract check=${Boolean(o)}; robustness=${signal.entryGateRobustness.status}`);
