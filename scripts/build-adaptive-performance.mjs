import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir=path.resolve('docs/data');
const journalFile=path.join(dataDir,'real-trade-journal.json');
const shadowFile=path.join(dataDir,'shadow-trades.json');
const outFile=path.join(dataDir,'adaptive-performance.json');
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const round=(n,d=3)=>Number(Number(n||0).toFixed(d));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const now=Date.now();
const HALF_LIFE_DAYS=60;
const SHRINK_SAMPLES=12;
const MIN_PRIORITY_SAMPLES=12;
const MIN_BLOCK_SAMPLES=20;
const MIN_SYMBOL_SAMPLES=20;

const normalize=s=>String(s??'UNKNOWN').trim().toUpperCase().replace(/\s+/g,'_')||'UNKNOWN';
const tradeDate=t=>Date.parse(t.finalExitAt||t.resolvedAt||t.entryFilledAt||t.entrySubmittedAt||t.createdAt||0);
const weight=t=>{const ts=tradeDate(t);if(!Number.isFinite(ts))return 1;const age=Math.max(0,(now-ts)/86400000);return Math.pow(.5,age/HALF_LIFE_DAYS);};
const validRealTrade=t=>String(t.assetClass||'STOCK').toUpperCase()==='STOCK'&&t.reconciledFromRobinhood===true&&['WIN','LOSS','FLAT'].includes(String(t.outcome||'').toUpperCase())&&Number.isFinite(Number(t.realizedR));

function summarize(rows,{dimension,key}={}){
  const n=rows.length;
  const wins=rows.filter(t=>String(t.outcome).toUpperCase()==='WIN').length;
  const losses=rows.filter(t=>String(t.outcome).toUpperCase()==='LOSS').length;
  const flats=n-wins-losses;
  const rawWin=n?wins/n:.5;
  const rawAvgR=n?rows.reduce((s,t)=>s+Number(t.realizedR),0)/n:0;
  let wSum=0,wWins=0,wR=0;
  for(const t of rows){const w=weight(t);wSum+=w;wWins+=w*(String(t.outcome).toUpperCase()==='WIN'?1:0);wR+=w*Number(t.realizedR);}
  const recentWin=wSum?wWins/wSum:.5,recentAvgR=wSum?wR/wSum:0;
  const shrink=n/(n+SHRINK_SAMPLES);
  const shrunkWin=.5+(recentWin-.5)*shrink;
  const shrunkAvgR=recentAvgR*shrink;
  let state='INSUFFICIENT_DATA',priorityScoreDelta=0,sizeMultiplier=1,temporaryBlock=false;
  if(n>=MIN_PRIORITY_SAMPLES){
    state='NEUTRAL';
    if(shrunkWin>=.55&&shrunkAvgR>=.20){state='PRIORITY_UP';priorityScoreDelta=clamp((shrunkWin-.5)*30+shrunkAvgR*4,1,4);}
    else if(shrunkWin<=.45||shrunkAvgR<=-.10){state='PRIORITY_DOWN';priorityScoreDelta=-clamp((.5-shrunkWin)*30+Math.max(0,-shrunkAvgR)*4,1,4);sizeMultiplier=.75;}
    if(n>=MIN_BLOCK_SAMPLES&&shrunkWin<=.42&&shrunkAvgR<=-.25){state='TEMP_BLOCK';priorityScoreDelta=-6;sizeMultiplier=0;temporaryBlock=true;}
  }
  return {dimension,key,samples:n,wins,losses,flats,winRatePct:n?round(rawWin*100,1):null,averageRealizedR:n?round(rawAvgR,3):null,recencyWeightedWinRatePct:n?round(recentWin*100,1):null,recencyWeightedAverageR:n?round(recentAvgR,3):null,shrunkWinRatePct:n?round(shrunkWin*100,1):null,shrunkAverageR:n?round(shrunkAvgR,3):null,state,priorityScoreDelta:round(priorityScoreDelta,2),sizeMultiplier,temporaryBlock};
}
function bucket(rows,dimension,keyFn,minSamples=0){
  const m=new Map();
  for(const t of rows){const k=keyFn(t);if(!m.has(k))m.set(k,[]);m.get(k).push(t);}
  return [...m.entries()].map(([key,xs])=>summarize(xs,{dimension,key})).filter(x=>x.samples>=minSamples).sort((a,b)=>b.samples-a.samples||String(a.key).localeCompare(String(b.key)));
}

