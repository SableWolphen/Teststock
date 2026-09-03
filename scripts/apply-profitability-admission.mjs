import fs from 'node:fs/promises';

const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const signal=await read('docs/signal.json');
const tournament=await read('docs/data/stock-tournament.json');
const shadow=await read('docs/data/shadow-trades.json',{trades:[]});
const realJournal=await read('docs/data/real-trade-journal.json',{trades:[]});
const adaptive=await read('docs/data/adaptive-performance.json',{});
const entryValidation=await read('docs/data/entry-gate-validation.json',{});
const probabilityPolicy=await read('docs/data/probability-first-policy.json',{});
if(!signal||!tournament)throw new Error('signal or stock tournament missing');

const norm=s=>String(s??'UNKNOWN').trim().toUpperCase().replace(/\s+/g,'_')||'UNKNOWN';
const resolvedShadow=(shadow.trades||[]).filter(x=>x.status==='RESOLVED'&&Number.isFinite(Number(x.realizedR))).map(x=>({...x,evidenceSource:'SHADOW'}));
const resolvedReal=(realJournal.trades||[]).filter(x=>x.assetClass==='STOCK'&&['WIN','LOSS','FLAT'].includes(x.outcome)&&Number.isFinite(Number(x.realizedR))).map(x=>({createdDate:String(x.entryFilledAt||x.finalExitAt||'').slice(0,10),symbol:x.symbol,setupType:x.setupType,runtimeRegime:x.runtimeRegime,realizedR:x.realizedR,evidenceSource:'REAL',journalId:x.journalId}));
const independentMap=new Map();
for(const x of [...resolvedShadow,...resolvedReal]){const k=[x.createdDate,x.symbol,norm(x.setupType),norm(x.runtimeRegime)].join('|'),old=independentMap.get(k);if(!old||Number(x.realizedR)<Number(old.realizedR))independentMap.set(k,x);}
const independentResolved=[...independentMap.values()];
const realBuckets=adaptive?.buckets||{};
const MIN_SHADOW_MICRO=6,MIN_SHADOW=12,MIN_REAL_PROBATION=8,MIN_REAL_FULL=15;
const SHADOW_MIN_WIN=50,SHADOW_MIN_AVG_R=.15,REAL_MIN_AVG_R=.10;

