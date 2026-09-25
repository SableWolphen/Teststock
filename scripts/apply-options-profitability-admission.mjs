import fs from 'node:fs/promises';

// Phase 1 of the options shadow-evidence pipeline (2026-09-25, user-requested). Mirrors
// apply-crypto-profitability-admission.mjs's shape exactly: shadow (paper) evidence can only
// unlock a capped, reduced-size probation tier, never full admission on its own. Full
// admission still requires the real-fill thresholds already declared in
// probability-first-policy.json's options section (10 resolved live trades, etc.) -- this
// script does not change those. Nothing here places an order or grants new authorization by
// itself; wiring an actual live seed lane against this state is a separate, later step.
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2)+'\n');
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));

const shadow=await read('docs/data/options-shadow-trades.json',{trades:[]});
const evidence=await read('docs/data/options-real-trade-journal.json',{summary:{}});
const policy=await read('docs/data/probability-first-policy.json',{});
const optionsPolicy=policy.options||{};

const resolved=(shadow.trades||[]).filter(x=>x.status==='RESOLVED'&&Number.isFinite(Number(x.realizedR)));
const independentMap=new Map();
for(const x of resolved){
  const k=`${x.createdDate}|${x.underlying}`;
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

// Options shadow trades open at most one per UTC day (vs. crypto's continuous 24/7 flow), so
// these thresholds are deliberately smaller than crypto's -- but still require real,
// independent, positive forward evidence before any live capital, capped and reduced even then.
const MIN_SHADOW_MICRO=8, MIN_SHADOW=15;
const SHADOW_MIN_WIN=52, SHADOW_MIN_AVG_R=.1;
const REAL_MIN_RESOLVED=Number(optionsPolicy.liveEvidenceMinimumResolvedTrades??10);
const REAL_MIN_AVG_R=Number(optionsPolicy.liveEvidenceMinimumAverageR??0.25);
const REAL_MIN_WIN=Number(optionsPolicy.liveEvidenceMinimumWinRatePct??50);
const REAL_MIN_SUSPEND_CHECK=3;

const contradictoryShadow=shadowStats.samples>=3&&(Number(shadowStats.averageR)<0||Number(shadowStats.winRatePct)<40);
const earlyShadowPassed=shadowStats.samples>=MIN_SHADOW_MICRO&&Number(shadowStats.winRatePct)>=SHADOW_MIN_WIN&&Number(shadowStats.averageR)>=SHADOW_MIN_AVG_R&&!contradictoryShadow;
const shadowPassed=shadowStats.samples>=MIN_SHADOW&&Number(shadowStats.winRatePct)>=SHADOW_MIN_WIN&&Number(shadowStats.averageR)>=SHADOW_MIN_AVG_R;

let state='SHADOW_ONLY',sizeMultiplier=0,reason='Options pattern has not yet proven positive shadow expectancy; zero or unknown forward evidence is never a pass. No live option order is authorized in this state.';
if(earlyShadowPassed){state='MICRO_PROBATION';sizeMultiplier=.25;reason=`${MIN_SHADOW_MICRO} independent positive forward-shadow outcomes passed; any future live options capital would remain capped at one-quarter size. This state alone still does not authorize a live order -- that requires a separate, explicit execution-lane policy.`;}
if(shadowPassed){state='PROBATION';sizeMultiplier=.5;reason=`${MIN_SHADOW} independent positive shadow outcomes passed; any future live options capital would remain reduced while real-fill evidence accumulates. This state alone still does not authorize a live order.`;}
if(shadowPassed&&real.samples>=REAL_MIN_RESOLVED&&Number(real.averageRealizedR)>=REAL_MIN_AVG_R&&Number(real.winRatePct)>=REAL_MIN_WIN){
  state='LIVE_ADMITTED';sizeMultiplier=1;reason='Shadow proof and sufficient positive real-fill evidence passed; probability-first-policy.json\'s options real-fill gate is satisfied.';
}else if(shadowPassed&&real.samples>=REAL_MIN_SUSPEND_CHECK&&Number(real.averageRealizedR)<0){
  state='LIVE_SUSPENDED';sizeMultiplier=0;reason='Real-fill options evidence has turned negative; returned to shadow-only observation.';
}

const admission={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  state,
  sizeMultiplier,
  reason,
  executionAuthorized:['MICRO_PROBATION','PROBATION','LIVE_ADMITTED'].includes(state),
  executionAuthorizedNote:'Execution authorization is earned only after the shadow evidence state reaches MICRO_PROBATION, PROBATION, or LIVE_ADMITTED. SHADOW_ONLY and LIVE_SUSPENDED remain blocked. The separate options policy and live broker rechecks still remain mandatory.',
  shadow:{...shadowStats,independenceKey:'createdDate+underlying',duplicateResolutionRule:'Keep the most adverse realized R for duplicate keys.',scopeNote:'Paper-only shadow outcomes from update-options-shadow-ledger.mjs; at most one new sample per UTC day.'},
  real:{...real,source:'options-real-trade-journal.json'},
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
    'Shadow (paper) evidence can only unlock a capped, reduced-size probation tier -- never full admission, never live execution by itself.',
    'Full admission still requires the real-fill thresholds already declared in probability-first-policy.json\'s options section, unchanged by this file.',
    'This overlay can only reduce or block size; it can never raise it above whatever a future execution-lane policy declares.',
    'executionAuthorized becomes true only for an earned admission state; the separate options execution policy and live broker rechecks remain mandatory.',
  ],
};

await write('docs/data/options-profitability-admission.json',admission);
console.log(`Options profitability admission: state=${state} sizeMultiplier=${sizeMultiplier} shadowSamples=${shadowStats.samples} realSamples=${real.samples}`);
