// Missing measurements are unknown, never zero-return observations.
export const measuredNumber = value =>
  (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
  Number.isFinite(Number(value));

export const confirmedStockOutcome = trade =>
  String(trade.assetClass || 'STOCK').toUpperCase() === 'STOCK' &&
  trade.reconciledFromRobinhood === true &&
  ['WIN', 'LOSS', 'FLAT'].includes(String(trade.outcome || '').toUpperCase()) &&
  measuredNumber(trade.realizedR);

// Rejected setups are opportunity-cost diagnostics, not proof of the entry policy.
export const acceptedShadowOutcome = trade =>
  trade.status === 'RESOLVED' && trade.decision === 'ACCEPTED' &&
  measuredNumber(trade.realizedR);

export const validEvidenceDate = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0,10) === value;

// Invalid dates/symbols cannot manufacture independent samples or trading days.
export function independentOutcomes(rows, symbolKey='symbol', includeSetup=true) {
  const episodes=new Map();
  for(const row of rows) {
    if(!validEvidenceDate(row.createdDate)||typeof row[symbolKey]!=='string'||!row[symbolKey].trim()||!measuredNumber(row.realizedR)) continue;
    const parts=includeSetup?[row.createdDate,row[symbolKey],row.setupType||'UNKNOWN',row.runtimeRegime||'UNKNOWN']:[row.createdDate,row[symbolKey]];
    const key=parts.map(x=>String(x).trim().toUpperCase()).join('|');
    const old=episodes.get(key);
    if(!old||Number(row.realizedR)<Number(old.realizedR)) episodes.set(key,row);
  }
  return [...episodes.values()];
}

// Admission reads confirmed journal rows, never cached or hand-written summary totals.
export function realOutcomeStats(trades, predicate=confirmedStockOutcome) {
  const rows=independentOutcomes((trades||[]).filter(predicate).map(t=>({...t,createdDate:String(t.entryFilledAt||'').slice(0,10),symbol:t.symbol||t.underlying||t.indexSymbol})))
    .sort((a,b)=>String(a.finalExitAt||'').localeCompare(String(b.finalExitAt||'')));
  const average=xs=>xs.length?xs.reduce((sum,t)=>sum+Number(t.realizedR),0)/xs.length:null;
  return {samples:rows.length,winRatePct:rows.length?rows.filter(t=>Number(t.realizedR)>0).length/rows.length*100:null,
    averageRealizedR:average(rows),recentSamples:Math.min(6,rows.length),recentAverageRealizedR:average(rows.slice(-6))};
}

export const confirmedAssetOutcome = (trade, assetClasses, crypto=false) =>
  assetClasses.includes(String(trade.assetClass||'').toUpperCase()) &&
  (crypto?trade.reconciledFromRobinhoodCryptoApi:trade.reconciledFromRobinhood)===true &&
  ['WIN','LOSS','FLAT'].includes(String(trade.outcome||'').toUpperCase()) && measuredNumber(trade.realizedR);