function shadowStats(setup,regime){
  const exact=independentResolved.filter(x=>norm(x.setupType)===setup&&norm(x.runtimeRegime)===regime);
  const setupOnly=independentResolved.filter(x=>norm(x.setupType)===setup);
  const rows=exact.length>=MIN_SHADOW?exact:setupOnly;
  const wins=rows.filter(x=>Number(x.realizedR)>0).length;
  const realFillSamples=rows.filter(x=>x.evidenceSource==='REAL').length;
  return {scope:exact.length>=MIN_SHADOW?'REGIME_SETUP':'SETUP_FALLBACK',samples:rows.length,winRatePct:rows.length?wins/rows.length*100:null,averageR:rows.length?rows.reduce((s,x)=>s+Number(x.realizedR),0)/rows.length:null,realFillSamples,shadowOnlySamples:rows.length-realFillSamples};
}
function realStats(setup,regime){
  const exact=(realBuckets.byRegimeSetup||[]).find(x=>x.key===`${regime}|${setup}`);
  const fallback=(realBuckets.bySetupType||[]).find(x=>x.key===setup);
  return exact||fallback||{samples:0,averageRealizedR:null,winRatePct:null};
}
function admission(row){
  const tier=String(row.entryTier||'A').toUpperCase();
  const setup=norm(row.setupType||'STOCK_TREND');
  const regime=norm(tournament?.adaptiveLearning?.currentRegime||signal?.stockTournament?.adaptiveLearning?.currentRegime||'UNKNOWN');
  const s=shadowStats(setup,regime),r=realStats(setup,regime);
  const historical={samples:Number(row.historicalSamples||row.validation?.samples||0),winRatePct:Number(row.historicalWinRate||row.validation?.winRate||0),rewardRisk:Number(row.rewardRisk||0)};
  const regimeDisabled=(entryValidation.disabledRegimes||[]).map(norm).includes(regime);
  const contradictoryShadow=s.samples>=3&&(Number(s.averageR)<0||Number(s.winRatePct)<40);
  const negativeRealProbation=Number(r.samples||0)>=MIN_REAL_PROBATION&&Number(r.averageRealizedR)<0;
  const earlyShadowPassed=s.samples>=MIN_SHADOW_MICRO&&Number(s.winRatePct)>=SHADOW_MIN_WIN&&Number(s.averageR)>=SHADOW_MIN_AVG_R&&!regimeDisabled&&!contradictoryShadow;
  const shadowPassed=s.samples>=MIN_SHADOW&&Number(s.winRatePct)>=SHADOW_MIN_WIN&&Number(s.averageR)>=SHADOW_MIN_AVG_R&&!regimeDisabled&&!contradictoryShadow;
  let state='SHADOW_ONLY',sizeMultiplier=0,reason='Candidate is not eligible because a hard profitability/regime contradiction remains.';

  if(negativeRealProbation){
    state='LIVE_SUSPENDED';sizeMultiplier=0;reason='Robinhood-confirmed real-fill probation is negative; live entry remains suspended.';
  }else if(!regimeDisabled&&!contradictoryShadow&&tier==='A'){
    state='ELITE_RUNTIME_ELIGIBLE';sizeMultiplier=1;reason='Elite A-tier candidate may use up to its normal encoded size after every downstream live Robinhood, freshness, entry, spread, portfolio and protection gate passes.';
  }else if(!regimeDisabled&&!contradictoryShadow&&tier==='B'){
    state='BEST_ACCEPTABLE_MICRO';sizeMultiplier=.25;reason='Best-acceptable B-tier candidate may enter only as a micro-probation position capped at one-quarter of normal candidate size after every downstream live guard passes.';
  }else if(earlyShadowPassed){
    state='MICRO_PROBATION';sizeMultiplier=.25;reason='Independent positive outcomes passed the micro evidence bar; live capital remains capped at one-quarter size.';
  }
  if(!['ELITE_RUNTIME_ELIGIBLE','BEST_ACCEPTABLE_MICRO','LIVE_SUSPENDED'].includes(state)&&shadowPassed){state='PROBATION';sizeMultiplier=.5;reason='Forward evidence passed; live capital remains reduced while real-fill evidence accumulates.';}
  if(!['ELITE_RUNTIME_ELIGIBLE','BEST_ACCEPTABLE_MICRO','LIVE_SUSPENDED'].includes(state)&&shadowPassed&&Number(r.samples)>=MIN_REAL_FULL&&Number(r.averageRealizedR)>=REAL_MIN_AVG_R){state='LIVE_ADMITTED';sizeMultiplier=1;reason='Forward proof and sufficient positive real-fill evidence passed.';}

  return {state,sizeMultiplier,entryTier:tier,setupType:setup,runtimeRegime:regime,historical,historicalEvidenceIsDiagnosticOnly:true,regimeDisabled,contradictoryShadow,negativeRealProbation,shadow:{...s,independenceKey:'decisionDate+symbol+setup+regime',duplicateResolutionRule:'Keep the most adverse realized R for duplicate keys.',evidencePoolNote:'Pool includes hypothetical shadow outcomes and resolved real Robinhood fills for this setup/regime; realFillSamples/shadowOnlySamples show the split.'},real:{samples:Number(r.samples||0),winRatePct:r.winRatePct??null,averageRealizedR:r.averageRealizedR??null},thresholds:{minimumIndependentShadowSamplesForMicro:MIN_SHADOW_MICRO,minimumIndependentShadowSamples:MIN_SHADOW,minimumShadowWinRatePct:SHADOW_MIN_WIN,minimumShadowAverageR:SHADOW_MIN_AVG_R,eliteARuntimeSizeMultiplier:1,bestAcceptableBMicroSizeMultiplier:.25,minimumRealSamplesForSuspensionCheck:MIN_REAL_PROBATION,minimumRealSamplesForFullAdmission:MIN_REAL_FULL,minimumRealAverageRForFullAdmission:REAL_MIN_AVG_R},reason};
}
function apply(row){
  const a=admission(row);
  const blocked=['SHADOW_ONLY','LIVE_SUSPENDED'].includes(a.state);
  const baseSize=Number(row.adaptiveSizeMultiplier??row.adaptiveLearning?.sizeMultiplier??row.entryTierSizeMultiplier??1);
  const cappedSize=Math.min(baseSize,a.sizeMultiplier||0,row.entryTier==='B'?.25:1);
  return {...row,profitabilityAdmission:a,adaptiveSizeMultiplier:cappedSize,action:blocked?'PROFITABILITY_ADMISSION_BLOCK':row.action,seedLane:{eligible:false},dayTradeSeedLane:{eligible:false}};
}

