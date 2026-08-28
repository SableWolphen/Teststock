import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const CLAUDE_SIGNAL='docs/data/claude-signal.json';
const signal=JSON.parse(await fs.readFile(SIGNAL,'utf8'));

signal.executionArchitecture={
  version:5,
  mode:'TWO_TOURNAMENTS_ONLY',
  researchAuthority:'TESTSTOCK',
  tournaments:{
    stock:{
      enabled:true,
      source:'docs/data/stock-tournament.json',
      operatingMode:'CONTINUOUS_SCAN_SELECTIVE_INTRADAY_MULTI_POSITION',
      purpose:'Continuously scan during the stock session, rank contenders, execute independently qualified setups in priority order, and continue scanning even while other Teststock stock positions are open.',
      execution:'Claude uses the authenticated Robinhood Trading MCP for final broker-side verification of already-qualified Teststock candidates and automatically submits qualified stock orders when every Teststock and live broker guard passes.',
      selectorRule:'Do not invent a different stock. Start with the current Teststock liveBuyChampion/current best qualified stock, then continue through already-qualified Teststock candidates in order. A filled winner does not make the remaining independently qualified candidates ineligible.',
      portfolioRule:'Multiple Teststock stock positions may be open concurrently. Recompute remaining cash, deployed capital, planned stop risk, correlation, frequency, protection and concurrent-position capacity after every fill. The published maximum is a ceiling, never a quota.',
      approvalRule:'No manual approval is required for qualified stock entries. Claude may submit only candidates that Teststock already marked executable and that still pass every live broker and risk check immediately before submission.',
      validationScope:'REGIME_SPECIFIC',
      validationRule:'A global entry-gate RED_FLAG does not freeze unrelated regimes. The current setup may proceed only when its current runtime regime policy has allowNewStocks=true. A blocked regime remains blocked; sparse regimes keep their reduced size.',
      activityRule:'Scan continuously on the configured schedules and take every independently qualified opportunity that survives all gates, subject to published cash/risk/frequency/concurrent-position limits. Never create trades merely to increase activity.',
      holdingRule:'Prefer same-day management for intraday setups. Overnight exposure requires an explicit current Teststock plan and verified protection; never hold overnight just to avoid a planned exit.'
    },
    crypto:{
      enabled:true,
      source:'docs/data/crypto-tournament.json',
      purpose:'Continuously research and rank supported crypto pairs using trend, confirmation, history, liquidity, BTC context and risk checks until the best qualified setup survives.',
      execution:'Claude uses the authenticated Robinhood Trading MCP for final live quote, tradability, buying-power, holdings, open-order, sizing, duplicate-protection and protection checks, then automatically executes the Teststock qualified crypto champion or already-qualified fallback when every gate passes.',
      selectorRule:'Do not invent a different crypto asset. Use the Teststock qualified crypto champion or an already-qualified fallback only.'
    }
  },
  liveDecisionPaths:['STOCK_TOURNAMENT','CRYPTO_TOURNAMENT'],
  disabledAssetClasses:['FUTURES'],
  crossAssetSelection:false,
  rule:'Teststock decides what is worth considering through two independent tournaments. Robinhood Trading MCP is the live execution truth. Broker-side checks may reject a tournament candidate but may never replace it with an unranked idea or weaken Teststock gates.'
};

signal.intradayStockPolicy={
  enabled:true,
  mode:'CONTINUOUS_SCAN_SELECTIVE_MULTI_POSITION_TRADING',
  objective:'Seek multiple independent short-duration stock opportunities during the regular session while preserving capital through regime-specific validation, live execution checks, predefined exits and portfolio-level frequency/risk ceilings.',
  systemWideEntryPauseFromGlobalValidationStatus:false,
  regimeSpecificValidationRequired:true,
  sameDayPreferred:true,
  forcedTradeQuota:false,
  multipleConcurrentPositionsAllowed:true,
  continueScanningWhilePositionsOpen:true,
  perOrderApprovalRequired:false,
  overnightRequiresExplicitCurrentPlan:true,
  instructions:'Keep scanning during market hours even when one or more Teststock stocks are already open. A global validation RED_FLAG is diagnostic; block only the current regime when its runtime policy says allowNewStocks=false. Each new candidate must independently pass every Teststock and Robinhood MCP gate. Recompute remaining cash, portfolio stop risk, deployed capital, correlation, frequency and position capacity after every fill. Maximum positions are a ceiling, never a target. No strategy guarantees profit.'
};

