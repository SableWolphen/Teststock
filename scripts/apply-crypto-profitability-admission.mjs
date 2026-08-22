import fs from 'node:fs/promises';

const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2)+'\n');
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));

const shadow=await read('docs/data/crypto-shadow-trades.json',{trades:[]});
const evidence=await read('docs/data/crypto-real-trade-journal.json',{summary:{}});
const policy=await read('docs/data/probability-first-policy.json',{});
const cryptoPolicy=policy.crypto||{};

// Only ACCEPTED shadow trades count toward admission: these are the setups Teststock's own
// crypto tournament actually would have bought (they cleared setupGrade A/A+, liquidity, trend,
// and 4-hour confirmation and were the day's chosen allocation). REJECTED rows stay in
// crypto-shadow-trades.json for opportunity-cost diagnostics only, per CLAUDE.md's rule that
// backtests/historical stats are diagnostic and cannot themselves create eligibility.
const acceptedResolved=(shadow.trades||[]).filter(x=>x.decision==='ACCEPTED'&&x.status==='RESOLVED'&&Number.isFinite(Number(x.realizedR)));
const independentMap=new Map();
for(const x of acceptedResolved){
  const k=`${x.createdDate}|${x.symbol}`;
  const old=independentMap.get(k);
  if(!old||Number(x.realizedR)<Number(old.realizedR))independentMap.set(k,x);
}
const independent=[...independentMap.values()];
const wins=independent.filter(x=>Number(x.realizedR)>0).length;
const shadowStats={
  samples:independent.length,
  winRatePct:independent.length?round(wins/independent.length*100,1):null,
  averageR:independent.length?round(independent.reduce((s,x)=>s+Number(x.realizedR),0)/independent.length,2):null,
};

const realSummary=evidence.summary||{};
const real={
  samples:Number(realSummary.resolvedTrades||0),
  winRatePct:realSummary.winRatePct??null,
  averageRealizedR:realSummary.averageRealizedR??null,
};

const MIN_SHADOW_MICRO=6, MIN_SHADOW=12;
const SHADOW_MIN_WIN=50, SHADOW_MIN_AVG_R=.15;
const REAL_MIN_RESOLVED=Number(cryptoPolicy.liveEvidenceMinimumResolvedTrades??5);
const REAL_MIN_AVG_R=Number(cryptoPolicy.liveEvidenceMinimumAverageR??0.1);
const REAL_MIN_WIN=Number(cryptoPolicy.liveEvidenceMinimumWinRatePct??45);
const REAL_MIN_SUSPEND_CHECK=3;

const contradictoryShadow=shadowStats.samples>=3&&(Number(shadowStats.averageR)<0||Number(shadowStats.winRatePct)<40);
const earlyShadowPassed=shadowStats.samples>=MIN_SHADOW_MICRO&&Number(shadowStats.winRatePct)>=SHADOW_MIN_WIN&&Number(shadowStats.averageR)>=SHADOW_MIN_AVG_R&&!contradictoryShadow;
const shadowPassed=shadowStats.samples>=MIN_SHADOW&&Number(shadowStats.winRatePct)>=SHADOW_MIN_WIN&&Number(shadowStats.averageR)>=SHADOW_MIN_AVG_R;

let state='SHADOW_ONLY',sizeMultiplier=0,reason='Crypto pattern has not yet proven positive shadow expectancy; zero or unknown forward evidence is never a pass.';
if(earlyShadowPassed){state='MICRO_PROBATION';sizeMultiplier=.25;reason='Six independent positive forward-shadow outcomes passed; live crypto capital remains capped at one-quarter size.';}
if(shadowPassed){state='PROBATION';sizeMultiplier=.5;reason='Twelve independent positive shadow outcomes passed; live crypto capital remains reduced while real-fill evidence accumulates.';}
if(shadowPassed&&real.samples>=REAL_MIN_RESOLVED&&Number(real.averageRealizedR)>=REAL_MIN_AVG_R&&Number(real.winRatePct)>=REAL_MIN_WIN){
  state='LIVE_ADMITTED';sizeMultiplier=1;reason='Shadow proof and sufficient positive real-fill evidence passed; full size restored.';
}else if(shadowPassed&&real.samples>=REAL_MIN_SUSPEND_CHECK&&Number(real.averageRealizedR)<0){
  state='LIVE_SUSPENDED';sizeMultiplier=0;reason='Real-fill crypto evidence has turned negative; returned to shadow-only observation.';
}

const admission={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  state,
  sizeMultiplier,
  reason,
  shadow:{...shadowStats,independenceKey:'decisionDate+symbol',duplicateResolutionRule:'Keep the most adverse realized R for duplicate keys.',scopeNote:'Counts ACCEPTED (would-have-bought) shadow outcomes only.'},
  real:{...real,source:'crypto-real-trade-journal.json'},
  thresholds:{
    minimumIndependentShadowSamplesForMicro:MIN_SHADOW_MICRO,
    minimumIndependentShadowSamples:MIN_SHADOW,
    minimumShadowWinRatePct:SHADOW_MIN_WIN,
    minimumShadowAverageR:SHADOW_MIN_AVG_R,
    microSizeMultiplier:.25,
    probationSizeMultiplier:.5,
    minimumRealResolvedForFullAdmission:REAL_MIN_RESOLVED,
    minimumRealAverageRForFullAdmission:REAL_MIN_AVG_R,
    minimumRealWinRatePctForFullAdmission:REAL_MIN_WIN,
    minimumRealSamplesForSuspensionCheck:REAL_MIN_SUSPEND_CHECK,
  },
  rules:[
    'Backtests and historical calibration samples remain diagnostic only; they cannot create eligibility here.',
    'Six independent positive forward-shadow outcomes unlock one-quarter-size MICRO_PROBATION; twelve unlock half-size PROBATION.',
    'Full-size LIVE_ADMITTED still requires the already-declared crypto real-fill thresholds in probability-first-policy.json.',
    'This overlay can only reduce or block size; it can never raise it above the values already declared in probability-first-policy.json.',
    'scripts/robinhood_crypto_autopilot.py reads this file (state + sizeMultiplier only, no market/account data) before evaluating any new crypto buy.',
  ],
};

await write('docs/data/crypto-profitability-admission.json',admission);
console.log(`Crypto profitability admission: state=${state} sizeMultiplier=${sizeMultiplier} shadowSamples=${shadowStats.samples} realSamples=${real.samples}`);