const live=(tournament.liveQueue||[]).map(apply);
const finalists=(tournament.researchFinalists||[]).map(apply);
const buyable=live.filter(x=>x.action==='AUTO_BUY_ELIGIBLE'&&!['SHADOW_ONLY','LIVE_SUSPENDED'].includes(x.profitabilityAdmission?.state));
tournament.liveQueue=live;tournament.researchFinalists=finalists;tournament.liveBuyChampion=buyable[0]||null;tournament.liveFallbacks=buyable.slice(1);

// Retain the legacy $5 A-tier seed lane as a fail-closed fallback for any future upstream path that
// still emits a safe A candidate as SHADOW_ONLY. In the current tiered policy, normal safe A rows
// become ELITE_RUNTIME_ELIGIBLE before this point, so this lane is normally dormant.
const seedLaneConfig=probabilityPolicy?.stocks?.seedLane||{enabled:false};
if(seedLaneConfig.enabled===true){
  const todayUtc=new Date().toISOString().slice(0,10);
  const seedTrades=(realJournal.trades||[]).filter(x=>x.assetClass==='STOCK'&&x.seedLane===true);
  const openSeedTickers=new Set(seedTrades.filter(x=>x.outcome==='OPEN').map(x=>x.symbol));
  const stoppedTodaySeedTickers=new Set(seedTrades.filter(x=>x.outcome==='LOSS'&&x.exitReason==='STOP'&&String(x.finalExitAt||'').slice(0,10)===todayUtc).map(x=>x.symbol));
  const maxConcurrent=Number(seedLaneConfig.maxConcurrentPositions||1);
  const openedToday=seedTrades.filter(x=>String(x.entryFilledAt||'').slice(0,10)===todayUtc).length;
  const dailyRemaining=Math.max(0,Number(seedLaneConfig.maxNewPositionsPerUtcDay||1)-openedToday);
  const availableSlots=dailyRemaining>0?Math.max(0,maxConcurrent-openSeedTickers.size):0;
  if(availableSlots>0){
    const eligiblePool=live.filter(x=>x.entryTier==='A'&&x.profitabilityAdmission?.state==='SHADOW_ONLY'&&!x.profitabilityAdmission?.regimeDisabled&&!x.profitabilityAdmission?.contradictoryShadow&&!openSeedTickers.has(x.ticker)&&!stoppedTodaySeedTickers.has(x.ticker));
    eligiblePool.sort((a,b)=>Number(a.queueRank??999)-Number(b.queueRank??999));
    for(const chosen of eligiblePool.slice(0,availableSlots))chosen.seedLane={eligible:true,maxOrderUsd:Number(seedLaneConfig.maxOrderUsd||5),requiredEntryTier:seedLaneConfig.requiredEntryTier||'A',requiresPerOrderApproval:false,maxConcurrentPositions:maxConcurrent,maxNewPositionsPerUtcDay:Number(seedLaneConfig.maxNewPositionsPerUtcDay||1),currentOpenSeedPositions:openSeedTickers.size,openedSeedPositionsToday:openedToday,existingRobinhoodCashOnly:true,agentMayInitiateDeposits:false,agentMayInitiateBankTransfers:false,marginAllowed:false,requiresBrokerResidentStop:seedLaneConfig.requiresBrokerResidentStop===true,rotatesToNextCandidateAfterStop:true,rule:seedLaneConfig.rule||'Bounded automatic stock seed lane using existing Robinhood cash only.'};
  }
}

