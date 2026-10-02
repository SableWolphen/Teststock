// Only complete, fresh read-only broker snapshots can retire tracked positions.
export function validateSnapshot(s,now=Date.now()){
  const age=now-Date.parse(s?.generatedAt);
  if(!Number.isFinite(age)||age< -60000||age>300000||s.complete!==true)throw new Error('Broker snapshot is incomplete or stale');
  for(const k of ['equities','options'])if(!Array.isArray(s[k]))throw new Error(`Missing broker ${k}`);
  for(const p of [...s.equities,...s.options])if(!Number.isFinite(Number(p.quantity))||Number(p.quantity)<0)throw new Error('Invalid broker quantity');
  for(const p of s.equities)if(!p.symbol)throw new Error('Missing equity symbol');
  for(const p of s.options)if(!p.option_id)throw new Error('Missing option id');
  return s;
}
export function reconcileWatchlist(watch,snapshot){
  validateSnapshot(snapshot);
  const s=structuredClone(snapshot),out=structuredClone(watch);
  const equities=new Set(s.equities.filter(p=>Number(p.quantity)>0).map(p=>p.symbol));
  const options=new Set(s.options.filter(p=>Number(p.quantity)>0).map(p=>p.option_id));
  out.positions=(out.positions||[]).map(p=>{
    if(p.status!=='ACTIVE')return p;
    const key=p.optionId||p.option_id||p.optionInstrumentId;
    const exists=p.assetClass==='STOCK'?equities.has(p.ticker):p.assetClass==='OPTION'&&key?options.has(key):null;
    if(exists===false)return{...p,status:'CLOSED',lastReconciledAt:s.generatedAt,closureSource:'ROBINHOOD_CONFIRMED_FLAT',note:(p.note||'')+' Broker reconciliation confirmed no remaining position; no exit fill or P&L inferred.'};
    return{...p,lastReconciledAt:s.generatedAt};
  });
  out.lastReconciledAt=s.generatedAt;return out;
}
export function brokerProfile(previous,snapshot){
  validateSnapshot(snapshot);
  return{...previous,generatedAt:snapshot.generatedAt,lastReconciledAt:snapshot.generatedAt,source:'ROBINHOOD_LIVE_RECONCILIATION',equities:snapshot.equities.filter(p=>Number(p.quantity)>0).map(p=>({symbol:p.symbol,quantity:Number(p.quantity),averageBuyPrice:p.average_buy_price??null,status:'ACTIVE'})),options:snapshot.options.filter(p=>Number(p.quantity)>0).map(p=>({underlying:p.chain_symbol,optionId:p.option_id,quantity:Number(p.quantity),status:'ACTIVE'}))};
}
