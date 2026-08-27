import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const CLAUDE_SIGNAL='docs/data/claude-signal.json';
const signal=JSON.parse(await fs.readFile(SIGNAL,'utf8'));

const policy={
  enabled:true,
  role:'SOLE_EXECUTION_AGENT',
  schedule:{cron:'*/5 * * * *',timezone:'UTC',note:'A persistent authorized Claude runtime checks Teststock every five minutes. GitHub scanning remains separate from broker execution.'},
  triggerBoardFirst:true,
  triggerBoardPath:'docs/data/trigger-board.json',
  executionWatchlistPath:'docs/data/execution-watchlist.json',
  dispatchPath:'docs/data/execution-dispatch.json',
  cryptoAdmissionPath:'docs/data/crypto-profitability-admission.json',
  sourceOfTruth:'LATEST_RAW_MAIN',
  generationMatchRequired:true,
  generationRule:'Before adding risk, fetch the newest raw-main dispatch and signal. If generation ids or timestamps conflict, re-fetch and do not submit new risk until they match.',
  accountGuardrailSource:{source:'CURRENT_RAW_MAIN_SIGNAL_ONLY',hardAccountFloorPath:'signal.hardAccountFloor',capitalLadderPath:'signal.capitalLadder',legacyNinetyDollarPauseThresholdAllowed:false,idleAccountLookupAllowed:false},
  stockBuys:{
    executionOwner:'CLAUDE',
    explicitApprovalRequired:false,
    automaticWhenFullyQualifiedAndBrokerPermits:true,
    appliesTo:['STOCK_A','STOCK_B','STOCK_SEED'],
    stockPriority:['A','B','SEED'],
    bTierUsesReducedEncodedSize:true,
    seedLaneUsesEncodedCap:true,
    requireRobinhoodTradingMcp:true,
    requireLiveBrokerRecheck:true,
    rule:'Qualified stock entries are automatic through Claude. Immediately before each submission, re-check freshness, price/max-entry/no-chase, buying power, account floor, portfolio heat, correlation, trade frequency, duplicate state, sizing and protection capability. Skip anything that no longer qualifies.'
  },
  crypto:{
    executionOwner:'CLAUDE',
    explicitApprovalRequired:false,
    automaticWhenFullyQualifiedAndBrokerPermits:true,
    directGitHubOrderSubmissionAllowed:false,
    requireRobinhoodTradingMcp:true,
    requireLiveBrokerRecheck:true,
    requireCurrentAdmissionGate:true,
    manualHoldingsIsolationRequired:true,
    rule:'Qualified crypto is automatic through Claude using the connected Robinhood Trading MCP. Re-check tradability, quote/spread, buying power, holdings, open orders, sizing and protection live immediately before submission. Manage only Teststock-attributable quantity.'
  },
  exits:{
    explicitApprovalRequired:false,
    automaticWhenDetectedAndBrokerPermits:true,
    appliesTo:['STOCK','OPTION','CRYPTO'],
    scope:['TRIGGER_1_STOP','TRIGGER_2_TARGET1','TRIGGER_3_TARGET2','CRYPTO_STOP','CRYPTO_TARGET','CRYPTO_TIME_EXIT','EMERGENCY_PROTECTION_EXIT']
  },
  brokerExecutionContract:{
    executor:'CLAUDE_ONLY',
    transport:'ROBINHOOD_TRADING_MCP',
    duplicateProtectionRequired:true,
    reconcileByClientOrderId:true,
    neverAssumeFill:true,
    partialFillsUseConfirmedQuantityOnly:true,
    protectionRequiredAfterEntry:true,
    ambiguousSubmissionRule:'Reconcile the original client order id and broker state before any retry.',
    unprotectedEntryRule:'If required protection cannot be established after a fill, use the safest currently authorized risk-reducing action.'
  },
  hardGuardsRemainMandatory:['funding lock','account floor','loss brakes','freshness/generation match','maximumEntry/no chase','spread/liquidity','gap guard','correlation/portfolio heat','trade frequency','protective-exit capability','no margin/leverage','no average down','no wider stops'],
  protectionReconciliation:{enabled:true,projectsOrDriveRequiredForWatchlistRead:false,idleRepairExceptionAllowed:true,neverInventLevels:true},
  idle:{normalReads:['docs/data/trigger-board.json','docs/data/execution-watchlist.json'],robinhoodCallsOnNormalIdle:false,rule:'If no actionable stock dispatch, qualified crypto execution, or protection repair exists, stop.'}
};

signal.autopilot={
  ...(signal.autopilot||{}),
  enabled:true,
  executionAgent:'CLAUDE',
  stockBuysRequireCurrentBatchApproval:false,
  stockBuysRequireUserApproval:false,
  cryptoBuysRequireUserApproval:false,
  automaticQualifiedStockBuys:true,
  automaticQualifiedCryptoBuys:true,
  automaticRiskReducingExits:true,
  directGitHubBrokerExecution:false,
  scope:'Dedicated Robinhood Agentic account only.'
};
delete signal.autopilot.preApprovedExactCandidateException;
signal.claudeExecutionPolicy=policy;
signal.schemaVersion=Math.max(36,Number(signal.schemaVersion||0));
signal.generatorIntegrity={
  ...(signal.generatorIntegrity||{}),
  traceableFeatures:{
    ...(signal.generatorIntegrity?.traceableFeatures||{}),
    claudeUnattendedExecutionPolicy:true,
    claudeSoleExecutionAgent:true,
    automaticStockExecution:true,
    automaticCryptoExecution:true,
    idleProtectionReconciliation:true,
    robinhoodTradingMcpExecution:true
  }
};

await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile(CLAUDE_SIGNAL,JSON.stringify(signal,null,2));
console.log('Applied fully automatic Claude execution policy: qualified stocks, qualified crypto and exits through Robinhood Trading MCP; no manual entry approval and no direct GitHub broker execution.');
