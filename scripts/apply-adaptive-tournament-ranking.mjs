import fs from 'node:fs/promises';

const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const signal=await read('docs/signal.json');
const tournament=await read('docs/data/stock-tournament.json');
const adaptive=await read('docs/data/adaptive-performance.json',{});
const plan=await read('docs/data/growth-plan-500.json',{});
const broad=await read('docs/data/broad-stock-universe.json',{});
if(!signal||!tournament)throw new Error('signal or stock tournament missing');
const adjustments=adaptive?.rankingAdjustments||{};
const normalize=s=>String(s??'UNKNOWN').trim().toUpperCase().replace(/\s+/g,'_')||'UNKNOWN';
const currentRegime=normalize(plan?.advancedGuards?.runtimeRegime||plan?.policy?.runtimeRegimePolicy?.regime||'UNKNOWN');
const broadByTicker=new Map((broad?.topCandidates||[]).map(x=>[x.symbol||x.ticker,x]));
const planByTicker=new Map([...(plan?.qualifiedCandidateQueue||[]),...(plan?.allocations||[])].map(x=>[x.symbol||x.ticker,x]));
function setupFor(ticker,row={}){return normalize(row.setupType||planByTicker.get(ticker)?.setupType||broadByTicker.get(ticker)?.setupType||'TREND');}
function clusterFor(ticker,row={}){return normalize(row.riskCluster||planByTicker.get(ticker)?.riskCluster||planByTicker.get(ticker)?.sector||broadByTicker.get(ticker)?.sector||'UNKNOWN');}
function keysFor(ticker,row={}){
  const setup=setupFor(ticker,row),cluster=clusterFor(ticker,row);
  return [`REGIME:${currentRegime}`,`SETUP_TYPE:${setup}`,`REGIME_SETUP:${currentRegime}|${setup}`,`RISK_CLUSTER:${cluster}`,`SYMBOL:${normalize(ticker)}`];
}
function learningFor(ticker,row={}){
  const matched=keysFor(ticker,row).map(k=>({key:k,...adjustments[k]})).filter(x=>x.state);
  const delta=Math.max(-8,Math.min(6,matched.reduce((s,x)=>s+Number(x.priorityScoreDelta||0),0)));
  const sizeMultiplier=matched.length?Math.min(1,...matched.map(x=>Number.isFinite(Number(x.sizeMultiplier))?Number(x.sizeMultiplier):1)):1;
  const blocked=matched.some(x=>x.temporaryBlock===true||x.state==='TEMP_BLOCK');
  return {matched,priorityScoreDelta:Number(delta.toFixed(2)),sizeMultiplier:Number(sizeMultiplier.toFixed(3)),blocked};
}
function enrich(row){
  const ticker=row.ticker||row.symbol;const l=learningFor(ticker,row);const base=Number(row.tournamentScore||0);
  return {...row,adaptiveLearning:l,adaptiveBaseTournamentScore:base,adaptiveTournamentScore:Number((base+l.priorityScoreDelta).toFixed(2)),adaptiveSizeMultiplier:l.sizeMultiplier,action:l.blocked?'ADAPTIVE_BLOCK':row.action};
}
const sortRows=(a,b)=>(a.entryTier==='A'?0:1)-(b.entryTier==='A'?0:1)||Number(b.adaptiveTournamentScore||0)-Number(a.adaptiveTournamentScore||0)||Number(a.queueRank||a.rank||999)-Number(b.queueRank||b.rank||999);
let liveQueue=(tournament.liveQueue||[]).map(enrich).sort(sortRows).map((x,i)=>({...x,adaptiveOriginalQueueRank:x.queueRank,queueRank:i+1}));
let finalists=(tournament.researchFinalists||[]).map(enrich).sort((a,b)=>Number(b.adaptiveTournamentScore||0)-Number(a.adaptiveTournamentScore||0)||Number(a.rank||999)-Number(b.rank||999)).map((x,i)=>({...x,rank:i+1}));
const buyable=liveQueue.filter(x=>x.action==='AUTO_BUY_ELIGIBLE'&&!x.adaptiveLearning.blocked);
const champion=buyable[0]||null;
tournament.schemaVersion=Math.max(5,Number(tournament.schemaVersion||0));
tournament.adaptiveLearning={enabled:true,status:adaptive?.status||'UNKNOWN',source:'docs/data/adaptive-performance.json',currentRegime,resolvedRealStockTrades:Number(adaptive?.resolvedRealStockTrades||0),rule:'Real-fill learning may reorder already-qualified candidates or reduce/block risk after minimum samples. It may never create eligibility, increase maximum risk, loosen hard gates, or override blocked regime policy.'};
tournament.researchFinalists=finalists;
tournament.researchChampion=finalists[0]||null;
tournament.liveQueue=liveQueue;
tournament.liveBuyChampion=champion;
tournament.liveFallbacks=champion?buyable.slice(1):[];
if(tournament.policy)tournament.policy.winnerSelection='A_FIRST_THEN_ADAPTIVE_REAL_FILL_SCORE_THEN_TESTSTOCK_RANK_THEN_LIVE_ROBINHOOD_GATES';

signal.stockPlan=signal.stockPlan||{};
const queueByTicker=new Map(liveQueue.map(x=>[x.ticker,x]));
signal.stockPlan.stockCandidateQueue=(signal.stockPlan.stockCandidateQueue||[]).map(x=>{
  const a=queueByTicker.get(x.ticker);return a?{...x,queueRank:a.queueRank,adaptiveLearning:a.adaptiveLearning,adaptiveTournamentScore:a.adaptiveTournamentScore,adaptiveSizeMultiplier:a.adaptiveSizeMultiplier,action:a.action}:x;
}).sort((a,b)=>(a.entryTier==='A'?0:1)-(b.entryTier==='A'?0:1)||Number(a.queueRank||999)-Number(b.queueRank||999));
signal.stockTournament={...(signal.stockTournament||{}),adaptiveLearning:tournament.adaptiveLearning,researchChampion:tournament.researchChampion,liveBuyChampion:champion,liveFallbackTickers:champion?buyable.slice(1).map(x=>x.ticker):[]};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),adaptiveTournamentRanking:true}};
signal.schemaVersion=Math.max(39,Number(signal.schemaVersion||0));
await Promise.all([write('docs/data/stock-tournament.json',tournament),write('docs/signal.json',signal),write('docs/data/claude-signal.json',signal)]);
console.log(`Adaptive tournament ranking: regime=${currentRegime}; realTrades=${adaptive?.resolvedRealStockTrades||0}; champion=${champion?.ticker||'none'}; blocked=${liveQueue.filter(x=>x.adaptiveLearning.blocked).length}`);
