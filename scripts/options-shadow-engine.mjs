// Pure resolution/creation logic for the options shadow ledger, kept separate from
// options-shadow-ledger.mjs's network/file I/O so it can be unit tested without live
// Alpaca calls -- same split as crypto-monitor-candidates.mjs / test-crypto-monitoring.mjs.
const round=(n,d=4)=>Number(Number(n||0).toFixed(d));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

// Fixed anchors rather than stock-style R geometry: a long option's "risk" is the whole
// premium, so target/stop are defined as multiples of the entry premium (ask), not a
// technical stop-loss level. +50% target, -40% stop -- a deliberately asymmetric,
// definedRiskOnly band consistent with probability-first-policy.json's options section.
export const TARGET_MULTIPLIER=1.5;
export const STOP_MULTIPLIER=0.6;

export function buildShadowTradeId(contract,createdDate){
  return `${createdDate}-${contract}`;
}

// candidates: this run's small-account-options.json candidates (STANDARD dteBucket only --
// 0DTE/WEEKLY stay diagnostic-only and never enter the shadow-to-live pathway).
// existingTrades: current docs/data/options-shadow-trades.json trades array.
// Returns new trade records to append (does not mutate existingTrades).
export function openNewShadowTrades({candidates=[],existingTrades=[],todayIso,nowIso,maxNewPerUtcDay=1}={}){
  const standard=candidates.filter(x=>x.dteBucket==='STANDARD'&&Number(x.ask)>0&&Number(x.dte)>0);
  if(!standard.length)return [];
  const trackedContracts=new Set(existingTrades.map(x=>x.contract));
  const openedToday=existingTrades.filter(x=>x.createdDate===todayIso).length;
  if(openedToday>=maxNewPerUtcDay)return [];
  const best=standard.find(x=>!trackedContracts.has(x.contract));
  if(!best)return [];
  const entry=round(Number(best.ask),4);
  const stop=round(entry*STOP_MULTIPLIER,4);
  const target=round(entry*TARGET_MULTIPLIER,4);
  const risk=entry-stop;
  return [{
    id:buildShadowTradeId(best.contract,todayIso),
    createdDate:todayIso,
    createdAt:nowIso,
    underlying:best.underlying,
    underlyingType:best.underlyingType||'STOCK',
    contract:best.contract,
    expiry:best.expiry,
    dteAtCreation:best.dte,
    entry,
    stop,
    target,
    targetR:round((target-entry)/risk,4),
    status:'OPEN',
    outcome:null,
    realizedR:null,
    resolvedAt:null,
    lastCheckedAt:nowIso,
    lastCheckedMid:null,
    underlyingScore:best.underlyingScore??null,
    score:best.score??null,
    notes:null,
    modelOnly:true,
  }];
}

// trade: one OPEN shadow trade record. liveSnapshot: {bid,ask} for the exact same contract
// symbol re-queried live, or null if the lookup found no data this run. nowIso/expiryIso
// drive the expiry check. Never fabricates a resolution from missing data -- if the contract
// has passed expiry and no snapshot could be found, marks UNKNOWN rather than guessing WIN/LOSS.
export function resolveOptionShadowTrade(trade,liveSnapshot,nowIso){
  if(trade.status!=='OPEN')return trade;
  const now=new Date(nowIso),expiry=new Date(trade.expiry+'T21:00:00Z'),pastExpiry=now>=expiry;
  const risk=trade.entry-trade.stop;
  if(liveSnapshot&&Number(liveSnapshot.bid)>0&&Number(liveSnapshot.ask)>0){
    const mid=round((Number(liveSnapshot.bid)+Number(liveSnapshot.ask))/2,4);
    if(mid>=trade.target){
      return {...trade,status:'RESOLVED',outcome:'WIN',realizedR:trade.targetR,resolvedAt:nowIso,lastCheckedAt:nowIso,lastCheckedMid:mid};
    }
    if(mid<=trade.stop){
      return {...trade,status:'RESOLVED',outcome:'LOSS',realizedR:-1,resolvedAt:nowIso,lastCheckedAt:nowIso,lastCheckedMid:mid};
    }
    if(pastExpiry){
      const r=clamp(round((mid-trade.entry)/risk,4),-1,trade.targetR);
      const outcome=r>0.02?'WIN':r<-0.02?'LOSS':'FLAT';
      return {...trade,status:'RESOLVED',outcome,realizedR:r,resolvedAt:nowIso,lastCheckedAt:nowIso,lastCheckedMid:mid};
    }
    return {...trade,lastCheckedAt:nowIso,lastCheckedMid:mid};
  }
  if(pastExpiry){
    return {...trade,status:'UNKNOWN',outcome:null,realizedR:null,resolvedAt:nowIso,lastCheckedAt:nowIso,notes:'Contract had no live snapshot data at/after expiry; outcome cannot be determined from real prices, so no result is recorded rather than guessed.'};
  }
  return {...trade,lastCheckedAt:nowIso};
}

export function summarizeShadowTrades(trades){
  const resolved=(trades||[]).filter(x=>x.status==='RESOLVED'&&Number.isFinite(Number(x.realizedR)));
  const independentMap=new Map();
  for(const x of resolved){
    const k=`${x.createdDate}|${x.underlying}`;
    const old=independentMap.get(k);
    if(!old||Number(x.realizedR)<Number(old.realizedR))independentMap.set(k,x);
  }
  const independent=[...independentMap.values()];
  const wins=independent.filter(x=>Number(x.realizedR)>0).length;
  return {
    resolvedCount:resolved.length,
    independentSamples:independent.length,
    winRatePct:independent.length?round(wins/independent.length*100,1):null,
    averageR:independent.length?round(independent.reduce((s,x)=>s+Number(x.realizedR),0)/independent.length,2):null,
    independenceKey:'createdDate+underlying',
    duplicateResolutionRule:'Keep the most adverse realized R for duplicate keys.',
  };
}
