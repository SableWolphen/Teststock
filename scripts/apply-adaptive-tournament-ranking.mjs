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
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const currentRegime=normalize(plan?.advancedGuards?.runtimeRegime||plan?.policy?.runtimeRegimePolicy?.regime||'UNKNOWN');
const broadByTicker=new Map((broad?.topCandidates||[]).map(x=>[x.symbol||x.ticker,x]));
const planByTicker=new Map([...(plan?.qualifiedCandidateQueue||[]),...(plan?.allocations||[])].map(x=>[x.symbol||x.ticker,x]));
const performanceState=String(adaptive?.performanceState||'INSUFFICIENT_DATA').toUpperCase();
const execution=adaptive?.executionQuality||{};
const realTradeCount=Number(adaptive?.resolvedRealStockTrades||0);

const maturity=realTradeCount<12?'COLD_START':realTradeCount<30?'LEARNING':realTradeCount<60?'ESTABLISHED':'MATURE';
const positiveInfluenceCap=maturity==='COLD_START'?0:maturity==='LEARNING'?.5:maturity==='ESTABLISHED'?.75:1;
const targetSamples={REGIME:24,SETUP_TYPE:24,REGIME_SETUP:30,RISK_CLUSTER:24,ENTRY_SESSION:24,SYMBOL:40};
const dimensionTrust={};
for(const [name,target] of Object.entries(targetSamples)){
  const rows=Object.entries(adjustments).filter(([k])=>k.startsWith(name+':')).map(([,v])=>Number(v.samples||0));
  const best=rows.length?Math.max(...rows):0;
  dimensionTrust[name]=Number(clamp(best/target,0,1).toFixed(3));
}

let globalSizeCap=1,globalBlock=false;const globalReasons=[];
if(performanceState==='DEGRADING'&&realTradeCount>=10){globalSizeCap=Math.min(globalSizeCap,.75);globalReasons.push('RECENT_REAL_FILL_PERFORMANCE_DEGRADING');}
if(Number(execution.confirmedEntrySlippageSamples||0)>=5&&Number(execution.averageAdverseEntrySlippagePct)>.25){globalSizeCap=Math.min(globalSizeCap,.75);globalReasons.push('ENTRY_SLIPPAGE_ABOVE_0_25_PCT');}
if(Number(execution.protectionVerificationSamples||0)>=5&&Number(execution.protectiveExitVerificationRatePct)<90){globalBlock=true;globalReasons.push('PROTECTION_VERIFICATION_BELOW_90_PCT');}

function setupFor(ticker,row={}){return normalize(row.setupType||planByTicker.get(ticker)?.setupType||broadByTicker.get(ticker)?.setupType||'TREND');}
function clusterFor(ticker,row={}){return normalize(row.riskCluster||planByTicker.get(ticker)?.riskCluster||planByTicker.get(ticker)?.sector||broadByTicker.get(ticker)?.sector||'UNKNOWN');}
function keysFor(ticker,row={}){const setup=setupFor(ticker,row),cluster=clusterFor(ticker,row);return [`REGIME:${currentRegime}`,`SETUP_TYPE:${setup}`,`REGIME_SETUP:${currentRegime}|${setup}`,`RISK_CLUSTER:${cluster}`,`SYMBOL:${normalize(ticker)}`];}
function trustForKey(key,samples){
  const dimension=String(key).split(':')[0];
  const target=targetSamples[dimension]||30;
  const sampleTrust=clamp(Number(samples||0)/target,0,1);
  return Number(Math.min(sampleTrust,dimensionTrust[dimension]??1).toFixed(3));
}
function learningFor(ticker,row={}){
  const matched=keysFor(ticker,row).map(k=>({key:k,...adjustments[k]})).filter(x=>x.state).map(x=>({...x,trustWeight:trustForKey(x.key,x.samples)}));
  let sum=0;
  for(const x of matched){
    const d=Number(x.priorityScoreDelta||0);
    if(d>0)sum+=d*x.trustWeight*positiveInfluenceCap;
    else if(d<0)sum+=d*Math.max(.75,x.trustWeight);
  }
  const delta=clamp(sum,-8,6);
  const bucketSize=matched.length?Math.min(1,...matched.map(x=>Number.isFinite(Number(x.sizeMultiplier))?Number(x.sizeMultiplier):1)):1;
  const sizeMultiplier=Math.min(bucketSize,globalSizeCap);
  const bucketBlocked=matched.some(x=>x.temporaryBlock===true||x.state==='TEMP_BLOCK');
  const blocked=bucketBlocked||globalBlock;
  const reasons=[...matched.filter(x=>x.temporaryBlock===true||x.state==='TEMP_BLOCK').map(x=>`BUCKET_BLOCK:${x.key}`),...globalReasons];
  return {matched,priorityScoreDelta:Number(delta.toFixed(2)),positiveInfluenceCap,sizeMultiplier:Number(sizeMultiplier.toFixed(3)),blocked,globalSizeCap,globalBlock,globalReasons,reasons};
}
function enrich(row){const ticker=row.ticker||row.symbol;const l=learningFor(ticker,row);const base=Number(row.tournamentScore||0);return {...row,adaptiveLearning:l,adaptiveBaseTournamentScore:base,adaptiveTournamentScore:Number((base+l.priorityScoreDelta).toFixed(2)),adaptiveSizeMultiplier:l.sizeMultiplier,action:l.blocked?'ADAPTIVE_BLOCK':row.action};}
const sortRows=(a,b)=>(a.entryTier==='A'?0:1)-(b.entryTier==='A'?0:1)||Number(b.adaptiveTournamentScore||0)-Number(a.adaptiveTournamentScore||0)||Number(a.queueRank||a.rank||999)-Number(b.queueRank||b.rank||999);
let liveQueue=(tournament.liveQueue||[]).map(enrich).sort(sortRows).map((x,i)=>({...x,adaptiveOriginalQueueRank:x.queueRank,queueRank:i+1}));
let finalists=(tournament.researchFinalists||[]).map(enrich).sort((a,b)=>Number(b.adaptiveTournamentScore||0)-Number(a.adaptiveTournamentScore||0)||Number(a.rank||999)-Number(b.rank||999)).map((x,i)=>({...x,rank:i+1}));
const buyable=liveQueue.filter(x=>x.action==='AUTO_BUY_ELIGIBLE'&&!x.adaptiveLearning.blocked);
const champion=buyable[0]||null;

