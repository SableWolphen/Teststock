// Pure resolution/creation logic for the options shadow ledger, kept separate from
// options-shadow-ledger.mjs's network/file I/O so it can be unit tested without live
// Alpaca calls -- same split as crypto-monitor-candidates.mjs / test-crypto-monitoring.mjs.
const round=(n,d=4)=>Number(Number(n||0).toFixed(d));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

// Version 2 models an intraday long-option exit using executable prices. It arms a
// progressively higher floor as the bid rises, and never lowers that floor. The final
// target is deliberately beyond the first profit-lock threshold so the paper ledger can
// measure how much continuation was retained versus given back.
export const TARGET_MULTIPLIER=2;
export const STOP_MULTIPLIER=0.6;
export const BREAK_EVEN_ARM_MULTIPLIER=1.2;
export const FIRST_LOCK_ARM_MULTIPLIER=1.35;
export const FIRST_LOCK_FLOOR_MULTIPLIER=1.15;
export const TRAIL_ARM_MULTIPLIER=1.5;
export const TRAIL_FRACTION=0.8;

export function newYorkSession(nowIso){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(nowIso)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const date=`${parts.year}-${parts.month}-${parts.day}`,minute=Number(parts.hour)*60+Number(parts.minute);
  return {date,minute,entryAllowed:minute>=575&&minute<930,forcedExitDue:minute>=950&&minute<=960};
}

export function protectedFloor(entry,highWaterBid,initialStop){
  let floor=Number(initialStop);
  if(highWaterBid>=entry*BREAK_EVEN_ARM_MULTIPLIER)floor=Math.max(floor,entry);
  if(highWaterBid>=entry*FIRST_LOCK_ARM_MULTIPLIER)floor=Math.max(floor,entry*FIRST_LOCK_FLOOR_MULTIPLIER);
  if(highWaterBid>=entry*TRAIL_ARM_MULTIPLIER)floor=Math.max(floor,highWaterBid*TRAIL_FRACTION);
  return round(floor,4);
}

export function buildShadowTradeId(contract,createdDate){
  return `${createdDate}-${contract}`;
}

// Shadow entries mirror the live small-account option lane rather than opening a basket
// and cherry-picking its worst member afterward. The default lane permits WEEKLY/STANDARD
// long calls/puts and only contracts whose whole premium fits the active per-trade cap.
// One new shadow position per day is enough to create an independent forward observation.
export function openNewShadowTrades({candidates=[],existingTrades=[],todayIso,nowIso,maxNewPerUtcDay=1,marketSession=null,maxPremiumDollars=20,allowedDteBuckets=['STANDARD','WEEKLY']}={}){
  if(marketSession&&(!marketSession.entryAllowed||marketSession.date!==todayIso))return [];
  const eligible=candidates
    .filter(x=>allowedDteBuckets.includes(x.dteBucket))
    .filter(x=>['LONG_CALL','LONG_PUT'].includes(x.kind||'LONG_CALL'))
    .filter(x=>Number(x.ask)>0&&Number(x.dte)>0)
    .filter(x=>Number(x.oneContractPremiumDollars||Number(x.ask)*100)<=Number(maxPremiumDollars))
    .sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  if(!eligible.length)return [];
  const trackedContracts=new Set(existingTrades.map(x=>x.contract));
  const openedToday=existingTrades.filter(x=>x.createdDate===todayIso).length;
  if(openedToday>=maxNewPerUtcDay)return [];
  const available=eligible.filter(x=>!trackedContracts.has(x.contract)).slice(0,1);
  return available.map(best=>{ const entry=round(Number(best.ask),4); const entryBid=round(Number(best.bid||0),4); const stop=round(entry*STOP_MULTIPLIER,4); const target=round(entry*TARGET_MULTIPLIER,4); const risk=entry-stop; return {
    id:buildShadowTradeId(best.contract,todayIso),
    createdDate:todayIso,
    createdAt:nowIso,
    underlying:best.underlying,
    underlyingType:best.underlyingType||'STOCK',
    kind:best.kind||null,
    underlyingBias:best.underlyingBias||null,
    contract:best.contract,
    expiry:best.expiry,
    dteAtCreation:best.dte,
    entry,
    entryBid,
    entrySpreadPct:entry>0?round((entry-entryBid)/entry*100,2):null,
    stop,
    protectedFloor:stop,
    target,
    targetR:round((target-entry)/risk,4),
    status:'OPEN',
    outcome:null,
    realizedR:null,
    resolvedAt:null,
    lastCheckedAt:nowIso,
    lastCheckedMid:null,
    lastCheckedBid:null,
    highWaterBid:entryBid,
    lowWaterBid:entryBid,
    exitPolicyVersion:2,
    deltaAtCreation:best.delta??null,
    ivAtCreation:best.iv??null,
    underlyingScore:best.underlyingScore??null,
    score:best.score??null,
    notes:null,
    modelOnly:true,
    shadowEvidenceVersion:3,
    evidenceEligible:true,
  }; });
}

