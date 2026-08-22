import fs from 'node:fs/promises';

const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const signal=await read('docs/signal.json');
const tournament=await read('docs/data/stock-tournament.json');
const shadow=await read('docs/data/shadow-trades.json',{trades:[]});
const adaptive=await read('docs/data/adaptive-performance.json',{});
const entryValidation=await read('docs/data/entry-gate-validation.json',{});
if(!signal||!tournament)throw new Error('signal or stock tournament missing');

const norm=s=>String(s??'UNKNOWN').trim().toUpperCase().replace(/\s+/g,'_')||'UNKNOWN';
const resolved=(shadow.trades||[]).filter(x=>x.status==='RESOLVED'&&Number.isFinite(Number(x.realizedR)));
const realBuckets=adaptive?.buckets||{};
const MIN_SHADOW_MICRO=6, MIN_SHADOW=12, MIN_REAL_PROBATION=8, MIN_REAL_FULL=15;
const SHADOW_MIN_WIN=50, SHADOW_MIN_AVG_R=.15, REAL_MIN_AVG_R=.10;
const HISTORICAL_MICRO_MIN_SAMPLES=30, HISTORICAL_MICRO_MIN_WIN=65, HISTORICAL_MICRO_MIN_RR=2.5;

function shadowStats(setup,regime){
  const exact=resolved.filter(x=>norm(x.setupType)===setup&&norm(x.runtimeRegime)===regime);
  const setupOnly=resolved.filter(x=>norm(x.setupType)===setup);
  const rows=exact.length>=MIN_SHADOW?exact:setupOnly;
  const wins=rows.filter(x=>Number(x.realizedR)>0).length;
  return {scope:exact.length>=MIN_SHADOW?'REGIME_SETUP':'SETUP_FALLBACK',samples:rows.length,winRatePct:rows.length?wins/rows.length*100:null,averageR:rows.length?rows.reduce((s,x)=>s+Number(x.realizedR),0)/rows.length:null};
}
function realStats(setup,regime){
  const exact=(realBuckets.byRegimeSetup||[]).find(x=>x.key===`${regime}|${setup}`);
  const fallback=(realBuckets.bySetupType||[]).find(x=>x.key===setup);
  return exact||fallback||{samples:0,averageRealizedR:null,winRatePct:null};
}
function admission(row){
  const setup=norm(row.setupType||'STOCK_TREND');
  const regime=norm(tournament?.adaptiveLearning?.currentRegime||signal?.stockTournament?.adaptiveLearning?.currentRegime||'UNKNOWN');
  const s=shadowStats(setup,regime),r=realStats(setup,regime);
  const historical={samples:Number(row.historicalSamples||row.validation?.samples||0),winRatePct:Number(row.historicalWinRate||row.validation?.winRate||0),rewardRisk:Number(row.rewardRisk||0)};
  const regimeDisabled=(entryValidation.disabledRegimes||[]).map(norm).includes(regime);
  const contradictoryShadow=s.samples>=3&&(Number(s.averageR)<0||Number(s.winRatePct)<40);
  const strongHistorical=historical.samples>=HISTORICAL_MICRO_MIN_SAMPLES&&historical.winRatePct>=HISTORICAL_MICRO_MIN_WIN&&historical.rewardRisk>=HISTORICAL_MICRO_MIN_RR&&!regimeDisabled&&!contradictoryShadow;
  const earlyShadowPassed=s.samples>=MIN_SHADOW_MICRO&&Number(s.winRatePct)>=SHADOW_MIN_WIN&&Number(s.averageR)>=SHADOW_MIN_AVG_R;
  const shadowPassed=s.samples>=MIN_SHADOW&&Number(s.winRatePct)>=SHADOW_MIN_WIN&&Number(s.averageR)>=SHADOW_MIN_AVG_R;
  let state='SHADOW_ONLY',sizeMultiplier=0,reason='Pattern has not yet proven positive shadow expectancy.';
  if(strongHistorical||earlyShadowPassed){state='MICRO_PROBATION';sizeMultiplier=.25;reason=strongHistorical?'Strong historical sample, win rate and reward/risk passed a tightly capped historical micro-probation; forward shadow tracking remains required.':'Early positive shadow evidence passed; live capital remains capped at one-quarter size.';}
  if(shadowPassed){state='PROBATION';sizeMultiplier=.5;reason='Shadow proof passed; live capital remains reduced while real-fill evidence accumulates.';}
  if(shadowPassed&&Number(r.samples)>=MIN_REAL_FULL&&Number(r.averageRealizedR)>=REAL_MIN_AVG_R){state='LIVE_ADMITTED';sizeMultiplier=1;reason='Shadow proof and sufficient positive real-fill evidence passed.';}
  else if(shadowPassed&&Number(r.samples)>=MIN_REAL_PROBATION&&Number(r.averageRealizedR)<0){state='LIVE_SUSPENDED';sizeMultiplier=0;reason='Real-fill probation is negative; return pattern to shadow-only observation.';}
  return {state,sizeMultiplier,setupType:setup,runtimeRegime:regime,historical,strongHistorical,regimeDisabled,contradictoryShadow,shadow:s,real:{samples:Number(r.samples||0),winRatePct:r.winRatePct??null,averageRealizedR:r.averageRealizedR??null},thresholds:{minimumShadowSamplesForMicro:MIN_SHADOW_MICRO,minimumShadowSamples:MIN_SHADOW,minimumShadowWinRatePct:SHADOW_MIN_WIN,minimumShadowAverageR:SHADOW_MIN_AVG_R,historicalMicroMinimumSamples:HISTORICAL_MICRO_MIN_SAMPLES,historicalMicroMinimumWinRatePct:HISTORICAL_MICRO_MIN_WIN,historicalMicroMinimumRewardRisk:HISTORICAL_MICRO_MIN_RR,microSizeMultiplier:.25,minimumRealSamplesForSuspensionCheck:MIN_REAL_PROBATION,minimumRealSamplesForFullAdmission:MIN_REAL_FULL,minimumRealAverageRForFullAdmission:REAL_MIN_AVG_R},reason};
}
function apply(row){const a=admission(row);const blocked=['SHADOW_ONLY','LIVE_SUSPENDED'].includes(a.state);const baseSize=Number(row.adaptiveSizeMultiplier??row.adaptiveLearning?.sizeMultiplier??1);return {...row,profitabilityAdmission:a,adaptiveSizeMultiplier:Math.min(baseSize,a.sizeMultiplier||0),action:blocked?'PROFITABILITY_ADMISSION_BLOCK':row.action};}

