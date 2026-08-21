import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const CLAUDE_SIGNAL='docs/data/claude-signal.json';
const signal=JSON.parse(await fs.readFile(SIGNAL,'utf8'));

signal.executionArchitecture={
  version:1,
  mode:'TWO_TOURNAMENTS_ONLY',
  researchAuthority:'TESTSTOCK',
  tournaments:{
    stock:{
      enabled:true,
      source:'docs/data/stock-tournament.json',
      purpose:'Research and rank stock contenders until the best currently qualified setup survives, with already-qualified fallbacks retained.',
      execution:'Claude uses Robinhood only for final broker-side verification of the Teststock winner/fallback: price, buying power, positions/orders, spread, account/risk/protection guards, then requests the required user approval and executes when permitted.',
      selectorRule:'Do not invent a different stock. Start with Teststock liveBuyChampion/current best qualified stock; if it fails a live Robinhood guard, try the next already-qualified Teststock fallback in order.'
    },
    crypto:{
      enabled:true,
      source:'docs/data/crypto-tournament.json',
      purpose:'Continuously research and rank supported crypto pairs using trend, confirmation, history, liquidity, BTC context and risk checks until the best qualified setup survives.',
      execution:'The direct Robinhood Crypto API lane uses the Teststock crypto winner/fallback and Robinhood live quote/account/order state for final execution checks. Claude is not required for overnight crypto execution.',
      selectorRule:'Do not invent a different crypto asset. Use the Teststock qualified crypto champion or an already-qualified fallback only.'
    }
  },
  disabledAssetClasses:['OPTION','FUTURES'],
  crossAssetSelection:false,
  rule:'Teststock decides what is worth considering through two independent tournaments. Robinhood is the live execution truth. Broker-side checks may reject a tournament winner but may never replace it with an unranked idea or weaken Teststock gates.'
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
  signal.tradeFrequencyGuard.instructions='Apply the published total-position and crypto frequency ceilings as risk limits, never trade quotas. Options are disabled. Protective exits never count as new entries.';
}
if(signal.executionQuality){
  signal.executionQuality.maxOptionSpreadPct=null;
  signal.executionQuality.instructions='Prefer limit orders when supported. Never pay above a saved maximum entry. Stocks must respect the stock spread cap; crypto must respect the crypto spread cap. A missed trade is better than a bad fill.';
}
if(signal.exitAutomation){
  signal.exitAutomation.optionProtection=null;
  signal.exitAutomation.noProtectionNoEntry='New stock entries require the strongest supported verified protection under the current stock/fractional policy. Crypto entries use the direct Robinhood Crypto API protection path. Options are disabled.';
}
signal.assetClassRouting={
  STOCK:'Use only the current Teststock stock tournament winner and already-qualified stock fallbacks. Claude performs final Robinhood verification before an approved stock order.',
  CRYPTO:'Use only the current Teststock crypto tournament qualified champion and already-qualified crypto fallbacks. The direct Robinhood Crypto API performs live quote/account/order verification and execution.'
};
if(Array.isArray(signal.hardRules)){
  signal.hardRules=signal.hardRules.filter(x=>!String(x).toLowerCase().includes('option'));
  signal.hardRules.push('LIVE ASSET SCOPE: only STOCK and CRYPTO are eligible. Options and futures are disabled.');
  signal.hardRules.push('TOURNAMENT AUTHORITY: do not invent a symbol outside the current Teststock stock or crypto tournament winner/fallback set. Robinhood live checks may reject a winner but may not substitute an unranked idea.');
}
if(signal.claudeExecutionPolicy?.buys){
  signal.claudeExecutionPolicy.buys.appliesTo=['STOCK_A','STOCK_B'];
  signal.claudeExecutionPolicy.buys.rule='For stocks, start with the current Teststock tournament winner, A before B. If that winner fails a live Robinhood guard, try the next already-qualified Teststock fallback. Do not invent a different stock. Crypto execution is handled by the separate direct Robinhood Crypto API lane.';
}

signal.schemaVersion=Math.max(36,Number(signal.schemaVersion||0));
signal.generatorIntegrity={
  ...(signal.generatorIntegrity||{}),
  traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),twoTournamentArchitecture:true}
};

await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile(CLAUDE_SIGNAL,JSON.stringify(signal,null,2));
console.log('Applied two-tournament architecture: stock + crypto only; stale option routing removed.');