// trade: one OPEN shadow trade record. liveSnapshot: {bid,ask} for the exact same contract
// symbol re-queried live, or null if the lookup found no data this run. nowIso/expiryIso
// drive the expiry check. Never fabricates a resolution from missing data -- if the contract
// has passed expiry and no snapshot could be found, marks UNKNOWN rather than guessing WIN/LOSS.
export function resolveOptionShadowTrade(trade,liveSnapshot,nowIso,marketSession=null){
  if(trade.status!=='OPEN')return trade;
  const now=new Date(nowIso),expiry=new Date(trade.expiry+'T21:00:00Z'),pastExpiry=now>=expiry;
  const risk=trade.entry-trade.stop;
  const createdDate=trade.createdDate||String(trade.createdAt||'').slice(0,10);
  // A next-day snapshot is not a valid substitute for the prior session's executable
  // 15:50-16:00 bid. Exclude the sample instead of manufacturing a late loss/win.
  if(marketSession?.date&&marketSession.date>createdDate){
    return {...trade,status:'UNKNOWN',outcome:null,realizedR:null,resolvedAt:nowIso,lastCheckedAt:nowIso,
      notes:'No executable same-session exit mark was captured. A later-day snapshot is not used as a substitute.',
      exitReason:'MISSED_SESSION_EXIT_NO_INTRADAY_MARK'};
  }
  if(liveSnapshot&&Number(liveSnapshot.bid)>0&&Number(liveSnapshot.ask)>0){
    const bid=round(Number(liveSnapshot.bid),4),ask=round(Number(liveSnapshot.ask),4),mid=round((bid+ask)/2,4);
    const highWaterBid=round(Math.max(Number(trade.highWaterBid||0),bid),4);
    const lowWaterBid=round(Math.min(Number(trade.lowWaterBid??bid),bid),4);
    const floor=protectedFloor(Number(trade.entry),highWaterBid,Number(trade.stop));
    const exitAt=(price,outcome,reason)=>{
      const r=clamp(round((price-trade.entry)/risk,4),-1,Number(trade.targetR));
      return {...trade,status:'RESOLVED',outcome,exitReason:reason,exitBid:price,realizedR:r,resolvedAt:nowIso,lastCheckedAt:nowIso,lastCheckedMid:mid,lastCheckedBid:bid,highWaterBid,lowWaterBid,protectedFloor:floor};
    };
    if(bid>=trade.target){
      return exitAt(bid,'WIN','TARGET');
    }
    if(bid<=floor){
      return exitAt(bid,bid>trade.entry?'WIN':'LOSS',floor>trade.stop?'PROFIT_FLOOR':'STOP');
    }
    const sameDayExit=marketSession?.forcedExitDue&&marketSession.date===createdDate;
    if(sameDayExit)return exitAt(bid,bid>trade.entry?'WIN':bid<trade.entry?'LOSS':'FLAT','SESSION_CUTOFF');
    if(pastExpiry){
      return exitAt(bid,bid>trade.entry?'WIN':bid<trade.entry?'LOSS':'FLAT','EXPIRY_RECONCILIATION');
    }
    return {...trade,lastCheckedAt:nowIso,lastCheckedMid:mid,lastCheckedBid:bid,highWaterBid,lowWaterBid,protectedFloor:floor};
  }
  if(pastExpiry){
    return {...trade,status:'UNKNOWN',outcome:null,realizedR:null,resolvedAt:nowIso,lastCheckedAt:nowIso,notes:'Contract had no live snapshot data at/after expiry; outcome cannot be determined from real prices, so no result is recorded rather than guessed.'};
  }
  return {...trade,lastCheckedAt:nowIso};
}

export function summarizeShadowTrades(trades){
  const resolved=(trades||[]).filter(x=>x.status==='RESOLVED'&&Number.isFinite(Number(x.realizedR))&&x.evidenceEligible===true&&Number(x.shadowEvidenceVersion)>=3);
  const independentMap=new Map();
  for(const x of resolved){
    const k=`${x.createdDate}|${x.underlying}`;
    const old=independentMap.get(k);
    if(!old||Number(x.realizedR)<Number(old.realizedR))independentMap.set(k,x);
  }
  const independent=[...independentMap.values()];
  const wins=independent.filter(x=>Number(x.realizedR)>0).length;
  const gains=independent.filter(x=>Number(x.realizedR)>0).reduce((s,x)=>s+Number(x.realizedR),0);
  const losses=Math.abs(independent.filter(x=>Number(x.realizedR)<0).reduce((s,x)=>s+Number(x.realizedR),0));
  const distinctDays=new Set(independent.map(x=>x.createdDate).filter(Boolean)).size;
  return {
    resolvedCount:resolved.length,
    independentSamples:independent.length,
    winRatePct:independent.length?round(wins/independent.length*100,1):null,
    averageR:independent.length?round(independent.reduce((s,x)=>s+Number(x.realizedR),0)/independent.length,2):null,
    profitFactor:losses>0?round(gains/losses,2):gains>0?999:null,
    distinctTradingDays:distinctDays,
    independenceKey:'createdDate+underlying',
    duplicateResolutionRule:'Keep the most adverse realized R for duplicate keys.',
  };
}