const swingSelectedTickers=new Set(live.filter(x=>x.seedLane?.eligible===true).map(x=>x.ticker));
const dayTradeConfig=probabilityPolicy?.stocks?.dayTradeSeedLane||{enabled:false};
if(dayTradeConfig.enabled===true){
  const todayUtc=new Date().toISOString().slice(0,10);
  const dayTrades=(realJournal.trades||[]).filter(x=>x.assetClass==='STOCK'&&x.dayTradeSeedLane===true);
  const openTickers=new Set(dayTrades.filter(x=>x.outcome==='OPEN').map(x=>x.symbol));
  const openedToday=dayTrades.filter(x=>String(x.entryFilledAt||'').slice(0,10)===todayUtc).length;
  const maxConcurrent=Number(dayTradeConfig.maxConcurrentPositions||1);
  const dailyRemaining=Math.max(0,Number(dayTradeConfig.maxNewPositionsPerUtcDay||1)-openedToday);
  const availableSlots=dailyRemaining>0?Math.max(0,maxConcurrent-openTickers.size):0;
  if(availableSlots>0){
    const eligiblePool=live.filter(x=>x.entryTier==='A'&&x.profitabilityAdmission?.state==='SHADOW_ONLY'&&!x.profitabilityAdmission?.regimeDisabled&&!x.profitabilityAdmission?.contradictoryShadow&&!openTickers.has(x.ticker)&&!swingSelectedTickers.has(x.ticker)).sort((a,b)=>Number(a.queueRank??999)-Number(b.queueRank??999));
    for(const chosen of eligiblePool.slice(0,availableSlots))chosen.dayTradeSeedLane={eligible:true,maxOrderUsd:Number(dayTradeConfig.maxOrderUsd||20),requiredEntryTier:dayTradeConfig.requiredEntryTier||'A',requiresPerOrderApproval:false,maxConcurrentPositions:maxConcurrent,maxNewPositionsPerUtcDay:Number(dayTradeConfig.maxNewPositionsPerUtcDay||1),currentOpenDayTradeSeedPositions:openTickers.size,openedDayTradeSeedPositionsToday:openedToday,existingRobinhoodCashOnly:true,agentMayInitiateDeposits:false,agentMayInitiateBankTransfers:false,marginAllowed:false,requiresBrokerResidentStop:dayTradeConfig.requiresBrokerResidentStop===true,mustBeFlatBeforeMarketClose:true,entryCutoffMinutesBeforeClose:Number(dayTradeConfig.entryCutoffMinutesBeforeClose||30),forcedExitStartMinutesBeforeClose:Number(dayTradeConfig.forcedExitStartMinutesBeforeClose||15),journalTag:'dayTradeSeedLane:true',rule:dayTradeConfig.rule};
  }
}

tournament.profitabilityAdmissionPolicy={enabled:true,mode:'TIERED_A_NORMAL_B_MICRO_WITH_REAL_SUSPENSION',rule:'A-tier research winners no longer need to wait for a large forward-shadow sample before becoming runtime-eligible; they may use up to their already-encoded normal size only after every downstream Teststock and live Robinhood guard passes. B-tier best-acceptable stocks are capped at 25% micro-probation size. Disabled regimes, contradictory shadow evidence, or negative Robinhood-confirmed real-fill probation remain hard blocks. Historical/backtest evidence remains diagnostic and cannot override a failed live guard.'};
const q=new Map(live.map(x=>[x.ticker||x.symbol,x]));
signal.stockPlan=signal.stockPlan||{};signal.stockPlan.stockCandidateQueue=(signal.stockPlan.stockCandidateQueue||[]).map(x=>q.has(x.ticker)?{...x,profitabilityAdmission:q.get(x.ticker).profitabilityAdmission,adaptiveSizeMultiplier:q.get(x.ticker).adaptiveSizeMultiplier,action:q.get(x.ticker).action,seedLane:q.get(x.ticker).seedLane,dayTradeSeedLane:q.get(x.ticker).dayTradeSeedLane}:x);
signal.stockTournament={...(signal.stockTournament||{}),profitabilityAdmissionPolicy:tournament.profitabilityAdmissionPolicy,liveBuyChampion:tournament.liveBuyChampion,liveFallbackTickers:tournament.liveFallbacks.map(x=>x.ticker)};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),shadowFirstProfitabilityAdmission:false,tieredStockProfitabilityAdmission:true,eliteARuntimeEligibility:true,bTierMicroProbation:true}};
signal.schemaVersion=Math.max(44,Number(signal.schemaVersion||0));
await Promise.all([write('docs/data/stock-tournament.json',tournament),write('docs/signal.json',signal),write('docs/data/claude-signal.json',signal)]);
console.log(`Profitability admission: buyable=${buyable.length}; eliteA=${live.filter(x=>x.profitabilityAdmission?.state==='ELITE_RUNTIME_ELIGIBLE').length}; microB=${live.filter(x=>x.profitabilityAdmission?.state==='BEST_ACCEPTABLE_MICRO').length}; suspended=${live.filter(x=>x.profitabilityAdmission?.state==='LIVE_SUSPENDED').length}`);
