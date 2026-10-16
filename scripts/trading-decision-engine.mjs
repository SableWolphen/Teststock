// Pure opportunity selection: no broker writes and no assumptions about future returns.
const finite=n=>Number.isFinite(Number(n))?Number(n):null;
export function rankOpportunities(candidates=[],{cash=0,maxAllocationPct=100,minimumNetEdge=0}={}){
 const available=Math.max(0,finite(cash)??0);
 return candidates.map(c=>{
  const ask=finite(c.ask),bid=finite(c.bid),price=finite(c.price),fee=Math.max(0,finite(c.estimatedFees)??0);
  const option=c.assetClass==='OPTION';
  const spread=option&&ask!==null&&bid!==null&&ask>0?(ask-bid)/ask:0;
  const cost=option?(ask===null?Infinity:ask*100+fee):(finite(c.estimatedCost)??Infinity);
  const expectancy=finite(c.costAdjustedConservativeExpectedR);
  const reasons=[];
  if(!c.fresh)reasons.push('STALE_SIGNAL');
  if(c.eligible!==true)reasons.push('ADMISSION_BLOCKED');
  if(expectancy===null||expectancy<=minimumNetEdge)reasons.push('INSUFFICIENT_NET_EDGE');
  if(option&&(bid===null||bid<=0||ask===null||ask<=0||bid>ask||spread>.15))reasons.push('OPTION_LIQUIDITY');
  if(!Number.isFinite(cost)||cost<=0||cost>available||cost>available*maxAllocationPct/100)reasons.push('UNAFFORDABLE');
  if(c.openOrder===true)reasons.push('DUPLICATE_ORDER');
  const score=reasons.length?null:expectancy-(option?spread:0);
  return {...c,estimatedTotalCost:Number.isFinite(cost)?cost:null,netRankingScore:score,blockedReasons:reasons};
 }).sort((a,b)=>(b.netRankingScore??-Infinity)-(a.netRankingScore??-Infinity));
}
export function tradingCircuitBreaker({equity,dayStartEquity,peakEquity,maxDailyLossPct=5,maxDrawdownPct=20}={}){
 const e=finite(equity),d=finite(dayStartEquity),p=finite(peakEquity);
 if(e===null||d===null||p===null||e<0||d<=0||p<=0)return {allowNewEntries:false,reason:'MISSING_EQUITY'};
 const dayLossPct=100*(d-e)/d,drawdownPct=100*(p-e)/p;
 return {allowNewEntries:dayLossPct<maxDailyLossPct&&drawdownPct<maxDrawdownPct,dayLossPct,drawdownPct,reason:dayLossPct>=maxDailyLossPct?'DAILY_LOSS_LIMIT':drawdownPct>=maxDrawdownPct?'DRAWDOWN_LIMIT':'OK'};
}
export function realizedPerformance(trades=[]){
 const closed=trades.filter(t=>t.brokerConfirmed===true&&Number.isFinite(Number(t.realizedPnlUsd)));
 const pnl=closed.reduce((s,t)=>s+Number(t.realizedPnlUsd),0);
 return {confirmedClosedTrades:closed.length,realizedPnlUsd:pnl,winRatePct:closed.length?100*closed.filter(t=>Number(t.realizedPnlUsd)>0).length/closed.length:null,canClaimProvenEdge:false};
}