const selfLearningState={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  mode:'BOUNDED_AUTONOMOUS_SELF_LEARNING',
  maturity,
  resolvedRealStockTrades:realTradeCount,
  performanceState,
  positiveInfluenceCap,
  negativeEvidenceMayApplyFully:true,
  dimensionTrust,
  globalRiskAdjustment:{sizeCap:globalSizeCap,blockNewEntries:globalBlock,reasons:globalReasons},
  dataSources:{realMoney:'ROBINHOOD_CONFIRMED_CLOSED_TRADES_ONLY',shadow:'DIAGNOSTIC_ONLY'},
  autonomy:{
    mayReorderAlreadyQualifiedCandidates:true,
    mayReduceCandidateSize:true,
    mayTemporarilyBlockWeakPatterns:true,
    mayIncreaseMaximumRisk:false,
    mayLoosenHardSafetyRules:false,
    mayCreateEligibility:false,
    mayRewriteItsOwnCode:false,
    mayChangeFundingRules:false,
    mayDisablePerOrderStockApproval:false
  },
  learningRule:'Positive learning influence grows automatically with reconciled sample depth and per-dimension evidence. Negative evidence, execution degradation, and protection failures may reduce or block risk sooner. The learner never creates eligibility, raises the maximum risk ceiling, rewrites code, changes funding rules, or bypasses stock approval.'
};

tournament.schemaVersion=Math.max(7,Number(tournament.schemaVersion||0));
tournament.adaptiveLearning={enabled:true,selfLearning:true,maturity,status:adaptive?.status||'UNKNOWN',performanceState,source:'docs/data/adaptive-performance.json',selfLearningStateSource:'docs/data/self-learning-state.json',currentRegime,resolvedRealStockTrades:realTradeCount,positiveInfluenceCap,dimensionTrust,globalRiskAdjustment:{sizeCap:globalSizeCap,blockNewEntries:globalBlock,reasons:globalReasons},rule:selfLearningState.learningRule};
tournament.researchFinalists=finalists;tournament.researchChampion=finalists[0]||null;tournament.liveQueue=liveQueue;tournament.liveBuyChampion=champion;tournament.liveFallbacks=champion?buyable.slice(1):[];
if(tournament.policy)tournament.policy.winnerSelection='A_FIRST_THEN_BOUNDED_SELF_LEARNING_SCORE_THEN_TESTSTOCK_RANK_THEN_LIVE_ROBINHOOD_GATES';
signal.stockPlan=signal.stockPlan||{};
const queueByTicker=new Map(liveQueue.map(x=>[x.ticker,x]));
signal.stockPlan.stockCandidateQueue=(signal.stockPlan.stockCandidateQueue||[]).map(x=>{const a=queueByTicker.get(x.ticker);return a?{...x,queueRank:a.queueRank,adaptiveLearning:a.adaptiveLearning,adaptiveTournamentScore:a.adaptiveTournamentScore,adaptiveSizeMultiplier:a.adaptiveSizeMultiplier,action:a.action}:x;}).sort((a,b)=>(a.entryTier==='A'?0:1)-(b.entryTier==='A'?0:1)||Number(a.queueRank||999)-Number(b.queueRank||999));
signal.stockTournament={...(signal.stockTournament||{}),adaptiveLearning:tournament.adaptiveLearning,researchChampion:tournament.researchChampion,liveBuyChampion:champion,liveFallbackTickers:champion?buyable.slice(1).map(x=>x.ticker):[]};
signal.executionLearningPolicy={...(signal.executionLearningPolicy||{}),selfLearningMode:selfLearningState.mode,selfLearningMaturity:maturity,positiveInfluenceCap,dimensionTrust,globalAdaptiveSizeCap:globalSizeCap,globalAdaptiveEntryBlock:globalBlock,globalAdaptiveReasons:globalReasons};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),adaptiveTournamentRanking:true,boundedAutonomousSelfLearning:true,adaptiveDegradationGuard:true,adaptiveExecutionQualityGuard:true}};
signal.schemaVersion=Math.max(41,Number(signal.schemaVersion||0));
await Promise.all([write('docs/data/stock-tournament.json',tournament),write('docs/data/self-learning-state.json',selfLearningState),write('docs/signal.json',signal),write('docs/data/claude-signal.json',signal)]);
console.log(`Self-learning tournament ranking: maturity=${maturity}; regime=${currentRegime}; performance=${performanceState}; positiveCap=${positiveInfluenceCap}; sizeCap=${globalSizeCap}; block=${globalBlock}; realTrades=${realTradeCount}; champion=${champion?.ticker||'none'}`);
