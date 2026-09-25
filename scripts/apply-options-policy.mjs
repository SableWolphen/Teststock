import fs from 'node:fs/promises';

const signalPath='docs/signal.json';
const claudeSignalPath='docs/data/claude-signal.json';
const signal=JSON.parse(await fs.readFile(signalPath,'utf8'));

signal.optionsTradingPolicy={
  enabled:true,
  executionAgent:'CLAUDE',
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
  noDebitSpreadsInitially:true,
  noStraddlesOrStrangles:true,
  noExercise:true,
  noOvernight:true,
  underlyingMustBeQualifiedStock:true,
  liveOptionChainRequired:true,
  liveBrokerRecheckRequired:true,
  maxPremiumRiskPerTradePct:5,
  maxAggregateOpenPremiumRiskPct:15,
  maxNewPremiumExposurePerNyDayPct:10,
  minDte:14,
  maxDte:45,
  expirationSafetyTradingDays:5,
  minDelta:0.55,
  maxDelta:0.80,
  minLiquidity:'TIGHT_SPREAD_AND_EXITABLE',
  entryStyle:'MARKETABLE_LIMIT_WITH_MAX_PREMIUM',
  exitStyle:'FASTEST_SUPPORTED_RISK_APPROPRIATE_SELL_TO_CLOSE',
  riskRule:'Premium paid is the hard position-level loss ceiling; total new premium may never exceed current available account buying power or the encoded account percentage caps.',
  dayTradeRule:'Every Teststock option position is opened and closed during the same regular NYSE session. Never carry through expiration.',
  fallbackRule:'If no option contract passes every live gate, do not force an option trade. The independently qualified stock lane may trade instead.',
  exerciseRule:'Never exercise automatically. Close the option contract before expiration and never allow exercise to create stock or short-stock exposure.',
  duplicateRule:'Reconcile broker order/fill history and Teststock execution state before every option order; partial fills remain part of the original order.',
  optionsApprovalRequiredAtBroker:true
};

signal.autopilot={
  ...(signal.autopilot||{}),
  automaticQualifiedOptionBuys:true,
  automaticOptionRiskReducingExits:true,
  optionUserApprovalRequired:false,
  optionsFundingSource:'EXISTING_ROBINHOOD_AGENTIC_ACCOUNT_ONLY',
  optionsNoMargin:true,
  optionsNoDeposits:true,
  optionsNoExercise:true
};

signal.generatorIntegrity={
  ...(signal.generatorIntegrity||{}),
  traceableFeatures:{
    ...(signal.generatorIntegrity?.traceableFeatures||{}),
    automaticQualifiedOptionExecution:true,
    optionsCashOnly:true,
    optionsHardAccountLossCap:true
  }
};

await fs.writeFile(signalPath,JSON.stringify(signal,null,2));
await fs.writeFile(claudeSignalPath,JSON.stringify(signal,null,2));
console.log('Applied guarded automatic stock-options policy: long calls/puts only, cash-funded, no exercise/overnight, hard premium caps.');
