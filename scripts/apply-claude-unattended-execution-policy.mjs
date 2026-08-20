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
    note:'Claude performs low-credit hourly check-ins. Platform scheduling may drift; never assume an exact second or minute.'
  },
  checkIsNotTrade:true,
  triggerBoardFirst:true,
  triggerBoardPath:'docs/data/trigger-board.json',
  executionWatchlistPath:'docs/data/execution-watchlist.json',
  dispatchPath:'docs/data/execution-dispatch.json',
  sourceOfTruth:'LATEST_RAW_MAIN',
  generationMatchRequired:true,
  generationRule:'Before acting, fetch the newest raw-main trigger/dispatch and signal. Any new-risk order may proceed only when the event belongs to the current active signal generation. If generation ids/timestamps conflict, re-fetch and do not submit new risk until they match.',
  accountGuardrailSource:{
    source:'CURRENT_RAW_MAIN_SIGNAL_ONLY',
    hardAccountFloorPath:'signal.hardAccountFloor',
    capitalLadderPath:'signal.capitalLadder',
    legacyNinetyDollarPauseThresholdAllowed:false,
    idleAccountLookupAllowed:false,
    rule:'Never use a remembered or hard-coded $90 pause threshold. On a real execution or protection-repair run, fetch the current raw-main signal and use its current hardAccountFloor/capitalLadder/circuit-breaker values. On a normal idle heartbeat, do not query Robinhood merely to calculate account-floor status.'
  },
  protectionReconciliation:{
    enabled:true,
    watchlistIsPublicSavedTriggerSource:true,
    projectsOrDriveRequiredForWatchlistRead:false,
    idleRepairExceptionAllowed:true,
    idleRepairTriggers:[
      'ACTIVE watchlist position missing required saved stop/targets',
      'watchlist contradicts a previously reported live holding',
      'prior run explicitly reported UNPROTECTED or UNRECONCILED live position'
    ],
    minimumBrokerReadScope:['live position for affected ticker','open sell/protective orders for affected ticker'],
    noGeneralAccountSweep:true,
    neverInventLevels:true,
    fractionalArmingRule:'An ACTIVE watchlist record with saved levels plus a healthy <=5-minute trigger monitor means GitHub-side synthetic monitoring is armed. It is not broker-resident stop protection.',
    missingPlanRule:'Recover levels only from trustworthy existing Teststock/GitHub history. If no saved invalidation can be recovered, open no new risk and use only risk-reducing actions actually authorized by current policy and supported by Robinhood.',
    writeFailureRule:'If GitHub write capability is unavailable, never claim the watchlist was changed. Existing raw-main watchlist data may still prove prior arming.'
  },
  exits:{
    explicitApprovalRequired:false,
    automaticWhenDetectedAndBrokerPermits:true,
    scope:['TRIGGER_1_STOP','TRIGGER_2_TARGET1','TRIGGER_3_TARGET2'],
    rule:'Risk-reducing exits and validated profit-taking execute without a new user approval when the live Robinhood position, trigger, quantity, order state and current exit policy are verified.'
  },
  buys:{
    explicitApprovalRequired:false,
    automaticWhenFullyQualifiedAndBrokerPermits:true,
    appliesTo:['STOCK_A','STOCK_B','CRYPTO','OPTION'],
    stockPriority:['A','B'],
    bTierUsesReducedEncodedSize:true,
    manualApprovalStepRemoved:true,
    rule:'A current-generation BUY trigger may execute automatically without asking the user again when every Teststock hard guard and every required live Robinhood check passes. Use A/ELITE before B/BEST_ACCEPTABLE. B uses only its reduced encoded size. If the top candidate fails before order submission, try the next already-qualified fallback in the same run. Never create a trade by weakening a hard gate.'
  },
  hardGuardsRemainMandatory:[
    'funding lock','account floor','loss brakes','freshness/generation match','maximumEntry/no chase','spread/liquidity','gap guard','correlation/portfolio heat','trade frequency','protective-exit capability','fractional-monitor health','no margin/leverage','no average down','no wider stops'
  ],
  idle:{
    normalReads:['docs/data/trigger-board.json','docs/data/execution-watchlist.json'],
    robinhoodCallsOnNormalIdle:false,
    rule:'If no actionable dispatch exists and no protection-repair condition exists, stop immediately after the two small raw-main reads without Robinhood market/account work or full market analysis.'
  }
};

signal.autopilot={
  ...(signal.autopilot||{}),
  enabled:true,
  requiresPerOrderApproval:false,
  automaticQualifiedBuys:true,
  automaticRiskReducingExits:true,
  scope:'Dedicated Robinhood Agentic account only.'
};
delete signal.autopilot.preApprovedExactCandidateException;
signal.claudeExecutionPolicy=policy;
signal.schemaVersion=Math.max(34,Number(signal.schemaVersion||0));
const traceableFeatures={...(signal.generatorIntegrity?.traceableFeatures||{})};
delete traceableFeatures.claudeHourlyApprovalPolicy;
traceableFeatures.claudeUnattendedExecutionPolicy=true;
traceableFeatures.idleProtectionReconciliation=true;
signal.generatorIntegrity={
  ...(signal.generatorIntegrity||{}),
  traceableFeatures
};

await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile(CLAUDE_SIGNAL,JSON.stringify(signal,null,2));
console.log('Applied Claude unattended execution policy: two-read idle path, protection repair exception, current-signal guardrails, automatic qualified buys and exits.');
