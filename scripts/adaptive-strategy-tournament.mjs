// Research-only adaptive strategy tournament. No broker writes or promises of returns.
const ok=x=>typeof x==='number'&&Number.isFinite(x);
export function detectRegime({trendStrength,realizedVolatility,liquidity}={}){
 if(![trendStrength,realizedVolatility,liquidity].every(ok))return 'UNKNOWN';
 if(liquidity<=0)return 'ILLIQUID';
 if(realizedVolatility>=0.05)return 'HIGH_VOLATILITY';
 if(Math.abs(trendStrength)>=0.6)return trendStrength>0?'UPTREND':'DOWNTREND';
 return 'RANGE';
}
export function evaluateStrategies(trades=[],{minOutOfSampleTrades=30,maxDrawdownFraction=0.15}={}){
 const names=[...new Set(trades.map(t=>t.strategy).filter(Boolean))];
 return names.map(strategy=>{
  const sample=trades.filter(t=>t.strategy===strategy&&t.partition==='OUT_OF_SAMPLE'&&t.brokerConfirmed===true&&t.confirmedClosed===true&&ok(t.realizedPnlUsd)).sort((a,b)=>Date.parse(a.closedAt||0)-Date.parse(b.closedAt||0));
  let equity=0,peak=0,drawdown=0;for(const t of sample){equity+=t.realizedPnlUsd;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity);}
  const pnl=sample.reduce((a,t)=>a+t.realizedPnlUsd,0);
  const capital=sample.length?sample.reduce((a,t)=>a+Math.max(0,t.capitalAtRiskUsd||0),0):0;
  const ddRatio=capital>0?drawdown/capital:Infinity;
  return {strategy,verifiedOutOfSampleTrades:sample.length,netRealizedPnlUsd:pnl,drawdownUsd:drawdown,drawdownFraction:Number.isFinite(ddRatio)?ddRatio:null,eligibleForReview:sample.length>=minOutOfSampleTrades&&pnl>0&&ddRatio<=maxDrawdownFraction,autoLivePromotion:false};
 }).sort((a,b)=>b.netRealizedPnlUsd-a.netRealizedPnlUsd);
}
export function chooseResearchAction({marketOpen=false,brokerHealthy=false,exitVerified=false,positions=[],opportunities=[],regime='UNKNOWN'}={}){
 if(positions.some(p=>p.requiresExit===true))return {action:'PRIORITIZE_EXITS',newRiskAllowed:false};
 if(!marketOpen)return {action:'RESEARCH_AND_RECONCILE',newRiskAllowed:false};
 if(!brokerHealthy||!exitVerified)return {action:'RECONCILE_AND_ALERT',newRiskAllowed:false};
 if(regime==='UNKNOWN'||regime==='ILLIQUID')return {action:'RESEARCH_ONLY',newRiskAllowed:false};
 const qualified=opportunities.filter(x=>x.eligible===true&&ok(x.netRankingScore)&&x.netRankingScore>0);
 return {action:qualified.length?'EVALUATE_TOP_CANDIDATE':'WAIT_FOR_EDGE',newRiskAllowed:false,candidate:qualified[0]?.ticker??null};
}
