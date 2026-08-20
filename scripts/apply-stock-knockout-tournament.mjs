import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const BROAD='docs/data/broad-stock-universe.json';
const OUT='docs/data/stock-tournament.json';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const signal=await read(SIGNAL);
const broad=await read(BROAD);
const orders=signal.stockPlan?.stockOrders||[];
const queue=signal.stockPlan?.stockCandidateQueue||orders;
const top=(broad.topCandidates||[]).slice(0,100);
const num=x=>Number.isFinite(Number(x))?Number(x):0;
const score=x=>{
  const opportunity=num(x.opportunityScore||x.score||x.preValidationScore);
  const quality=num(x.growthQuality||x.score||x.preValidationScore);
  const rr=num(x.rewardRisk||((num(x.target2)-num(x.entry||x.minimumEntry))/(num(x.entry||x.minimumEntry)-num(x.stop))));
  const win=num(x.validation?.winRate||x.historicalWinRate);
  const samples=num(x.validation?.samples||x.historicalSamples);
  const spread=x.spreadPct==null?0:num(x.spreadPct);
  return Number((opportunity*.35+quality*.30+Math.min(100,win)*.20+Math.min(100,samples*2)*.05+Math.min(100,rr*20)*.10-Math.min(10,spread*10)).toFixed(2));
};
const researchFinalists=top.map((x,i)=>({
  rank:i+1,ticker:x.symbol||x.ticker,name:x.name||null,setupType:x.setupType||null,
  tournamentScore:score(x),quality:num(x.growthQuality||x.score||x.preValidationScore),
  historicalWinRate:x.validation?.winRate??x.historicalWinRate??null,historicalSamples:x.validation?.samples??x.historicalSamples??null,
  rewardRisk:x.rewardRisk??(num(x.entry)>num(x.stop)?Number(((num(x.target2)-num(x.entry))/(num(x.entry)-num(x.stop))).toFixed(2)):null),
  spreadPct:x.spreadPct??null,entry:x.entry??x.minimumEntry??null,stop:x.stop??null,target1:x.target1??null,target2:x.target2??null
})).sort((a,b)=>b.tournamentScore-a.tournamentScore||a.rank-b.rank).map((x,i)=>({...x,rank:i+1}));
const liveQueue=queue.map((x,i)=>({
  queueRank:num(x.queueRank||x.rank||i+1),ticker:x.ticker,action:x.action||'WAIT',queueRole:x.queueRole||'PRIMARY',
  tournamentScore:score(x),growthQuality:x.growthQuality??null,rewardRisk:x.rewardRisk??null,
  minimumEntry:x.minimumEntry??null,maximumEntry:x.maximumEntry??null,stop:x.stop??null,target1:x.target1??null,target2:x.target2??null
})).sort((a,b)=>a.queueRank-b.queueRank||b.tournamentScore-a.tournamentScore);
const buyable=liveQueue.filter(x=>x.action==='AUTO_BUY_ELIGIBLE');
const champion=buyable[0]||null;
const researchChampion=researchFinalists[0]||null;
const availableUniverse=num(broad.activeTradableOperatingCompanies);
const discoverySize=num(broad.liveTournamentSize);
const rounds=[
  {round:'UNIVERSE',input:availableUniverse||null,output:discoverySize||null,rule:'Scan every legitimate active/tradable operating-company stock available from the connected U.S. equity universe, up to a 20,000-symbol ceiling. Never invent symbols or pad with ETFs/warrants just to hit 20,000.'},
  {round:'UP_TO_20000',input:discoverySize||availableUniverse||null,output:broad.historyPoolRequested||2000,rule:'Rank the entire available discovery pool by market quality, liquidity and momentum; send the best 2,000 to deeper daily-history analysis.'},
  {round:'TOP_2000',input:broad.historyPoolRequested||2000,output:broad.validationPoolSize||800,rule:'Require sufficient history, verified 20-day dollar liquidity, trend/setup structure and bounded volatility.'},
  {round:'TOP_800',input:broad.validationPoolSize||800,output:broad.qualifiedForOptimizer||100,rule:'Run setup-specific historical validation and eliminate weak win-rate, sample-depth, direction, liquidity and volatility profiles.'},
  {round:'TOP_100',input:broad.qualifiedForOptimizer||100,output:liveQueue.length,rule:'Apply Teststock expectancy, probability, event, correlation, execution, sizing and safety gates. Only fully qualified names reach the live queue.'},
  {round:'LIVE_FINAL',input:liveQueue.length,output:champion?1:0,rule:'Among names currently inside a valid live buy zone, choose the highest-ranked candidate. If it fails a Robinhood guard before submission, try the next live fallback. Never force a failed setup.'}
];
const tournament={
  schemaVersion:2,source:'TESTSTOCK_UP_TO_20000_STOCK_KNOCKOUT',generatedAt:new Date().toISOString(),
  objective:'Continuously eliminate weaker candidates from every legitimate active/tradable U.S. operating-company stock available, capped at 20,000 symbols, until the strongest fully qualified live candidate remains.',
  policy:{
    targetTournamentSize:20000,
    actualAvailableUniverse:availableUniverse,
    scanAllAvailableUpToTarget:true,
    alwaysProduceResearchChampion:true,
    alwaysBuySomething:false,
    buyWhenAtLeastOneFullyQualifiedLiveCandidateExists:true,
    noEligibleCandidateAction:'HOLD_CASH_AND_KEEP_SCANNING',
    winnerSelection:'BEST_FIRST_BY_EXISTING_TESTSTOCK_RESEARCH_RANK_THEN_LIVE_ROBINHOOD_GATES',
    fallbackSelection:'IF_WINNER_FAILS_BEFORE_ORDER_SUBMISSION_TRY_NEXT_LIVE_ELIGIBLE_CANDIDATE_IN_SAME_EXECUTION_RUN',
    safetyNote:'The tournament always names the best research candidate, but a brokerage buy occurs only when at least one candidate passes every research and live execution gate. A forced trade is prohibited.'
  },
  rounds,researchChampion,liveBuyChampion:champion,liveFallbacks:champion?buyable.slice(1):[],liveQueue,researchFinalists
};
signal.stockTournament={
  enabled:true,sourceRef:'docs/data/stock-tournament.json',targetTournamentSize:20000,actualAvailableUniverse:availableUniverse,scanAllAvailableUpToTarget:true,rounds,
  alwaysProduceResearchChampion:true,alwaysBuySomething:false,buyWhenAtLeastOneFullyQualifiedLiveCandidateExists:true,
  noEligibleCandidateAction:'HOLD_CASH_AND_KEEP_SCANNING',researchChampion,liveBuyChampion:champion,
  liveFallbackTickers:champion?buyable.slice(1).map(x=>x.ticker):[],
  instructions:'Use every legitimate active/tradable operating-company stock available from the connected U.S. equity universe, up to 20,000 symbols. Knock the pool down through broad ranking, history, setup validation, probability/expectancy and live execution gates. Buy the best currently live-eligible candidate only after all Robinhood checks pass; if it fails before submission, try the next eligible fallback in the same run. Never lower a gate merely to ensure a trade.'
};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),stockKnockoutTournament:true}};
signal.schemaVersion=Math.max(29,Number(signal.schemaVersion||0));
await fs.writeFile(OUT,JSON.stringify(tournament,null,2));
await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile('docs/data/claude-signal.json',JSON.stringify(signal,null,2));
console.log(`Up-to-20000-stock knockout applied: ${availableUniverse} actual operating companies available, ${researchFinalists.length} research finalists, ${liveQueue.length} live-queue candidates, ${champion?.ticker||'no live buy champion'}.`);
