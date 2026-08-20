import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const CLAUDE_SIGNAL='docs/data/claude-signal.json';
const signal=JSON.parse(await fs.readFile(SIGNAL,'utf8'));

const policy={
  enabled:true,
  schedule:{
    cron:'0 13-21 * * 1-5',
    timezone:'UTC',
    expectedObservedFireMinuteApprox:5,
    expectedObservedTimesUtc:['13:05','14:05','15:05','16:05','17:05','18:05','19:05','20:05','21:05'],
    easternDaylightApprox:'09:05-17:05 ET',
    note:'The Claude scheduled task is expected to check roughly hourly. Actual platform scheduling can drift; never assume an exact second/minute.'
  },
  checkIsNotTrade:true,
  triggerBoardFirst:true,
  triggerBoardPath:'docs/data/trigger-board.json',
  dispatchPath:'docs/data/execution-dispatch.json',
  sourceOfTruth:'LATEST_RAW_MAIN',
  generationMatchRequired:true,
  generationRule:'Before acting, fetch the newest raw-main trigger/dispatch and signal. A BUY may proceed only when the event belongs to the current active signal generation. If generation ids/timestamps conflict, do not submit new risk and re-fetch.',
  exits:{
    explicitApprovalRequired:false,
    automaticWhenDetectedAndBrokerPermits:true,
    scope:['TRIGGER_1_STOP','TRIGGER_2_TARGET1','TRIGGER_3_TARGET2'],
    rule:'Risk-reducing exits and validated profit-taking may execute without a new user approval when the live Robinhood position, trigger, quantity, order state and current exit policy are verified.'
  },
  buys:{
    explicitApprovalRequired:true,
    appliesTo:['STOCK_A','STOCK_B','CRYPTO','OPTION'],
    preApprovedExactCandidateException:true,
    approvalMustMatch:['assetClass','ticker','entryOrMaximumEntry','plannedDollarAmountOrRisk','stop','signalGeneration'],
    proposalOnlyUntilApproved:true,
    rule:'A qualifying new buy is proposed at the hourly check. Do not submit it until the user explicitly approves that specific current trade, unless the journal already contains a still-valid explicit pre-approval matching the exact candidate numbers and current generation.'
  },
  idle:{
    rule:'If no actionable dispatch exists, stop immediately without Robinhood market work or full market analysis.'
  }
};

signal.autopilot={
  ...(signal.autopilot||{}),
  enabled:true,
  requiresPerOrderApproval:true,
  automaticRiskReducingExits:true,
  preApprovedExactCandidateException:true,
  scope:'Dedicated Robinhood Agentic account only.'
};
signal.claudeExecutionPolicy=policy;
signal.schemaVersion=Math.max(32,Number(signal.schemaVersion||0));
signal.generatorIntegrity={
  ...(signal.generatorIntegrity||{}),
  traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),claudeHourlyApprovalPolicy:true}
};

await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile(CLAUDE_SIGNAL,JSON.stringify(signal,null,2));
console.log('Applied Claude hourly approval policy: hourly checks, automatic verified exits, explicit approval for new buys.');