const live=(tournament.liveQueue||[]).map(apply);
const finalists=(tournament.researchFinalists||[]).map(apply);
const buyable=live.filter(x=>x.action==='AUTO_BUY_ELIGIBLE'&&!['SHADOW_ONLY','LIVE_SUSPENDED'].includes(x.profitabilityAdmission?.state));
tournament.liveQueue=live;tournament.researchFinalists=finalists;tournament.liveBuyChampion=buyable[0]||null;tournament.liveFallbacks=buyable.slice(1);
tournament.profitabilityAdmissionPolicy={enabled:true,mode:'HISTORICAL_MICRO_THEN_SHADOW_AND_REAL_ADMISSION',rule:'Strong historical evidence may unlock tightly capped one-quarter-size micro-probation only when the current regime is enabled and no contradictory forward evidence exists. Six positive independent shadow outcomes may also unlock micro-probation; twelve unlock half-size probation. Full normal eligible size still requires sufficient positive Robinhood-confirmed real fills. Negative evidence suspends the pattern. This gate may reduce or block but never raise a hard risk ceiling or loosen any safety rule.'};
const q=new Map(live.map(x=>[x.ticker||x.symbol,x]));
signal.stockPlan=signal.stockPlan||{};signal.stockPlan.stockCandidateQueue=(signal.stockPlan.stockCandidateQueue||[]).map(x=>q.has(x.ticker)?{...x,profitabilityAdmission:q.get(x.ticker).profitabilityAdmission,adaptiveSizeMultiplier:q.get(x.ticker).adaptiveSizeMultiplier,action:q.get(x.ticker).action}:x);
signal.stockTournament={...(signal.stockTournament||{}),profitabilityAdmissionPolicy:tournament.profitabilityAdmissionPolicy,liveBuyChampion:tournament.liveBuyChampion,liveFallbackTickers:tournament.liveFallbacks.map(x=>x.ticker)};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),shadowFirstProfitabilityAdmission:true}};
signal.schemaVersion=Math.max(42,Number(signal.schemaVersion||0));
await Promise.all([write('docs/data/stock-tournament.json',tournament),write('docs/signal.json',signal),write('docs/data/claude-signal.json',signal)]);
console.log(`Profitability admission: live=${buyable.length}; shadow-only=${live.filter(x=>x.profitabilityAdmission?.state==='SHADOW_ONLY').length}; micro=${live.filter(x=>x.profitabilityAdmission?.state==='MICRO_PROBATION').length}; probation=${live.filter(x=>x.profitabilityAdmission?.state==='PROBATION').length}; admitted=${live.filter(x=>x.profitabilityAdmission?.state==='LIVE_ADMITTED').length}; suspended=${live.filter(x=>x.profitabilityAdmission?.state==='LIVE_SUSPENDED').length}`);
