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

// Options are intentionally outside the live Teststock architecture. Preserve any
// old research files for history, but remove option execution eligibility from the
// published live signal so agents cannot route capital there.
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
}
if(signal.tradeFrequencyGuard){signal.tradeFrequencyGuard.maxNewOptionsPerDay=0;}
if(signal.executionQuality){signal.executionQuality.maxOptionSpreadPct=null;}
if(signal.claudeExecutionPolicy?.buys){
  signal.claudeExecutionPolicy.buys.appliesTo=['STOCK_A','STOCK_B'];
}

signal.schemaVersion=Math.max(36,Number(signal.schemaVersion||0));
signal.generatorIntegrity={
  ...(signal.generatorIntegrity||{}),
  traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),twoTournamentArchitecture:true}
};

await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile(CLAUDE_SIGNAL,JSON.stringify(signal,null,2));
console.log('Applied two-tournament architecture: stock + crypto only; options disabled for live execution.');
