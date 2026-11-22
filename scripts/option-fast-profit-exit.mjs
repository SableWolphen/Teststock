// Pure option exit planner. This does not submit, replace, or cancel broker orders.
// Broker-confirmed filled quantity and executable BID are mandatory.
// Any recommendation is subordinate to the canonical deployment lock and broker verification.
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function planOptionProfitExit({
  entryAsk, bid, ask, highestConfirmedBid, quantity, quoteAgeMs,
  profitTargetPct=10, breakEvenArmPct=15, lockArmPct=25, lockProfitPct=10,
  trailArmPct=35, trailDistancePct=15, knownExitFeesUsd=0,
  openExitOrder=false, brokerPositionConfirmed=false, sessionOpen=false,
  sessionExitDeadline=false, thesisInvalidated=false
}={}){
  const blockers=[];
  for(const [name,val] of Object.entries({entryAsk,bid,ask,quantity,quoteAgeMs,knownExitFeesUsd})){
    if(finite(val)===null)blockers.push('INVALID_'+name.toUpperCase());
  }
  if(!brokerPositionConfirmed)blockers.push('POSITION_NOT_BROKER_CONFIRMED');
  if(!sessionOpen)blockers.push('SESSION_NOT_OPEN');
  if(openExitOrder)blockers.push('EXISTING_EXIT_RECONCILIATION_REQUIRED');
  if(blockers.length)return {action:'RECONCILE_OR_WAIT',blockers,maySubmitOrder:false};
  if(entryAsk<=0||bid<=0||ask<bid||quantity<=0||!Number.isInteger(quantity)||quoteAgeMs<0||quoteAgeMs>5000||knownExitFeesUsd<0){
    return {action:'RECONCILE_OR_WAIT',blockers:['INVALID_OR_STALE_EXECUTABLE_QUOTE_OR_POSITION'],maySubmitOrder:false};
  }
  const thresholds=[profitTargetPct,breakEvenArmPct,lockArmPct,lockProfitPct,trailArmPct,trailDistancePct];
  if(thresholds.some(x=>finite(x)===null||x<0)||trailDistancePct>=100)
    return {action:'RECONCILE_OR_WAIT',blockers:['INVALID_PROTECTION_POLICY'],maySubmitOrder:false};
  const observedHigh=finite(highestConfirmedBid);
  if(observedHigh!==null&&observedHigh<bid)
    return {action:'RECONCILE_OR_WAIT',blockers:['INCONSISTENT_BID_HIGH_WATER'],maySubmitOrder:false};
  const high=Math.max(observedHigh??bid,bid);
  const profitUsd=(bid-entryAsk)*100*quantity-knownExitFeesUsd;
  const profitPct=100*(bid-entryAsk)/entryAsk;
  const highPct=100*(high-entryAsk)/entryAsk;
  // Floor is derived from executable BID highs, never midpoint, model value or mark.
  let floor=null;
  if(highPct>=breakEvenArmPct)floor=entryAsk+knownExitFeesUsd/(100*quantity);
  if(highPct>=lockArmPct)floor=Math.max(floor??0,entryAsk*(1+lockProfitPct/100)+knownExitFeesUsd/(100*quantity));
  if(highPct>=trailArmPct)floor=Math.max(floor??0,high*(1-trailDistancePct/100));
  let reason=null;
  if(sessionExitDeadline)reason='SESSION_EXIT_DEADLINE';
  else if(thesisInvalidated)reason='THESIS_INVALIDATED';
  else if(floor!==null&&bid<=floor)reason='PROFIT_PROTECTION_RETRACEMENT';
  else if(profitPct>=profitTargetPct&&profitUsd>0)reason='PROFIT_TARGET_AT_EXECUTABLE_BID';
  return {action:reason?'EXIT_REVIEW_NOW':'HOLD_AND_MONITOR',reason,maySubmitOrder:false,
    requiresBrokerReconciliation:true,highestConfirmedBid:high,protectionFloorBid:floor,
    executableBid:bid,estimatedNetPnlUsd:Number(profitUsd.toFixed(2)),
    grossReturnPct:Number(profitPct.toFixed(2)),
    note:'Decision packet only. Broker order type, liquidity, exits and fill are not guaranteed.'};
}
