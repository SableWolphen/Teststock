import {SAFETY_POLICY, earnedAdmission} from './safety-policy.mjs';
import fs from 'node:fs/promises';

const signalPath='docs/signal.json';
const chatgptSignalPath='docs/data/chatgpt-signal.json';
const signal=JSON.parse(await fs.readFile(signalPath,'utf8'));
const read=async(f,x)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const indexResearch=await read('docs/data/index-options-research.json',{candidates:[]});
const indexAdmission=await read('docs/data/index-options-profitability-admission.json',{state:'SHADOW_ONLY',sizeMultiplier:0,executionAuthorized:false});
const indexLivePolicy=await read('docs/data/index-options-live-policy.json',{enabled:false,maxOrderUsd:0,maxNewPositionsPerNyDay:0,maxConcurrentPositions:0});
const indexExecutionAuthorized=SAFETY_POLICY.liveExecutionEnabled&&earnedAdmission(indexAdmission.state)&&indexAdmission.executionAuthorized===true;

signal.optionsTradingPolicy={
  enabled:false,
  executionAgent:'CHATGPT',
  transport:'ROBINHOOD_TRADING_MCP',
  cashOnly:true,
  accountLossCannotExceedAvailableAccountCapital:true,
  noMargin:true,
  noDeposits:true,
  noBankTransfers:true,
  allowedStrategies:['LONG_CALL','LONG_PUT'],
  buyToOpenOnly:true,
  sellToCloseOnly:true,
  noNakedSelling:true,
  noCreditSpreads:true,
  noDebitSpreadsInitially:true, // long calls/puts only; no spread execution
  noStraddlesOrStrangles:true,
  noExercise:true,
  noOvernight:true,
  underlyingMustBeQualifiedStock:true,
  liveOptionChainRequired:true,
  liveBrokerRecheckRequired:true,
  maxPremiumRiskPerTradePct:25,
  maxAggregateOpenPremiumRiskPct:50,
  maxNewPremiumExposurePerNyDayPct:35,
  minDte:3,
  maxDte:45,
  expirationSafetyTradingDays:5,
  minDelta:0.25,
  maxDelta:0.80,
  minLiquidity:'EXITABLE_WITH_LIVE_SPREAD_CHECK',
  entryStyle:'MARKETABLE_LIMIT_WITH_MAX_PREMIUM',
  exitStyle:'FASTEST_SUPPORTED_RISK_APPROPRIATE_SELL_TO_CLOSE',
  riskRule:'Premium paid is the hard position-level loss ceiling. There is no fixed repository dollar cap; total premium plus known fees may never exceed fresh available cash/unleveraged buying power in the dedicated account.',
  dayTradeRule:'Every Teststock option position is opened and closed during the same regular NYSE session. Never carry through expiration.',
  fallbackRule:'If no option contract passes every live gate, do not force an option trade. The independently qualified stock lane may trade instead.',
  exerciseRule:'Never exercise automatically. Close the option contract before expiration and never allow exercise to create stock or short-stock exposure.',
  duplicateRule:'Reconcile broker order/fill history and Teststock execution state before every option order; partial fills remain part of the original order.',
  optionsApprovalRequiredAtBroker:true
};

signal.indexOptionsTradingPolicy={
  enabled:true,
  researchEnabled:true,
  executionEnabled:indexExecutionAuthorized,
  executionAgent:'CHATGPT',
  transport:'ROBINHOOD_TRADING_MCP',
  separateAdmissionRequired:true,
  admissionState:indexAdmission.state,
  admissionSizeMultiplier:Number(indexAdmission.sizeMultiplier||0),
  liveBootstrap:indexAdmission.state==='LIVE_MICRO_BOOTSTRAP'?indexLivePolicy:null,
  allowedIndexes:['XND','DJX'],
  allowedStrategies:['LONG_CALL','LONG_PUT'],
  buyToOpenOnly:true,
  sellToCloseOnly:true,
  cashOnly:true,
  noMargin:true,
  noDeposits:true,
  noBankTransfers:true,
  noExercise:true,
  noOvernight:true,
  brokerContractResolutionRequired:true,
  brokerQuoteRequired:true,
  exactContractEvidenceRequired:true,
  proxyResearchOnly:true,
  proxyMap:{XND:'QQQ',DJX:'DIA'},
  underlyingQualification:'QQQ/DIA may establish direction and regime context only. They never substitute for live XND/DJX contract resolution or separate index-option profitability admission.',
  settlement:{
    XND:{cashSettled:true,exerciseStyle:'EUROPEAN',earlyAssignmentRisk:false,settleOnOpen:false,settlementWindow:'PM'},
    DJX:{cashSettled:true,exerciseStyle:'EUROPEAN',earlyAssignmentRisk:false,settleOnOpen:true,settlementWindow:'AM'}
  },
  taxContext:{
    potentialSection1256Treatment:true,
    generalRule:'Qualifying Section 1256 index options are generally treated 60% long-term and 40% short-term and may be subject to year-end mark-to-market.',
    informationalOnly:true,
    affectsEligibility:false,
    verifyWithTaxProfessional:true
  },
  researchCandidates:indexResearch.candidates||[],
  riskRule:'Index options remain defined-risk long premium only. Premium paid, live spread/slippage, account cash, capital-tier risk, same-day exit, and all broker protections remain hard gates.',
  admissionRule:'Separate exact-contract evidence is required. Bootstrap is disabled. No live order is authorized while safety-policy.mjs has liveExecutionEnabled=false.',
};

signal.autopilot={
  ...(signal.autopilot||{}),
  automaticQualifiedOptionBuys:false,
  automaticQualifiedIndexOptionBuys:indexExecutionAuthorized,
  automaticOptionRiskReducingExits:false,
  optionUserApprovalRequired:true,
  optionsFundingSource:'EXISTING_ROBINHOOD_AGENTIC_ACCOUNT_ONLY',
  optionsNoMargin:true,
  optionsNoDeposits:true,
  optionsNoExercise:true
};

signal.generatorIntegrity={
  ...(signal.generatorIntegrity||{}),
  traceableFeatures:{
    ...(signal.generatorIntegrity?.traceableFeatures||{}),
    automaticQualifiedOptionExecution:false,
    optionsCashOnly:true,
    optionsHardAccountLossCap:true,
    indexOptionsSeparateAdmission:true,
    indexOptionsBrokerResolved:true,
    indexOptionsLiveMicroBootstrap:true
  }
};

await fs.writeFile(signalPath,JSON.stringify(signal,null,2));
await fs.writeFile(chatgptSignalPath,JSON.stringify(signal,null,2));
console.log('Applied locked stock-options policy: bootstrap disabled, long calls/puts research only, no exercise/overnight.');