const journal=await read(journalFile,{trades:[]});
const realTrades=(journal.trades||[]).filter(validRealTrade);
const byRegime=bucket(realTrades,'REGIME',t=>normalize(t.runtimeRegime||t.regime));
const bySetupType=bucket(realTrades,'SETUP_TYPE',t=>normalize(t.setupType));
const byRegimeSetup=bucket(realTrades,'REGIME_SETUP',t=>`${normalize(t.runtimeRegime||t.regime)}|${normalize(t.setupType)}`);
const byRiskCluster=bucket(realTrades,'RISK_CLUSTER',t=>normalize(t.riskCluster));
const byEntrySession=bucket(realTrades,'ENTRY_SESSION',t=>normalize(t.entrySessionBucket));
const bySymbol=bucket(realTrades,'SYMBOL',t=>normalize(t.symbol),MIN_SYMBOL_SAMPLES);

const adjustmentRows=[...byRegime,...bySetupType,...byRegimeSetup,...byRiskCluster,...byEntrySession,...bySymbol].filter(x=>x.samples>=MIN_PRIORITY_SAMPLES&&x.state!=='INSUFFICIENT_DATA');
const rankingAdjustments=Object.fromEntries(adjustmentRows.map(x=>[`${x.dimension}:${x.key}`,{samples:x.samples,state:x.state,priorityScoreDelta:x.priorityScoreDelta,sizeMultiplier:x.sizeMultiplier,temporaryBlock:x.temporaryBlock,shrunkWinRatePct:x.shrunkWinRatePct,shrunkAverageR:x.shrunkAverageR}]));
const materialConclusions=adjustmentRows.filter(x=>x.state!=='NEUTRAL').sort((a,b)=>Math.abs(b.priorityScoreDelta)-Math.abs(a.priorityScoreDelta)).slice(0,20).map(x=>({dimension:x.dimension,key:x.key,samples:x.samples,state:x.state,shrunkWinRatePct:x.shrunkWinRatePct,shrunkAverageR:x.shrunkAverageR,priorityScoreDelta:x.priorityScoreDelta,sizeMultiplier:x.sizeMultiplier}));

const shadow=await read(shadowFile,{summary:{}});
const report={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  sourceOfTruth:'ROBINHOOD_CONFIRMED_REAL_FILLS_ONLY',
  status:realTrades.length?'ACTIVE':'WAITING_FOR_RECONCILED_REAL_FILLS',
  resolvedRealStockTrades:realTrades.length,
  policy:{
    recencyHalfLifeDays:HALF_LIFE_DAYS,
    shrinkagePseudoSamples:SHRINK_SAMPLES,
    minimumSamplesForPriority:MIN_PRIORITY_SAMPLES,
    minimumSamplesForTemporaryBlock:MIN_BLOCK_SAMPLES,
    minimumSamplesForSymbolLearning:MIN_SYMBOL_SAMPLES,
    mayIncreaseRankingPriority:true,
    mayReduceRankingPriority:true,
    mayReduceSize:true,
    mayTemporarilyBlockWeakPattern:true,
    mayIncreaseMaximumLiveRisk:false,
    mayLoosenHardSafetyGate:false,
    preserveUntouchedValidationHoldouts:true,
    note:'Adaptive evidence can only reorder already-qualified candidates or reduce/block risk. It cannot create eligibility, increase maximum risk, loosen validation, or override account/protection rules.'
  },
  overall:summarize(realTrades,{dimension:'OVERALL',key:'ALL_REAL_STOCK_TRADES'}),
  buckets:{byRegime,bySetupType,byRegimeSetup,byRiskCluster,byEntrySession,bySymbol},
  rankingAdjustments,
  materialConclusions,
  shadowDiagnostics:{separateFromRealMoney:true,summary:shadow?.summary||{},note:'Shadow history is diagnostic only and is never merged into real-fill adaptive statistics.'},
  ingestion:{journalFile:'docs/data/real-trade-journal.json',requiredForLearning:['reconciledFromRobinhood=true','resolved outcome WIN/LOSS/FLAT','finite realizedR'],note:'If a stock trade is not reconciled from Robinhood, it cannot influence live adaptive ranking.'}
};
await fs.writeFile(outFile,JSON.stringify(report,null,2));
console.log(`Adaptive performance: ${report.status}; real resolved stock trades=${realTrades.length}; conclusions=${materialConclusions.length}`);
