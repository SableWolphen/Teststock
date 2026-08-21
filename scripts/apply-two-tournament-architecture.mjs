import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const CLAUDE_SIGNAL='docs/data/claude-signal.json';
const signal=JSON.parse(await fs.readFile(SIGNAL,'utf8'));

signal.executionArchitecture={
  version:3,
  mode:'TWO_TOURNAMENTS_ONLY',
  researchAuthority:'TESTSTOCK',
  tournaments:{
    stock:{
      enabled:true,
      source:'docs/data/stock-tournament.json',
      operatingMode:'CONTINUOUS_SCAN_SELECTIVE_INTRADAY',
      purpose:'Continuously scan during the stock session, research and rank contenders until the best currently qualified setup survives, retain already-qualified fallbacks, and resume scanning after each completed/rejected setup.',
      execution:'Claude uses Robinhood only for final broker-side verification of the Teststock winner/fallback: price, buying power, positions/orders, spread, account/risk/protection guards, then requests the required user approval and executes when permitted.',
      selectorRule:'Do not invent a different stock. Start with Teststock liveBuyChampion/current best qualified stock; if it fails a live Robinhood guard, try the next already-qualified Teststock fallback in order.',
      validationScope:'REGIME_SPECIFIC',
      validationRule:'A global entry-gate RED_FLAG does not freeze unrelated regimes. The CURRENT setup may proceed only when its current runtime regime policy has allowNewStocks=true. A blocked regime remains blocked; sparse regimes keep their reduced size.',
      activityRule:'Scan continuously on the configured schedules and take every independently qualified opportunity that survives all gates and user approval, subject to published cash/risk/frequency limits. Never create trades merely to increase activity.',
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
  rule:'Teststock decides what is worth considering through two independent tournaments. Robinhood is the live execution truth. Broker-side checks may reject a tournament winner but may never replace it with an unranked idea or weaken Teststock gates.'
};

signal.intradayStockPolicy={
  enabled:true,
  mode:'CONTINUOUS_SCAN_SELECTIVE_TRADING',
  objective:'Seek short-duration stock opportunities during the regular session while preserving capital through regime-specific validation, live execution checks, predefined exits and frequency/risk ceilings.',
  systemWideEntryPauseFromGlobalValidationStatus:false,
  regimeSpecificValidationRequired:true,
  sameDayPreferred:true,
  forcedTradeQuota:false,
  overnightRequiresExplicitCurrentPlan:true,
  instructions:'Keep scanning during market hours. A global validation RED_FLAG is diagnostic; block only the current regime when its runtime policy says allowNewStocks=false. When the current regime is allowed, continue through every other Teststock and Robinhood gate. Multiple same-day trades are permitted only within all published account, cash, stop-risk, correlation and frequency limits. No strategy guarantees profit.'
};

signal.autopilot={
  ...(signal.autopilot||{}),
  enabled:true,
  requiresPerOrderApproval:true,
  automaticQualifiedBuys:false,
  automaticRiskReducingExits:true,
  scope:'Dedicated Robinhood Agentic account for approved stock orders; direct Robinhood Crypto API lane for crypto.'
};

if(signal.stockPlan){
  signal.stockPlan.eliteOption=null;
  if(String(signal.stockPlan.overallAction||'').includes('OPTION')){
    const ready=(signal.stockPlan.stockCandidateQueue||[]).some(x=>x.action==='AUTO_BUY_ELIGIBLE');
    signal.stockPlan.overallAction=ready?'AUTO_BUY_STOCK_ELIGIBLE':'WAIT_FOR_TRIGGER';
    signal.stockPlan.reason=ready?'A qualified Teststock stock-tournament contender is ready for live Robinhood verification.':'No stock-tournament contender is currently inside its valid entry range.';
  }
}
if(signal.capitalLadder?.tiers){
  signal.capitalLadder.tiers=signal.capitalLadder.tiers.map(t=>({...t,maxOptionRiskPct:0,newOptionsAllowed:false}));
  signal.capitalLadder.instructions='Select the current equity tier exactly as published. Apply its stock allocation multiplier, max deployed percentage and planned-stop-risk cap. Options are disabled in the live Teststock architecture; crypto uses its own tournament and direct Robinhood Crypto API risk limits.';
}
if(signal.tradeFrequencyGuard){
  signal.tradeFrequencyGuard.maxNewOptionsPerDay=0;
  signal.tradeFrequencyGuard.instructions='Apply the published total-position and crypto frequency ceilings as risk limits, never trade quotas. Multiple stock trades in one day are allowed only while all current limits and live gates continue to pass. Options are disabled. Protective exits never count as new entries.';
}
if(signal.executionQuality){
  signal.executionQuality.maxOptionSpreadPct=null;
  signal.executionQuality.instructions='Prefer limit orders when supported. Never pay above a saved maximum entry. Stocks must respect the stock spread cap; crypto must respect the crypto spread cap. A missed trade is better than a bad fill.';
}
if(signal.probabilityFirstPolicy?.options){
  signal.probabilityFirstPolicy.options={enabled:false,liveDecisionPath:false,reason:'Options are disabled by TWO_TOURNAMENTS_ONLY.'};
}
delete signal.crossAssetOpportunityRanking;
if(signal.systemHealth)delete signal.systemHealth.crossAssetRanking;
if(signal.exitAutomation){
  signal.exitAutomation.optionProtection=null;
  signal.exitAutomation.noProtectionNoEntry='New stock entries require the strongest supported verified protection under the current stock/fractional policy. Crypto entries use the direct Robinhood Crypto API protection path. Options are disabled.';
}
signal.assetClassRouting={
  STOCK:'Use only the current Teststock stock tournament winner and already-qualified stock fallbacks. Claude performs final Robinhood verification before an approved stock order.',
  CRYPTO:'Use only the current Teststock crypto tournament qualified champion and already-qualified crypto fallbacks. The direct Robinhood Crypto API performs live quote/account/order verification and execution.'
};
if(signal.cryptoTournament){
  signal.cryptoTournament.brokerExecution={
    status:'DIRECT_API_ENABLED',
    lane:'GITHUB_ACTIONS_ROBINHOOD_CRYPTO_API',
    executableByDirectRobinhoodCryptoApi:true,
    executableByCurrentClaudeRobinhoodConnection:false,
    researchOnly:false,
    reason:'The dedicated GitHub Actions lane uses Robinhood Crypto API credentials for live quote, account, order and protection checks without relying on Claude crypto tools.'
  };
  signal.cryptoTournament.researchOnlyUntilBrokerExecutionAvailable=false;
}
if(Array.isArray(signal.hardRules)){
  signal.hardRules=signal.hardRules.filter(x=>!String(x).toLowerCase().includes('option'));
  signal.hardRules.push('LIVE ASSET SCOPE: only STOCK and CRYPTO are eligible. Options and futures are disabled.');
  signal.hardRules.push('TOURNAMENT AUTHORITY: do not invent a symbol outside the current Teststock stock or crypto tournament winner/fallback set. Robinhood live checks may reject a winner but may not substitute an unranked idea.');
  signal.hardRules.push('REGIME-SPECIFIC VALIDATION: do not freeze all stock trading merely because the aggregate entry-gate validation status is RED_FLAG. The current setup may proceed only when its runtime regime policy explicitly allows new stocks.');
  signal.hardRules.push('STOCK APPROVAL: Claude must ask the user to approve the exact verified Teststock stock winner/fallback before submitting a new stock buy. Risk-reducing exits may remain automatic when verified.');
}
if(signal.claudeExecutionPolicy?.buys){
  signal.claudeExecutionPolicy.buys.appliesTo=['STOCK_A','STOCK_B'];
  signal.claudeExecutionPolicy.buys.explicitApprovalRequired=true;
  signal.claudeExecutionPolicy.buys.automaticWhenFullyQualifiedAndBrokerPermits=false;
  signal.claudeExecutionPolicy.buys.rule='For stocks, start with the current Teststock tournament winner, A before B. Require the CURRENT runtime regime policy to allow new stocks; do not use aggregate RED_FLAG alone as a system-wide veto. Use Robinhood only for final live verification, then ask the user to approve that exact stock order. If the winner fails a live guard, try the next already-qualified Teststock fallback and ask approval for that exact fallback. Do not invent a different stock. Crypto execution is handled by the separate direct Robinhood Crypto API lane.';
}

signal.schemaVersion=Math.max(38,Number(signal.schemaVersion||0));
const traceableFeatures={...(signal.generatorIntegrity?.traceableFeatures||{})};
delete traceableFeatures.crossAssetOpportunityRanking;
delete traceableFeatures.wholeContractOptionSizing;
signal.generatorIntegrity={
  ...(signal.generatorIntegrity||{}),
  traceableFeatures:{...traceableFeatures,twoTournamentArchitecture:true,regimeSpecificStockValidation:true,selectiveIntradayStockMode:true}
};

await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile(CLAUDE_SIGNAL,JSON.stringify(signal,null,2));
console.log('Applied two-tournament architecture with regime-specific selective intraday stock execution.');
