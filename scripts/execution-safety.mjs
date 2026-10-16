// Pure decision layer. This module never sends a broker order.
export function assessExecution({capabilities,account,quotes=[],orders=[],positions=[],now=new Date().toISOString()}){
 const blockers=[];const actions=[];
 if(capabilities?.mode!=='LIVE_VERIFIED'||!capabilities?.liveOrderSubmission)blockers.push('LIVE_EXECUTION_NOT_VERIFIED');
 if(!capabilities?.liveEquityExitSubmission)blockers.push('EQUITY_EXIT_UNVERIFIED');
 if(!capabilities?.liveOptionExitSubmission||!capabilities?.liveOptionExitVerifiedThisSession)blockers.push('OPTION_EXIT_UNVERIFIED');
 if(!Number.isFinite(Date.parse(now)))blockers.push('INVALID_CLOCK');
 const buyingPower=Number(account?.buyingPower);
 if(!Number.isFinite(buyingPower)||buyingPower<0)blockers.push('BUYING_POWER_UNKNOWN');
 const openOrders=orders.filter(o=>['queued','confirmed','partially_filled','pending_cancelled'].includes(o.state));
 for(const p of positions){
  const q=quotes.find(q=>q.option_id===p.option_id||q.instrument_id===p.option_id);
  const pending=openOrders.some(o=>o.legs?.some(l=>l.option_id===p.option_id&&l.position_effect==='close'));
  if(pending){actions.push({kind:'RECONCILE_EXISTING_EXIT',symbol:p.chain_symbol,option_id:p.option_id});continue}
  if(p.expiration_date&&p.expiration_date<=now.slice(0,10))actions.push({kind:'URGENT_EXPIRATION_REVIEW',symbol:p.chain_symbol,option_id:p.option_id});
  if(!q||!Number.isFinite(Number(q.bid_price))||Number(q.bid_price)<=0)actions.push({kind:'NO_EXECUTABLE_BID',symbol:p.chain_symbol,option_id:p.option_id});
 }
 return {timestamp:now,allowNewOrders:blockers.length===0,blockers,actions,openOrderCount:openOrders.length};
}
