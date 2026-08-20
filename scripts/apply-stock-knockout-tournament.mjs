import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const BROAD='docs/data/broad-stock-universe.json';
const PLAN='docs/data/growth-plan-500.json';
const OUT='docs/data/stock-tournament.json';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const signal=await read(SIGNAL);
const broad=await read(BROAD);
const plan=await read(PLAN);
const planRows=[...(plan.qualifiedCandidateQueue||plan.allocations||[])];
const planByTicker=new Map(planRows.map(x=>[x.symbol,x]));
const tierFor=ticker=>planByTicker.get(ticker)?.entryTier||'A';
const tierLabel=ticker=>planByTicker.get(ticker)?.entryTierLabel||(tierFor(ticker)==='B'?'BEST_ACCEPTABLE':'ELITE');
const tierSize=ticker=>Number(planByTicker.get(ticker)?.entryTierSizeMultiplier??(tierFor(ticker)==='B'?.5:1));
signal.stockPlan=signal.stockPlan||{};
signal.stockPlan.stockOrders=(signal.stockPlan.stockOrders||[]).map(x=>({...x,entryTier:tierFor(x.ticker),entryTierLabel:tierLabel(x.ticker),entryTierSizeMultiplier:tierSize(x.ticker),bestAcceptableFallback:tierFor(x.ticker)==='B'}));
signal.stockPlan.stockCandidateQueue=(signal.stockPlan.stockCandidateQueue||signal.stockPlan.stockOrders||[]).map(x=>({...x,entryTier:tierFor(x.ticker),entryTierLabel:tierLabel(x.ticker),entryTierSizeMultiplier:tierSize(x.ticker),bestAcceptableFallback:tierFor(x.ticker)==='B'})).sort((a,b)=>(a.entryTier==='A'?0:1)-(b.entryTier==='A'?0:1)||Number(a.queueRank||999)-Number(b.queueRank||999));
signal.stockPlan.bestAcceptableEntryPolicy={enabled:true,priority:['A','B'],aTier:{label:'ELITE',sizeMultiplier:1},bTier:{label:'BEST_ACCEPTABLE',sizeMultiplier:.5},executionRule:'Buy the highest-ranked live A candidate when one survives every live guard. If no A survives, buy the highest-ranked live B candidate at its reduced encoded size. If the selected candidate fails before submission, keep trying eligible fallbacks in the same run. Hold cash only when no A or B survives every hard guard.',neverRelax:['funding lock','account floor','loss brakes','fresh research','live price and maximumEntry','spread cap','gap/chase guard','correlation and portfolio heat','protective exit requirements','fractional monitoring requirement','no margin or leverage','no averaging down','no widened stops']};
const orders=signal.stockPlan.stockOrders||[];
const queue=signal.stockPlan.stockCandidateQueue||orders;
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
  spreadPct:x.spreadPct??null,entry:x.entry??x.minimumEntry??null,stop:x.stop??null,target1:x.target1??null,target2:x.target2??null,
  entryTier:planByTicker.get(x.symbol||x.ticker)?.entryTier||null,entryTierLabel:planByTicker.get(x.symbol||x.ticker)?.entryTierLabel||null
})).sort((a,b)=>b.tournamentScore-a.tournamentScore||a.rank-b.rank).map((x,i)=>({...x,rank:i+1}));
const liveQueue=queue.map((x,i)=>({
  queueRank:num(x.queueRank||x.rank||i+1),ticker:x.ticker,action:x.action||'WAIT',queueRole:x.queueRole||'PRIMARY',entryTier:x.entryTier||tierFor(x.ticker),entryTierLabel:x.entryTierLabel||tierLabel(x.ticker),entryTierSizeMultiplier:Number(x.entryTierSizeMultiplier??tierSize(x.ticker)),
  tournamentScore:score(x),growthQuality:x.growthQuality??null,rewardRisk:x.rewardRisk??null,
  minimumEntry:x.minimumEntry??null,maximumEntry:x.maximumEntry??null,stop:x.stop??null,target1:x.target1??null,target2:x.target2??null
})).sort((a,b)=>(a.entryTier==='A'?0:1)-(b.entryTier==='A'?0:1)||a.queueRank-b.queueRank||b.tournamentScore-a.tournamentScore);
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
  {round:'TOP_100',input:broad.qualifiedForOptimizer||100,output:liveQueue.length,rule:'Apply A-tier elite gates first, then a reduced-size B best-acceptable tier with positive expectancy/history/R:R floors. Hard account, price, spread, gap, correlation and protection gates never relax.'},
  {round:'LIVE_FINAL',input:liveQueue.length,output:champion?1:0,rule:'Choose live A candidates first. If no A survives, choose the strongest live B candidate at reduced size. If it fails before submission, try the next eligible fallback. Hold cash only when no A or B survives every hard guard.'}
];
const tournament={
  schemaVersion:4,source:'TESTSTOCK_UP_TO_20000_STOCK_KNOCKOUT',generatedAt:new Date().toISOString(),
  objective:'Continuously eliminate weaker candidates from every legitimate active/tradable U.S. operating-company stock available, capped at 20,000 symbols, then buy the best acceptable live survivor without waiting only for a perfect setup.',
  policy:{
    targetTournamentSize:20000,
    actualAvailableUniverse:availableUniverse,
    scanAllAvailableUpToTarget:true,
    alwaysProduceResearchChampion:true,
    alwaysBuySomething:false,
    buyWhenAtLeastOneAOrBCandidatePasses:true,
    tierPriority:['A','B'],
    aTier:'ELITE_NORMAL_SIZE',
    bTier:'BEST_ACCEPTABLE_HALF_CANDIDATE_SIZE',
    executionIntentWhenQualified:'BUY',
    discretionaryCashOverrideWhenQualified:false,
    noEligibleCandidateAction:'HOLD_CASH_AND_KEEP_SCANNING',
    winnerSelection:'A_FIRST_THEN_B_BY_TESTSTOCK_RANK_THEN_LIVE_ROBINHOOD_GATES',
    fallbackSelection:'IF_WINNER_FAILS_BEFORE_ORDER_SUBMISSION_TRY_NEXT_ELIGIBLE_A_THEN_B_IN_SAME_EXECUTION_RUN',
    safetyNote:'The B tier increases opportunity frequency without turning failed hard guards into passes. No trade is forced when both tiers fail.'
  },
  rounds,researchChampion,liveBuyChampion:champion,liveFallbacks:champion?buyable.slice(1):[],liveQueue,researchFinalists
};
signal.stockTournament={
  enabled:true,sourceRef:'docs/data/stock-tournament.json',targetTournamentSize:20000,actualAvailableUniverse:availableUniverse,scanAllAvailableUpToTarget:true,rounds,
  alwaysProduceResearchChampion:true,alwaysBuySomething:false,buyWhenAtLeastOneAOrBCandidatePasses:true,tierPriority:['A','B'],
  executionIntentWhenQualified:'BUY',discretionaryCashOverrideWhenQualified:false,
  noEligibleCandidateAction:'HOLD_CASH_AND_KEEP_SCANNING',researchChampion,liveBuyChampion:champion,
  liveFallbackTickers:champion?buyable.slice(1).map(x=>x.ticker):[],
  instructions:'Use every legitimate active/tradable operating-company stock available from the connected U.S. equity universe, up to 20,000 symbols. Prefer A-tier elite candidates. If no A candidate survives every live guard, buy the strongest B-tier best-acceptable candidate at its reduced encoded size. If it fails before submission, try the next eligible fallback in the same run. Never relax hard account, freshness, pricing, spread, gap, correlation or protection rules just to ensure a trade.'
};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),stockKnockoutTournament:true,bestAcceptableStockTier:true}};
signal.schemaVersion=Math.max(31,Number(signal.schemaVersion||0));
await fs.writeFile(OUT,JSON.stringify(tournament,null,2));
await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile('docs/data/claude-signal.json',JSON.stringify(signal,null,2));
console.log(`Up-to-20000-stock knockout applied: ${availableUniverse} actual operating companies available, ${researchFinalists.length} research finalists, ${liveQueue.length} live-queue candidates, A=${liveQueue.filter(x=>x.entryTier==='A').length}, B=${liveQueue.filter(x=>x.entryTier==='B').length}, champion=${champion?.ticker||'none'}.`);
