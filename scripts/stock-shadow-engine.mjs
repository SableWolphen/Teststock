import {measuredNumber,validEvidenceDate} from './performance-evidence.mjs';
const positive=x=>measuredNumber(x)&&Number(x)>0;
const day=x=>String(x||'').slice(0,10);

// Explicit research assumption, not a measured broker fee or fill guarantee.
// Charge 10 bps on each side for spread/slippage. Report sensitivity separately.
export const STOCK_SHADOW_COST_MODEL=Object.freeze({version:1,roundTripSideBps:10,scope:'ASSUMED_SPREAD_AND_SLIPPAGE',brokerVerified:false});

export function netShadowResult(entry,exit,stop,sideBps=STOCK_SHADOW_COST_MODEL.roundTripSideBps) {
  if(![entry,exit,stop].every(positive)||Number(stop)>=Number(entry)||typeof sideBps!=='number'||!Number.isFinite(sideBps)||sideBps<0) return null;
  const risk=Number(entry)-Number(stop),grossR=(Number(exit)-Number(entry))/risk;
  const transactionCostR=(Number(entry)+Number(exit))*sideBps/10000/risk;
  return {grossRealizedR:grossR,transactionCostR,realizedR:grossR-transactionCostR};
}

export function resolveStockShadowTrade(trade,bars,now=Date.now()) {
  if(trade.status!=='OPEN')return trade;
  const entry=Number(trade.entry),stop=Number(trade.stop),target=Number(trade.target2??trade.target1);
  if(!validEvidenceDate(trade.createdDate)||![trade.entry,trade.stop,trade.target2??trade.target1].every(positive)||!(entry>stop&&target>entry))return {...trade,status:'UNKNOWN',realizedR:null,notes:'Invalid shadow geometry or decision date'};
  const unique=new Map();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  for(const b of bars||[]) {
    const date=day(b.t);
    if(!validEvidenceDate(date)||date<=trade.createdDate||date>=today||![b.o,b.h,b.l,b.c].every(positive)||Number(b.l)>Number(b.h)||Number(b.o)<Number(b.l)||Number(b.o)>Number(b.h)||Number(b.c)<Number(b.l)||Number(b.c)>Number(b.h))continue;
    if(!unique.has(date))unique.set(date,b);
  }
  const forward=[...unique.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(0,20).map(([,b])=>b);
  let entered=false,entryTouchedAt=null;
  const finish=(bar,exit,exitReason)=>{
    const result=netShadowResult(entry,exit,stop);
    return {...trade,...result,status:'RESOLVED',outcome:result.realizedR>0?'WIN':result.realizedR<0?'LOSS':'FLAT',entryTouchedAt,resolvedAt:day(bar.t),modelExitPrice:exit,exitReason,
      timeHorizon:'SWING_20_SESSIONS',afterCosts:true,costModel:STOCK_SHADOW_COST_MODEL,
      costSensitivity:Object.fromEntries([5,10,20].map(bps=>[`${bps}BPS_PER_SIDE`,netShadowResult(entry,exit,stop,bps).realizedR]))};
  };
  for(const b of forward) {
    const alreadyEntered=entered;
    if(!entered) {
      if(!(Number(b.l)<=entry&&Number(b.h)>=entry))continue;
      entered=true;entryTouchedAt=day(b.t);
    }
    // An overnight gap through the stop loses more than one R. Never clamp it away.
    if(alreadyEntered&&Number(b.o)<=stop)return finish(b,Number(b.o),'STOP_GAP');
    const stopHit=Number(b.l)<=stop,targetHit=Number(b.h)>=target;
    if(stopHit&&targetHit)return {...trade,status:'AMBIGUOUS',entryTouchedAt,resolvedAt:day(b.t),realizedR:null,notes:'Daily OHLC cannot determine stop/target ordering.'};
    // On the entry bar the high/low may predate the fill. Do not invent ordering.
    if(!alreadyEntered&&(stopHit||targetHit))return {...trade,status:'AMBIGUOUS',entryTouchedAt,resolvedAt:day(b.t),realizedR:null,notes:'Entry and exit touched on the same daily bar; intraday ordering unknown.'};
    if(stopHit)return finish(b,stop,'STOP');
    if(targetHit)return finish(b,target,'TARGET');
  }
  if(forward.length>=20) {
    const last=forward.at(-1);
    return entered?finish(last,Number(last.c),'TIME_EXIT'):{...trade,status:'EXPIRED',resolvedAt:day(last.t),realizedR:null,notes:'Entry not reached within 20 observed sessions.'};
  }
  return {...trade,entryTouchedAt};
}

export function eligibleStockShadowEvidence(trade,{intradayOnly=false}={}) {
  if(trade.evidenceEligible===false)return false;
  if(trade.status!=='RESOLVED'||trade.decision!=='ACCEPTED'||trade.afterCosts!==true||!measuredNumber(trade.realizedR)||!measuredNumber(trade.grossRealizedR)||!measuredNumber(trade.transactionCostR)||Number(trade.transactionCostR)<0) return false;
  if(Math.abs(Number(trade.grossRealizedR)-Number(trade.transactionCostR)-Number(trade.realizedR))>1e-6)return false;
  if(intradayOnly) {
    if(trade.timeHorizon!=='INTRADAY'||!sameSessionOutcome(trade.entryFilledAt||trade.entryTouchedAt,trade.resolvedAt))return false;
  }
  return true;
}

export function sameSessionOutcome(entry,exit) {
  if(typeof entry!=='string'||typeof exit!=='string'||!entry.includes('T')||!exit.includes('T'))return false;
  const start=Date.parse(entry),end=Date.parse(exit);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>24*3600000)return false;
  const session=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
  return session(start)===session(end);
}
