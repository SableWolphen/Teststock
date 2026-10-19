import {protectionDrill} from './protection-shadow-drill.mjs';

const terminal=new Set(['filled','cancelled','canceled','rejected','failed','voided','partially_filled_rest_cancelled','locate_failed']);
const working=new Set(['new','queued','confirmed','unconfirmed','partially_filled','pending_cancelled','locating']);
const number=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))?Number(v):null;
const fresh=(stamp,now,limit=30000)=>{const age=now-Date.parse(stamp);return Number.isFinite(age)&&age>=-2000&&age<=limit;};
const sessionDate=stamp=>Number.isFinite(Date.parse(stamp))?new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp)):null;

// Observations only: no transport, broker writes, prices to trade at or permission to trade.
export function assessProtectionSnapshot({snapshot,status,now=Date.now()}={}) {
  const blockers=[];
  const snapshotFresh=fresh(snapshot?.generatedAt,now);
  const currentReadVerified=snapshotFresh&&fresh(status?.at,now)&&status?.brokerConnected===true
    &&status?.reconciliation?.positionsReadComplete===true&&status?.reconciliation?.orderHistoryReadComplete===true
    &&status?.reconciliation?.at===snapshot?.generatedAt;
  if(!snapshotFresh)blockers.push('BROKER_SNAPSHOT_STALE_OR_MISSING');
  if(!currentReadVerified)blockers.push('CURRENT_BROKER_RECONCILIATION_UNVERIFIED');
  const schemaVerified=snapshot?.positionsReadComplete===true&&snapshot?.orderHistoryReadComplete===true
    &&['equities','options','orders'].every(k=>Array.isArray(snapshot?.[k]));
  if(!schemaVerified)blockers.push('BROKER_COVERAGE_SCHEMA_INVALID');
  const session={date:sessionDate(new Date(now).toISOString()),regularHours:status?.entryData?.connected===true
    &&fresh(status.entryData.verifiedAt,now)&&status.entryData.marketOpen===true};
  if(!session.regularHours)blockers.push('REGULAR_SESSION_UNVERIFIED_OR_CLOSED');
  // This reader cannot inspect advanced-order relationships. No empty standard list clears this gate.
  blockers.push('ADVANCED_ORDER_COVERAGE_UNVERIFIED','LIVE_ENTRY_PROTECTION_EXIT_CYCLE_UNVERIFIED','ALERT_RECEIPT_UNVERIFIED');
  const assessments=[];
  if(currentReadVerified&&schemaVerified) {
    for(const asset of ['EQUITY','OPTION']) for(const p of asset==='EQUITY'?snapshot.equities:snapshot.options) {
      const held=number(p?.quantity),key=asset==='EQUITY'?p?.symbol:p?.option_id;
      if(held===0)continue;
      const symbol=asset==='EQUITY'?p?.symbol:p?.chain_symbol;
      const issues=[];
      if(!key||!symbol||held===null||held<0||p.type==='short'||(asset==='OPTION'&&(p.type!=='long'||!Number.isInteger(held))))issues.push('HOLDING_IDENTITY_OR_QUANTITY_UNSUPPORTED');
      if(asset==='OPTION') {
        const pending=['pending_assignment_quantity','pending_exercise_quantity','pending_expiration_quantity','pending_buy_quantity','pending_sell_quantity'];
        if(pending.some(k=>number(p[k])===null))issues.push('OPTION_PENDING_STATE_UNKNOWN');
        if(pending.filter(k=>k!=='pending_sell_quantity').some(k=>number(p[k])>0))issues.push('OPTION_PENDING_BROKER_PROCESSING');
        if(!/^\d{4}-\d{2}-\d{2}$/.test(p.expiration_date||''))issues.push('OPTION_EXPIRATION_UNKNOWN');
        else if(p.expiration_date<=session.date)issues.push('OPTION_EXPIRATION_REVIEW_REQUIRED');
      }
      const related=snapshot.orders.filter(o=>o.asset===asset&&!terminal.has(o.state)&&(asset==='EQUITY'?o.symbol===key:o.legs?.some(l=>l.option_id===key)));
      if(related.some(o=>!working.has(o.state)))issues.push('UNKNOWN_WORKING_ORDER_STATE');
      const sells=related.filter(o=>asset==='EQUITY'?o.side==='sell':o.legs?.some(l=>l.option_id===key&&l.side==='sell'));
      // Multiple independent sells can oversell holdings. Never select just the first matching stop.
      if(sells.length>1)issues.push('CONFLICTING_SELL_ORDERS_REQUIRE_REVIEW');
      if(related.some(o=>asset==='EQUITY'?o.side!=='sell':o.legs?.some(l=>l.option_id===key&&l.side!=='sell')))issues.push('WORKING_ENTRY_REQUIRES_RECONCILIATION');
      if(asset==='OPTION'&&number(p.pending_sell_quantity)>0) {
        const reported=sells.reduce((sum,o)=>sum+(number(o.quantity)-number(o.confirmedFilledQuantity))*Number(o.legs?.find(l=>l.option_id===key)?.ratio_quantity),0);
        if(!Number.isFinite(reported)||reported!==number(p.pending_sell_quantity))issues.push('OPTION_PENDING_SELL_MISMATCH');
      }
      const stop=sells.length===1&&sells[0].trigger==='stop'?sells[0]:null;
      if(stop&&asset==='OPTION'&&(stop.legs.length!==1||stop.legs[0].position_effect!=='close'||Number(stop.legs[0].ratio_quantity)!==1))issues.push('UNSUPPORTED_OPTION_PROTECTION_LEGS');
      if(stop&&asset==='OPTION'&&stop.type==='market'&&stop.time_in_force!=='gfd')issues.push('UNSUPPORTED_OPTION_STOP_VALIDITY');
      const protectiveOrder=stop?{id:stop.id,symbol:key,side:'sell',type:stop.type==='market'?'stop_market':stop.type==='limit'?'stop_limit':'unsupported',quantity:stop.quantity,filledQuantity:stop.confirmedFilledQuantity,
        stopPrice:stop.stop_price,limitPrice:stop.price,state:stop.state,marketHours:stop.market_hours,timeInForce:stop.time_in_force,sessionDate:sessionDate(stop.created_at),observedAt:snapshot.generatedAt}:null;
      const assessment=protectionDrill({position:{symbol:key,quantity:held,observedAt:snapshot.generatedAt},protectiveOrder,exitOrder:sells.find(o=>o.trigger!=='stop'),session,now});
      if(!assessment.protectionOrderVerified)issues.push('BROKER_RESIDENT_PROTECTION_NOT_VERIFIED');
      const matchedStopObserved=issues.length===0&&assessment.protectionOrderVerified;
      assessments.push({asset,symbol,contract:asset==='OPTION'?key:undefined,quantity:held,expiration:asset==='OPTION'?p.expiration_date:undefined,matchedStopObserved,action:issues.length?'BROKER_REVIEW_REQUIRED':assessment.action,issues,assessment});
    }
  }
  if(assessments.some(a=>!a.matchedStopObserved))blockers.push('HOLDING_PROTECTION_UNVERIFIED');
  if(assessments.some(a=>a.issues.includes('OPTION_EXPIRATION_REVIEW_REQUIRED')))blockers.push('OPTION_EXPIRATION_REVIEW_REQUIRED');
  if(snapshot?.cryptoPositions?.some(p=>p.currency?.type!=='fiat'&&number(p.quantity)!==0))blockers.push('CRYPTO_PROTECTION_UNVERIFIED');
  for(const code of snapshot?.blockers||[]) if(['EXECUTION_TOTAL_MISMATCH','FILLED_QUANTITY_WITHOUT_EXECUTIONS','MULTIPLE_WORKING_ORDERS_REQUIRE_REVIEW','UNKNOWN_ORDER_STATE','CRYPTO_RECONCILIATION_UNVERIFIED','CRYPTO_WORKING_ORDERS_REQUIRE_REVIEW'].includes(code))blockers.push(code);
  return {schemaVersion:1,generatedAt:new Date(now).toISOString(),evidenceType:'READ_ONLY_BROKER_OBSERVATIONS',brokerWrites:false,liveCycleVerified:false,allowRealMoneyOrders:false,
    snapshotFresh,currentReadVerified,regularSessionVerified:session.regularHours,holdingCount:schemaVerified?[...snapshot.equities,...snapshot.options].filter(p=>number(p?.quantity)!==0).length:null,assessedHoldingCount:assessments.length,matchedStopCount:currentReadVerified&&schemaVerified?assessments.filter(a=>a.matchedStopObserved).length:null,
    assessments,blockers:[...new Set(blockers)],note:'A reported stop is not a fill or price guarantee. Historical fills do not verify unattended execution. Advanced-order coverage, a controlled broker execution cycle and operational alert receipt remain separate acceptance gates.'};
}
