import {SAFETY_POLICY} from './safety-policy.mjs';
const pending=new Set(['new','queued','confirmed','unconfirmed','partially_filled','pending_cancelled']);
const numeric=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
// Shadow decisions only. This module has no broker transport or order submission function.
export function protectionDrill({position,entry,protectiveOrder,exitOrder,session={},now=Date.now()}={}) {
 const out={shadowOnly:true,brokerWrites:false,liveEnabled:SAFETY_POLICY.liveExecutionEnabled,allowNewEntries:false,protectionOrderVerified:false,notes:[]};
 const finish=(action,reason,extra={})=>({...out,action,reason,...extra});
 if(!position?.symbol||!Number.isFinite(Date.parse(position.observedAt))||now-Date.parse(position.observedAt)>30000||Date.parse(position.observedAt)>now+2000) return finish('RECONCILE_POSITION','Position identity or freshness is unverified.');
 const held=numeric(position.quantity);
 if(held===null||held<0) return finish('RECONCILE_POSITION','Quantity is unknown or outside long-only scope.');
 if(entry?.submission==='AMBIGUOUS') return finish('RECONCILE_ORIGINAL_CLIENT_ID','Never submit a replacement entry while the original outcome is ambiguous.',{clientOrderId:entry.clientOrderId||null});
 if(exitOrder&&pending.has(exitOrder.state)) return finish('RECONCILE_EXISTING_EXIT','An exit is still working or pending cancellation; do not create a duplicate exit.');
 if(held===0) {
  if(entry&&pending.has(entry.state)) return finish('RECONCILE_WORKING_ENTRY','A working entry may still create a position.');
  if(protectiveOrder&&pending.has(protectiveOrder.state)) return finish('REVIEW_ORPHAN_PROTECTION','Flat holdings with a working sell order require broker reconciliation; never assume cancellation.');
  return finish('FLAT_VERIFIED','Fresh broker position is flat. No exit fill or P&L is inferred.');
 }
 if(!Number.isInteger(held)) return finish('ESCALATE_UNSUPPORTED_PROTECTION','Fractional shares have no verified broker-resident stop flow in this runtime.');
 if(!session.regularHours) return finish('ESCALATE_INACTIVE_SESSION','Regular-hours stop protection cannot be treated as active outside the regular session.');
 if(!protectiveOrder) return finish('PROTECTION_REVIEW_REQUIRED','No broker-confirmed protection exists. A shadow plan is not a protective order.',{confirmedQuantityToProtect:held});
 if(protectiveOrder.symbol!==position.symbol||protectiveOrder.side!=='sell'||!['stop_market','stop_limit'].includes(protectiveOrder.type)||!protectiveOrder.id) return finish('RECONCILE_PROTECTION','Protection identity, side or order type does not match.');
 if(protectiveOrder.submission==='AMBIGUOUS'||protectiveOrder.state==='pending_cancelled') return finish('RECONCILE_ORIGINAL_PROTECTION','Preserve the original protection client ID; do not blindly cancel or submit another order.');
 const stop=numeric(protectiveOrder.stopPrice),quantity=numeric(protectiveOrder.quantity),filled=numeric(protectiveOrder.filledQuantity);
 if(stop===null||stop<=0||quantity===null||filled===null||filled<0||quantity-filled!==held) return finish('REPAIR_PROTECTION_REVIEW','Stop or remaining quantity does not match the confirmed holding. Preserve existing protection while reviewing repair.',{confirmedQuantityToProtect:held});
 if(protectiveOrder.marketHours!=='regular_hours') return finish('RECONCILE_PROTECTION','A supported regular-session stop is required.');
 if(protectiveOrder.state!=='confirmed') return finish('ESCALATE_UNCONFIRMED_PROTECTION','Queued, rejected, partially filled or terminal protection is not evidence of full active coverage.');
 if(!['gtc','gfd'].includes(protectiveOrder.timeInForce)||(protectiveOrder.timeInForce==='gfd'&&protectiveOrder.sessionDate!==session.date)) return finish('REVIEW_EXPIRED_PROTECTION','Protection validity for this trading session is not established.');
 if(!Number.isFinite(Date.parse(protectiveOrder.observedAt))||now-Date.parse(protectiveOrder.observedAt)>30000||Date.parse(protectiveOrder.observedAt)>now+2000) return finish('RECONCILE_PROTECTION','Protection order snapshot is stale or invalid.');
 return {...finish('SHADOW_PROTECTION_CONFIRMED','A matching stop order was reported by the broker; execution and price are not guaranteed.'),protectionOrderVerified:true,notes:['Shadow coverage assessment only; this does not verify live entry/exit execution.']};
}
