import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const CLAUDE_SIGNAL='docs/data/claude-signal.json';
const signal=JSON.parse(await fs.readFile(SIGNAL,'utf8'));

const policy={
  enabled:true,
  role:'SOLE_EXECUTION_AGENT',
  schedule:{
    cron:'0 13-21 * * 1-5',
    timezone:'UTC',
    expectedObservedFireMinuteApprox:5,
    expectedObservedTimesUtc:['13:05','14:05','15:05','16:05','17:05','18:05','19:05','20:05','21:05'],
    easternDaylightApprox:'09:05-17:05 ET',
    note:'Claude is the execution agent. Stock checks may be scheduled during market hours; crypto must also be checked by the external Claude runtime often enough for 24/7 execution. Platform scheduling may drift.'
  },
  checkIsNotTrade:true,
  triggerBoardFirst:true,
  triggerBoardPath:'docs/data/trigger-board.json',
  executionWatchlistPath:'docs/data/execution-watchlist.json',
  dispatchPath:'docs/data/execution-dispatch.json',
  cryptoPlanPaths:['docs/data/crypto-plan-50.json','docs/data/crypto-plan-100.json','docs/data/crypto-plan-200.json','docs/data/crypto-plan-500.json'],
  cryptoAdmissionPath:'docs/data/crypto-profitability-admission.json',
  cryptoCrossCheckPath:'docs/data/crypto-robinhood-cross-check.json',
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
    appliesTo:['STOCK','OPTION','CRYPTO'],
    scope:['TRIGGER_1_STOP','TRIGGER_2_TARGET1','TRIGGER_3_TARGET2','CRYPTO_STOP','CRYPTO_TARGET','CRYPTO_TIME_EXIT','EMERGENCY_PROTECTION_EXIT'],
    rule:'Claude executes verified risk-reducing exits and validated profit-taking without a new user approval. Claude must verify the live broker position, trigger, quantity, order state and current exit policy before submitting or cancelling an order.'
  },
  stockBuys:{
    explicitApprovalRequired:true,
    automaticWhenFullyQualifiedAndBrokerPermits:false,
    batchApprovalAllowed:true,
    approvalScope:'CURRENT_EXACT_DISPATCH_ONLY',
    appliesTo:['STOCK_A','STOCK_B'],
    stockPriority:['A','B'],
    bTierUsesReducedEncodedSize:true,
    perFutureOrderStandingApprovalAllowed:false,
    rule:'A current-generation stock BUY trigger may be proposed only after every Teststock hard guard and required live Robinhood check passes. One user approval may authorize all exact stock candidates listed in the current approval batch only. Before each broker submission Claude must re-check that candidate live, atomically claim its fingerprint, recompute remaining cash/risk/correlation/capacity and skip anything that no longer qualifies. The approval never carries to a later batch or a newly discovered ticker.'
  },
  crypto:{
    executionOwner:'CLAUDE',
    explicitApprovalRequired:false,
    automaticWhenFullyQualifiedAndBrokerPermits:true,
    directGitHubOrderSubmissionAllowed:false,
    requireOfficialRobinhoodCryptoApi:true,
    requireCurrentAdmissionGate:true,
    requireFreshCrossCheck:true,
    manualHoldingsIsolationRequired:true,
    rule:'Crypto is fully automatic through Claude. Teststock research and GitHub may discover, rank, monitor and publish read-only Robinhood cross-checks, but they must not submit crypto orders directly. When a crypto candidate passes every current Teststock hard gate, admission/seed rule, freshness, spread/liquidity, no-chase, buying-power and Robinhood tradability check, Claude submits the buy through the approved Robinhood Crypto API tool/runtime, verifies the actual fill, establishes protection, and manages only Teststock-attributable quantity. Manual holdings and manual orders must never be adopted, cancelled or sold by Teststock.'
  },
  brokerExecutionContract:{
    executor:'CLAUDE_ONLY',
    duplicateProtectionRequired:true,
    reconcileByClientOrderId:true,
    neverAssumeFill:true,
    partialFillsUseConfirmedQuantityOnly:true,
    protectionRequiredAfterEntry:true,
    ambiguousSubmissionRule:'Do not resubmit an uncertain order as a new order. Reconcile the original client order id and broker state first.',
    unprotectedEntryRule:'If required protection cannot be established for a newly filled position, use the safest policy-authorized risk-reducing action rather than leaving the position knowingly unprotected.'
  },
  hardGuardsRemainMandatory:[
    'funding lock','account floor','loss brakes','freshness/generation match','maximumEntry/no chase','spread/liquidity','gap guard','correlation/portfolio heat','trade frequency','protective-exit capability','fractional-monitor health','no margin/leverage','no average down','no wider stops'
  ],
  idle:{
    normalReads:['docs/data/trigger-board.json','docs/data/execution-watchlist.json'],
    robinhoodCallsOnNormalIdle:false,
    rule:'If no actionable stock dispatch exists, no qualified crypto execution exists, and no protection-repair condition exists, stop without broad market research or unnecessary broker calls.'
  }
};

signal.autopilot={
  ...(signal.autopilot||{}),
  enabled:true,
  executionAgent:'CLAUDE',
  stockBuysRequireCurrentBatchApproval:true,
  cryptoBuysRequireUserApproval:false,
  automaticQualifiedCryptoBuys:true,
  automaticRiskReducingExits:true,
  directGitHubBrokerExecution:false,
  scope:'Dedicated Robinhood Agentic account only.'
};
delete signal.autopilot.preApprovedExactCandidateException;
signal.claudeExecutionPolicy=policy;
signal.schemaVersion=Math.max(35,Number(signal.schemaVersion||0));
const traceableFeatures={...(signal.generatorIntegrity?.traceableFeatures||{})};
delete traceableFeatures.claudeHourlyApprovalPolicy;
traceableFeatures.claudeUnattendedExecutionPolicy=true;
traceableFeatures.claudeSoleExecutionAgent=true;
traceableFeatures.idleProtectionReconciliation=true;
signal.generatorIntegrity={
  ...(signal.generatorIntegrity||{}),
  traceableFeatures
};

await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile(CLAUDE_SIGNAL,JSON.stringify(signal,null,2));
console.log('Applied Claude sole-execution policy: stocks require exact current-batch approval; crypto entries/exits are automatic through Claude; GitHub research/monitoring never submits broker orders directly.');
