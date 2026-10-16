// Pure resolution/creation logic for the options shadow ledger, kept separate from
// options-shadow-ledger.mjs's network/file I/O so it can be unit tested without live
// Alpaca calls -- same split as crypto-monitor-candidates.mjs / test-crypto-monitoring.mjs.
const round=(n,d=4)=>Number(Number(n||0).toFixed(d));
export function validOptionQuote(quote,nowIso,{requireOpra=false}={}) {
  const bid=Number(quote?.bid),ask=Number(quote?.ask),age=Date.parse(nowIso)-Date.parse(quote?.quoteAt);
  return Number.isFinite(bid)&&bid>0&&Number.isFinite(ask)&&ask>=bid&&Number.isFinite(age)&&age>=-2000&&age<=30000&&(!requireOpra||quote.feed==='opra');
}
export function eligibleOptionEvidence(trade) {
  return trade.status==='RESOLVED'&&trade.evidenceEligible===true&&Number(trade.shadowEvidenceVersion)>=4&&typeof trade.realizedR==='number'&&Number.isFinite(trade.realizedR)&&trade.entryQuote?.contract===trade.contract&&trade.exitQuote?.contract===trade.contract&&validOptionQuote(trade.entryQuote,trade.createdAt,{requireOpra:true})&&validOptionQuote(trade.exitQuote,trade.resolvedAt,{requireOpra:true});
}

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
// Track a small diversified batch each day so the evidence set grows faster without
// recreating the old correlated basket/worst-case bias. At most one contract per
// underlying is opened in a given day.
export function openNewShadowTrades({candidates=[],existingTrades=[],todayIso,nowIso,maxNewPerUtcDay=5,marketSession=null,maxPremiumDollars=20,allowedDteBuckets=['STANDARD','WEEKLY']}={}){
  if(marketSession&&(!marketSession.entryAllowed||marketSession.date!==todayIso))return [];
  const eligible=candidates
    .filter(x=>allowedDteBuckets.includes(x.dteBucket))
    .filter(x=>['LONG_CALL','LONG_PUT'].includes(x.kind||'LONG_CALL'))
    .filter(x=>Number(x.ask)>0&&Number(x.dte)>0)
    .filter(x=>Number(x.oneContractPremiumDollars||Number(x.ask)*100)<=Number(maxPremiumDollars))
    .sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  if(!eligible.length)return [];
  const trackedContracts=new Set(existingTrades.map(x=>x.contract));
  const openedToday=existingTrades.filter(x=>x.createdDate===todayIso);
  if(openedToday.length>=maxNewPerUtcDay)return [];
  const todayUnderlyings=new Set(openedToday.map(x=>x.underlying));
  const remaining=Math.max(0,maxNewPerUtcDay-openedToday.length);
  const available=[];
  for(const candidate of eligible){
    if(available.length>=remaining)break;
    if(trackedContracts.has(candidate.contract))continue;
    if(todayUnderlyings.has(candidate.underlying))continue;
    if(available.some(x=>x.underlying===candidate.underlying))continue;
    available.push(candidate);
  }
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
    shadowEvidenceVersion:4,
    entryQuote:{contract:best.contract,bid:best.bid,ask:best.ask,quoteAt:best.quoteAt??null,feed:best.quoteFeed??null},
    evidenceEligible:validOptionQuote({...best,feed:best.quoteFeed},nowIso,{requireOpra:true}),
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
  if(liveSnapshot&&Number.isFinite(Number(liveSnapshot.bid))&&Number(liveSnapshot.bid)>0&&Number.isFinite(Number(liveSnapshot.ask))&&Number(liveSnapshot.ask)>=Number(liveSnapshot.bid)){
    const bid=round(Number(liveSnapshot.bid),4),ask=round(Number(liveSnapshot.ask),4),mid=round((bid+ask)/2,4);
    const highWaterBid=round(Math.max(Number(trade.highWaterBid||0),bid),4);
    const lowWaterBid=round(Math.min(Number(trade.lowWaterBid??bid),bid),4);
    const floor=protectedFloor(Number(trade.entry),highWaterBid,Number(trade.stop));
    const exitAt=(price,outcome,reason)=>{
      // A stop is a trigger, not a guaranteed fill. Preserve adverse gaps below it.
      const r=round((price-trade.entry)/risk,4);
      const exitQuote={...liveSnapshot,contract:trade.contract};
      return {...trade,status:'RESOLVED',outcome,exitReason:reason,exitBid:price,realizedR:r,resolvedAt:nowIso,lastCheckedAt:nowIso,lastCheckedMid:mid,lastCheckedBid:bid,highWaterBid,lowWaterBid,protectedFloor:floor,exitQuote,evidenceEligible:trade.evidenceEligible===true&&validOptionQuote(exitQuote,nowIso,{requireOpra:true})};
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
  const resolved=(trades||[]).filter(eligibleOptionEvidence);
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
