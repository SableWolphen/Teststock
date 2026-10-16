// Deterministic, research-only options selection. Broker writes require separate authorization.
const finite=n=>Number.isFinite(Number(n));
export function screenOptions(rows=[],{cash=0,maxPremium=50,minDte=7,maxDte=30,maxSpreadFraction=.15,minVolume=100,minOpenInterest=100,now=new Date().toISOString()}={}){
 const time=Date.parse(now);
 return rows.map(row=>{
  const bid=Number(row.bid),ask=Number(row.ask),strike=Number(row.strike),stock=Number(row.underlyingPrice);
  const expiry=Date.parse(row.expiry+'T20:00:00Z');
  const dte=(expiry-time)/86400000,spread=ask>0?(ask-bid)/ask:Infinity,premium=ask*100;
  const reasons=[];
  if(!row.symbol||!row.optionId||!['call','put'].includes(row.type))reasons.push('MISSING_CONTRACT_IDENTITY');
  if(![bid,ask,strike,stock].every(finite)||ask<=0||bid<=0||bid>ask||stock<=0)reasons.push('UNRELIABLE_QUOTE');
  if(!Number.isFinite(expiry)||dte<minDte||dte>maxDte)reasons.push('EXPIRATION_OUTSIDE_POLICY');
  if(!finite(row.volume)||Number(row.volume)<minVolume||!finite(row.openInterest)||Number(row.openInterest)<minOpenInterest)reasons.push('LOW_LIQUIDITY');
  if(spread>maxSpreadFraction)reasons.push('WIDE_SPREAD');
  if(!finite(cash)||premium>Math.min(Number(cash),Number(maxPremium)))reasons.push('INSUFFICIENT_CASH');
  const age=(time-Date.parse(row.quoteTime))/60000;
  if(!Number.isFinite(age)||age<0||age>5)reasons.push('STALE_QUOTE');
  const breakeven=row.type==='call'?strike+ask:strike-ask;
  const breakevenMovePct=stock>0?Math.abs(breakeven-stock)/stock*100:Infinity;
  const score=reasons.length?null:Math.round(Math.max(0,100-spread*100-breakevenMovePct*3-Math.max(0,15-Number(row.volume)/1000)));
  return {...row,premium,spreadFraction:spread,dte:Math.round(dte*10)/10,breakeven,breakevenMovePct,score,eligible:reasons.length===0,reasons};
 }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(b.score??-1)-(a.score??-1));
}
export function exitPriority(positions=[],now=new Date().toISOString()){
 const t=Date.parse(now);
 return positions.map(p=>{const days=(Date.parse(p.expiry+'T20:00:00Z')-t)/86400000;const reasons=[];
 if(p.pendingSell)reasons.push('RECONCILE_PENDING_SELL');
 if(p.expiry&&days<=1)reasons.push('EXPIRATION_IMMINENT');
 if(p.exitRequired)reasons.push('EXIT_REQUIRED');
 return {...p,priority:reasons.length?'REVIEW_NOW':'MONITOR',reasons};
 }).sort((a,b)=>Number(b.priority==='REVIEW_NOW')-Number(a.priority==='REVIEW_NOW'));
}
export function orderReadiness({brokerConfirmed=false,quoteFresh=false,exitVerified=false,duplicateOrder=false,availableCash=0,cost=Infinity}={}){
 const blocks=[];
 if(!brokerConfirmed)blocks.push('BROKER_NOT_CONFIRMED');
 if(!quoteFresh)blocks.push('STALE_QUOTE');
 if(!exitVerified)blocks.push('EXIT_UNVERIFIED');
 if(duplicateOrder)blocks.push('DUPLICATE_ORDER');
 if(!finite(availableCash)||!finite(cost)||cost<=0||cost>availableCash)blocks.push('CASH_LIMIT');
 return {readyForBrokerReview:blocks.length===0,automaticSubmissionAuthorized:false,blocks};
}
