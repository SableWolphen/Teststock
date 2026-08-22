import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const CLAUDE_SIGNAL='docs/data/claude-signal.json';
const signal=JSON.parse(await fs.readFile(SIGNAL,'utf8'));

signal.executionArchitecture={
  version:4,
  mode:'TWO_TOURNAMENTS_ONLY',
  researchAuthority:'TESTSTOCK',
  tournaments:{
    stock:{
      enabled:true,
      source:'docs/data/stock-tournament.json',
      operatingMode:'CONTINUOUS_SCAN_SELECTIVE_INTRADAY_MULTI_POSITION',
      purpose:'Continuously scan during the stock session, rank contenders, execute independently qualified setups in priority order, and continue scanning even while other Teststock stock positions are open.',
      execution:'Claude uses Robinhood only for final broker-side verification of already-qualified Teststock candidates: price, buying power, positions/orders, spread, account/risk/protection guards, then requests the required per-order user approval and executes when permitted.',
      selectorRule:'Do not invent a different stock. Start with Teststock liveBuyChampion/current best qualified stock, then continue through already-qualified Teststock candidates in order. A filled winner does not make the remaining independently qualified candidates ineligible.',
      portfolioRule:'Multiple Teststock stock positions may be open concurrently. Recompute remaining cash, deployed capital, planned stop risk, correlation, frequency, protection and concurrent-position capacity after every fill. The published maximum is a ceiling, never a quota.',
      approvalRule:'Every new stock order requires its own exact user approval. One approval never authorizes a different ticker or a second order.',
      validationScope:'REGIME_SPECIFIC',
      validationRule:'A global entry-gate RED_FLAG does not freeze unrelated regimes. The CURRENT setup may proceed only when its current runtime regime policy has allowNewStocks=true. A blocked regime remains blocked; sparse regimes keep their reduced size.',
      activityRule:'Scan continuously on the configured schedules and take every independently qualified opportunity that survives all gates and its own user approval, subject to published cash/risk/frequency/concurrent-position limits. Never create trades merely to increase activity.',
      holdingRule:'Prefer same-day management for intraday setups. Overnight exposure requires an explicit current Teststock plan and verified protection; never hold overnight just to avoid a planned exit.'
    },
    crypto:{
      enabled:true,
      source:'docs/data/crypto-tournament.json',
      purpose:'Continuously research and rank supported crypto pairs using trend, confirmation, history, liquidity, BTC context and risk checks until the best qualified setup survives.',
      execution:'The direct Robinhood Crypto API lane uses the Teststock crypto winner/fallback and Robinhood live quote/account/order state for final execution checks. Claude is not required for overnight crypto execution.',
      selectorRule:'Do not invent a different crypto asset. Use the Teststock qualified crypto champion or an already-qualified fallback only.'
    }
  },
  liveDecisionPaths:['STOCK_TOURNAMENT','CRYPTO_TOURNAMENT'],
  disabledAssetClasses:['OPTION','FUTURES'],
  crossAssetSelection:false,
  rule:'Teststock decides what is worth considering through two independent tournaments. Robinhood is the live execution truth. Broker-side checks may reject a tournament candidate but may never replace it with an unranked idea or weaken Teststock gates.'
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
  perOrderApprovalRequired:true,
  overnightRequiresExplicitCurrentPlan:true,
  instructions:'Keep scanning during market hours even when one or more Teststock stocks are already open. A global validation RED_FLAG is diagnostic; block only the current regime when its runtime policy says allowNewStocks=false. Each new candidate must independently pass every Teststock and Robinhood gate and receive its own approval. Recompute remaining cash, portfolio stop risk, deployed capital, correlation, frequency and position capacity after every fill. Maximum positions are a ceiling, never a target. No strategy guarantees profit.'
};

signal.autopilot={...(signal.autopilot||{}),enabled:true,requiresPerOrderApproval:true,automaticQualifiedBuys:false,automaticRiskReducingExits:true,scope:'Dedicated Robinhood Agentic account for individually approved stock orders; direct Robinhood Crypto API lane for crypto.'};