signal.autopilot={...(signal.autopilot||{}),enabled:true,requiresPerOrderApproval:false,automaticQualifiedBuys:true,automaticQualifiedStockBuys:true,automaticQualifiedCryptoBuys:true,automaticRiskReducingExits:true,scope:'Dedicated Robinhood Agentic account; qualified stock and crypto entries plus risk-reducing exits execute through Claude and the authenticated Robinhood Trading MCP.'};

if(signal.stockPlan){
  signal.stockPlan.multiPositionExecution={enabled:true,continueScanningWhilePositionsOpen:true,perOrderApprovalRequired:false,selectionRule:'Evaluate all currently qualified candidates in Teststock rank order. A successful fill consumes portfolio capacity but does not terminate scanning or invalidate unrelated candidates.',portfolioRecheckAfterEveryFill:['non-margin cash','account equity/floor','max deployed capital','total planned stop risk','correlation/concentration','trade frequency','protection capability','concurrent-position capacity'],neverForceMaximumPositions:true};
}
if(signal.capitalLadder){signal.capitalLadder.instructions='Select the current equity tier exactly as published. Apply its stock allocation multiplier, max deployed percentage and planned-stop-risk cap across all open/new positions. Options use that same tier\'s maxOptionRiskPct and require newOptionsAllowed=true plus every eliteOption and live-evidence check; crypto uses its own tournament and Claude Robinhood Trading MCP risk limits.';}
if(signal.tradeFrequencyGuard){signal.tradeFrequencyGuard.instructions='Apply the published total-position and crypto frequency ceilings as risk limits, never trade quotas. Multiple stock trades and concurrent stock positions are allowed only while every current account, cash, stop-risk, correlation, protection and frequency limit continues to pass. Options remain capped at one new position per day and require every eliteOption, whole-contract and live-evidence check. Protective exits never count as new entries.';}
if(signal.executionQuality){signal.executionQuality.instructions='Prefer limit orders when supported. Never pay above a saved maximum entry. Stocks must respect the stock spread cap, options must respect the option spread cap, and crypto must respect the crypto spread cap. A missed trade is better than a bad fill.';}
delete signal.crossAssetOpportunityRanking;
if(signal.systemHealth)delete signal.systemHealth.crossAssetRanking;
if(signal.exitAutomation){signal.exitAutomation.noProtectionNoEntry='New stock or option entries require the strongest supported verified protection under the current stock/fractional/option policy. Crypto entries require the strongest supported verified protection through the Robinhood Trading MCP.';}
signal.assetClassRouting={STOCK:'Use only current Teststock stock tournament qualified candidates. Claude performs final Robinhood Trading MCP verification and automatically executes qualified stock entries when all gates pass.',OPTION:'Use only stockPlan.eliteOption, only after its runtime whole-contract check passes, and only after Claude independently confirms the live Teststock real-fill evidence gate against actual Robinhood option order history. Options remain exceptional and require separate explicit approval unless a later policy explicitly changes that.',CRYPTO:'Use only the current Teststock crypto tournament qualified champion and already-qualified crypto fallbacks. Claude performs final Robinhood Trading MCP verification and automatically executes qualified crypto entries when all gates pass.'};
if(signal.cryptoTournament){
  signal.cryptoTournament.brokerExecution={...(signal.cryptoTournament.brokerExecution||{}),status:'CLAUDE_ROBINHOOD_TRADING_MCP',lane:'CLAUDE_ROBINHOOD_TRADING_MCP',executableByDirectRobinhoodCryptoApi:false,directGitHubOrderSubmissionAllowed:false,executableByCurrentClaudeRobinhoodConnection:true,requiresAuthenticatedRobinhoodTradingMcp:true,researchOnly:false,reason:'Claude is the sole execution agent. GitHub research and monitoring never submit broker orders directly.'};
  signal.cryptoTournament.researchOnlyUntilBrokerExecutionAvailable=false;
}
if(Array.isArray(signal.hardRules)){
  signal.hardRules=signal.hardRules.filter(x=>!String(x).startsWith('STOCK APPROVAL:'));
  signal.hardRules.push('LIVE ASSET SCOPE: only STOCK, OPTION and CRYPTO are eligible. Futures are disabled.');
  signal.hardRules.push('TOURNAMENT AUTHORITY: do not invent a symbol outside the current Teststock stock or crypto tournament qualified set. Robinhood live checks may reject a candidate but may not substitute an unranked idea.');
  signal.hardRules.push('REGIME-SPECIFIC VALIDATION: do not freeze all stock trading merely because the aggregate entry-gate validation status is RED_FLAG. The current setup may proceed only when its runtime regime policy explicitly allows new stocks.');
  signal.hardRules.push('MULTI-STOCK PORTFOLIO: a tournament winner has first priority, not exclusivity. Continue scanning/evaluating other independently qualified stocks while positions are open, subject to all portfolio limits. Never force the portfolio to its maximum.');
  signal.hardRules.push('AUTOMATIC STOCK EXECUTION: Claude may automatically submit only Teststock-qualified stock entries that still pass all current live Robinhood MCP, freshness, no-chase, buying-power, sizing, duplicate, correlation, portfolio-risk and protection checks immediately before submission.');
  signal.hardRules.push('AUTOMATIC CRYPTO EXECUTION: Claude may automatically submit only the Teststock qualified crypto champion or already-qualified fallbacks that still pass all current live Robinhood MCP, freshness, liquidity, spread, no-chase, buying-power, sizing, duplicate and protection checks immediately before submission.');
  signal.hardRules.push('OPTION APPROVAL: options are exceptional, not default, and live only inside stockPlan.eliteOption -- never a third tournament. Claude must obtain its own separate approval for the exact contract, expiry, strike, quantity and max risk of any option order, only after every eliteOption research check, the runtime whole-contract sizing check, and the real-fill evidence gate all pass. Options remain capped at one new position per day.');
}
if(signal.claudeExecutionPolicy?.buys){
  signal.claudeExecutionPolicy.buys.appliesTo=['STOCK_A','STOCK_B','CRYPTO'];
  signal.claudeExecutionPolicy.buys.explicitApprovalRequired=false;
  signal.claudeExecutionPolicy.buys.automaticWhenFullyQualifiedAndBrokerPermits=true;
  signal.claudeExecutionPolicy.buys.rule='For stocks and crypto, evaluate only current Teststock-qualified candidates in rank order. Require every current Teststock hard gate and every live Robinhood Trading MCP verification to pass immediately before submission. No manual approval is required. Do not invent a different symbol, exceed encoded size, chase price, duplicate an order, use margin/leverage, average down, or bypass required protection.';
}

signal.schemaVersion=Math.max(43,Number(signal.schemaVersion||0));
const traceableFeatures={...(signal.generatorIntegrity?.traceableFeatures||{})};
delete traceableFeatures.crossAssetOpportunityRanking;
delete traceableFeatures.perOrderStockApproval;
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...traceableFeatures,twoTournamentArchitecture:true,regimeSpecificStockValidation:true,selectiveIntradayStockMode:true,multiStockConcurrentPortfolio:true,automaticQualifiedStockBuys:true,automaticQualifiedCryptoBuys:true,claudeRobinhoodTradingMcpExecution:true,perOrderOptionApproval:true,wholeContractOptionSizing:true,optionLiveEvidenceGate:true}};

await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile(CLAUDE_SIGNAL,JSON.stringify(signal,null,2));
console.log('Applied two-tournament architecture with fully automatic Claude Robinhood MCP execution for qualified stocks and crypto; options remain separately approval-gated.');
