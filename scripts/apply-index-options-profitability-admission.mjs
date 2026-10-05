import fs from 'node:fs/promises';

const read=async(f,x)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2)+'\n');
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));

const shadow=await read('docs/data/index-options-shadow-trades.json',{trades:[]});
const realJournal=await read('docs/data/index-options-real-trade-journal.json',{trades:[],summary:{}});
const livePolicy=await read('docs/data/index-options-live-policy.json',{enabled:false});
const resolved=(shadow.trades||[]).filter(x=>
  x?.status==='RESOLVED' &&
  x?.evidenceEligible===true &&
  ['XND','DJX'].includes(x?.indexSymbol) &&
  Number.isFinite(Number(x?.realizedR))
);

const independentMap=new Map();
for(const x of resolved){
  const key=`${x.createdDate}|${x.indexSymbol}`;
  const old=independentMap.get(key);
  if(!old||Number(x.realizedR)<Number(old.realizedR))independentMap.set(key,x);
}
const independent=[...independentMap.values()];
const wins=independent.filter(x=>Number(x.realizedR)>0).length;
const gains=independent.filter(x=>Number(x.realizedR)>0).reduce((s,x)=>s+Number(x.realizedR),0);
const losses=Math.abs(independent.filter(x=>Number(x.realizedR)<0).reduce((s,x)=>s+Number(x.realizedR),0));
const shadowStats={
  samples:independent.length,
  distinctTradingDays:new Set(independent.map(x=>x.createdDate).filter(Boolean)).size,
  winRatePct:independent.length?round(wins/independent.length*100,1):null,
  averageR:independent.length?round(independent.reduce((s,x)=>s+Number(x.realizedR),0)/independent.length,3):null,
  profitFactor:losses>0?round(gains/losses,2):gains>0?999:null,
};

const realSummary=realJournal.summary||{};
const real={
  samples:Number(realSummary.resolvedTrades||0),
  winRatePct:realSummary.winRatePct??null,
  averageRealizedR:realSummary.averageRealizedR??null,
};

const MICRO={samples:50,days:20,winRatePct:50,averageR:.05,profitFactor:1.30};
const PROBATION={samples:100,days:30,winRatePct:50,averageR:.08,profitFactor:1.35};
const LIVE={samples:10,winRatePct:50,averageR:.25};

const passes=t=>shadowStats.samples>=t.samples&&shadowStats.distinctTradingDays>=t.days&&
  Number(shadowStats.winRatePct)>=t.winRatePct&&Number(shadowStats.averageR)>=t.averageR&&
  Number(shadowStats.profitFactor)>=t.profitFactor;

let state=livePolicy.enabled===true?'LIVE_MICRO_BOOTSTRAP':'SHADOW_ONLY',sizeMultiplier=livePolicy.enabled===true?.05:0,reason=livePolicy.enabled===true?'User-authorized XND/DJX real-money micro bootstrap is active. This is not earned profitability admission; exact live Robinhood contract checks and the dedicated $5/day bootstrap caps still apply.':'XND/DJX have not yet earned separate broker-resolved forward evidence. ETF proxy performance never counts as index-option admission.';
if(passes(MICRO)){state='MICRO_PROBATION';sizeMultiplier=.25;reason='Index options passed the strict broker-resolved micro-probation shadow threshold; live execution still requires every broker/account/contract gate.';}
if(passes(PROBATION)){state='PROBATION';sizeMultiplier=.5;reason='Index options passed the stricter probation shadow threshold; live size remains reduced until real-fill evidence is positive.';}
if(passes(PROBATION)&&real.samples>=LIVE.samples&&Number(real.winRatePct)>=LIVE.winRatePct&&Number(real.averageRealizedR)>=LIVE.averageR){
  state='LIVE_ADMITTED';sizeMultiplier=1;reason='Index options passed both broker-resolved shadow proof and the required positive Robinhood-confirmed real-fill threshold.';
}else if(real.samples>=3&&Number(real.averageRealizedR)<0){
  state='LIVE_SUSPENDED';sizeMultiplier=0;reason='Robinhood-confirmed index-option real-fill expectancy is negative; new index-option risk is suspended.';
}

const out={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  state,
  sizeMultiplier,
  executionAuthorized:['LIVE_MICRO_BOOTSTRAP','MICRO_PROBATION','PROBATION','LIVE_ADMITTED'].includes(state),
  bootstrapLivePolicy:livePolicy.enabled===true?livePolicy:null,
  reason,
  scope:['XND','DJX'],
  shadow:{...shadowStats,independenceKey:'createdDate+indexSymbol',source:'index-options-shadow-trades.json',exactContractEvidenceRequired:true},
  real:{...real,source:'index-options-real-trade-journal.json'},
  thresholds:{micro:MICRO,probation:PROBATION,live:LIVE},
  rules:[
    'Only exact XND/DJX contracts resolved from Robinhood count; QQQ/DIA or other ETF option outcomes never count.',
    'Entry evidence uses executable ask and exit evidence uses executable bid, not midpoint or theoretical value.',
    'LIVE_MICRO_BOOTSTRAP is a user-authorized real-money learning override, not earned evidence. It is capped by index-options-live-policy.json and may never be represented as MICRO_PROBATION.',
    'At least 50 independent broker-resolved outcomes across 20 trading days and profit factor >= 1.30 are required before evidence-earned micro probation.',
    'A live loss can reduce or suspend future risk; this file can never raise account or premium-risk ceilings.',
  ],
};
await write('docs/data/index-options-profitability-admission.json',out);
console.log(`Index-options admission: state=${state} shadowSamples=${shadowStats.samples} realSamples=${real.samples}`);