if(signal.stockPlan){
  signal.stockPlan.eliteOption=null;
  signal.stockPlan.multiPositionExecution={enabled:true,continueScanningWhilePositionsOpen:true,perOrderApprovalRequired:true,selectionRule:'Evaluate all currently qualified candidates in Teststock rank order. A successful fill consumes portfolio capacity but does not terminate scanning or invalidate unrelated candidates.',portfolioRecheckAfterEveryFill:['non-margin cash','account equity/floor','max deployed capital','total planned stop risk','correlation/concentration','trade frequency','protection capability','concurrent-position capacity'],neverForceMaximumPositions:true};
  if(String(signal.stockPlan.overallAction||'').includes('OPTION')){
    const ready=(signal.stockPlan.stockCandidateQueue||[]).some(x=>x.action==='AUTO_BUY_ELIGIBLE');
    signal.stockPlan.overallAction=ready?'AUTO_BUY_STOCK_ELIGIBLE':'WAIT_FOR_TRIGGER';
    signal.stockPlan.reason=ready?'One or more qualified Teststock stock-tournament contenders are ready for live Robinhood verification.':'No stock-tournament contender is currently inside its valid entry range.';
  }
}
if(signal.capitalLadder?.tiers){signal.capitalLadder.tiers=signal.capitalLadder.tiers.map(t=>({...t,maxOptionRiskPct:0,newOptionsAllowed:false}));signal.capitalLadder.instructions='Select the current equity tier exactly as published. Apply its stock allocation multiplier, max deployed percentage and planned-stop-risk cap across all open/new positions. Options are disabled in the live Teststock architecture; crypto uses its own tournament and direct Robinhood Crypto API risk limits.';}
if(signal.tradeFrequencyGuard){signal.tradeFrequencyGuard.maxNewOptionsPerDay=0;signal.tradeFrequencyGuard.instructions='Apply the published total-position and crypto frequency ceilings as risk limits, never trade quotas. Multiple stock trades and concurrent stock positions are allowed only while every current account, cash, stop-risk, correlation, protection and frequency limit continues to pass. Options are disabled. Protective exits never count as new entries.';}
if(signal.executionQuality){signal.executionQuality.maxOptionSpreadPct=null;signal.executionQuality.instructions='Prefer limit orders when supported. Never pay above a saved maximum entry. Stocks must respect the stock spread cap; crypto must respect the crypto spread cap. A missed trade is better than a bad fill.';}
if(signal.probabilityFirstPolicy?.options){signal.probabilityFirstPolicy.options={enabled:false,liveDecisionPath:false,reason:'Options are disabled by TWO_TOURNAMENTS_ONLY.'};}
delete signal.crossAssetOpportunityRanking;
if(signal.systemHealth)delete signal.systemHealth.crossAssetRanking;
if(signal.exitAutomation){signal.exitAutomation.optionProtection=null;signal.exitAutomation.noProtectionNoEntry='New stock entries require the strongest supported verified protection under the current stock/fractional policy. Crypto entries use the direct Robinhood Crypto API protection path. Options are disabled.';}
signal.assetClassRouting={STOCK:'Use only current Teststock stock tournament qualified candidates. Claude performs final Robinhood verification and obtains a separate approval for each new stock order. Multiple independent stock positions may coexist.',CRYPTO:'Use only the current Teststock crypto tournament qualified champion and already-qualified crypto fallbacks. The direct Robinhood Crypto API performs live quote/account/order verification and execution.'};
if(signal.cryptoTournament){signal.cryptoTournament.brokerExecution={status:'DIRECT_API_ENABLED',lane:'GITHUB_ACTIONS_ROBINHOOD_CRYPTO_API',executableByDirectRobinhoodCryptoApi:true,executableByCurrentClaudeRobinhoodConnection:false,researchOnly:false,reason:'The dedicated GitHub Actions lane uses Robinhood Crypto API credentials for live quote, account, order and protection checks without relying on Claude crypto tools.'};signal.cryptoTournament.researchOnlyUntilBrokerExecutionAvailable=false;}
if(Array.isArray(signal.hardRules)){
  signal.hardRules=signal.hardRules.filter(x=>!String(x).toLowerCase().includes('option'));
  signal.hardRules.push('LIVE ASSET SCOPE: only STOCK and CRYPTO are eligible. Options and futures are disabled.');
  signal.hardRules.push('TOURNAMENT AUTHORITY: do not invent a symbol outside the current Teststock stock or crypto tournament qualified set. Robinhood live checks may reject a candidate but may not substitute an unranked idea.');
  signal.hardRules.push('REGIME-SPECIFIC VALIDATION: do not freeze all stock trading merely because the aggregate entry-gate validation status is RED_FLAG. The current setup may proceed only when its runtime regime policy explicitly allows new stocks.');
  signal.hardRules.push('MULTI-STOCK PORTFOLIO: a tournament winner has first priority, not exclusivity. Continue scanning/evaluating other independently qualified stocks while positions are open, subject to all portfolio limits. Never force the portfolio to its maximum.');
  signal.hardRules.push('STOCK APPROVAL: Claude must obtain separate approval for the exact ticker, amount, entry, stop and targets of every new stock order. Risk-reducing exits may remain automatic when verified.');
}
if(signal.claudeExecutionPolicy?.buys){signal.claudeExecutionPolicy.buys.appliesTo=['STOCK_A','STOCK_B'];signal.claudeExecutionPolicy.buys.explicitApprovalRequired=true;signal.claudeExecutionPolicy.buys.automaticWhenFullyQualifiedAndBrokerPermits=false;signal.claudeExecutionPolicy.buys.rule='For stocks, evaluate the current Teststock tournament qualified queue in order, A before B. Require each candidate current runtime regime policy to allow new stocks. Use Robinhood only for final live verification. Ask for a separate exact approval for each candidate that survives. After an approved fill, recompute remaining portfolio capacity and continue to later qualified candidates when capacity remains. Do not invent a different stock. Crypto execution is handled by the separate direct Robinhood Crypto API lane.';}

signal.schemaVersion=Math.max(41,Number(signal.schemaVersion||0));
const traceableFeatures={...(signal.generatorIntegrity?.traceableFeatures||{})};delete traceableFeatures.crossAssetOpportunityRanking;delete traceableFeatures.wholeContractOptionSizing;
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...traceableFeatures,twoTournamentArchitecture:true,regimeSpecificStockValidation:true,selectiveIntradayStockMode:true,multiStockConcurrentPortfolio:true,perOrderStockApproval:true}};

await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile(CLAUDE_SIGNAL,JSON.stringify(signal,null,2));
console.log('Applied two-tournament architecture with regime-specific multi-stock selective intraday execution.');
