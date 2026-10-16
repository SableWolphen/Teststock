// Pure, broker-independent readiness evaluation. Never interprets permissions as proof of live fills.
import {SAFETY_POLICY} from './safety-policy.mjs';
export function evaluateTradingReadiness({capability={},broker={},scheduler={},reconciliation={},now=Date.now()}={}){
 const at=Date.parse(capability.verifiedAt||'');
 const fresh=Number.isFinite(at)&&at<=now&&now-at<=3600000;
 const permission=broker.agenticAllowed===true;
 const stockEntry=fresh&&permission&&capability.liveOrderSubmission===true&&capability.liveEquityEntrySubmission===true;
 const stockExit=fresh&&permission&&capability.liveEquityExitSubmission===true;
 const optionPermission=permission&&['option_level_2','option_level_3'].includes(broker.optionLevel);
 const optionEntry=fresh&&optionPermission&&capability.liveOrderSubmission===true&&capability.liveOptionEntrySubmission===true;
 const optionExit=fresh&&optionPermission&&capability.liveOptionExitSubmission===true&&capability.liveOptionExitVerifiedThisSession===true;
 const monitoring=scheduler.healthy===true&&scheduler.exitEscalationVerified===true;
 const reconciled=reconciliation.positions===true&&reconciliation.orders===true&&reconciliation.fills===true;
 const deploymentEnabled=SAFETY_POLICY.liveExecutionEnabled;
 const stockReady=deploymentEnabled&&stockEntry&&stockExit&&monitoring&&reconciled;
 const optionReady=deploymentEnabled&&optionEntry&&optionExit&&monitoring&&reconciled;
 return {mode:stockReady||optionReady?'VERIFIED_ELIGIBLE':'MANUAL_ONLY_FAIL_CLOSED',stockReady,optionReady,checks:{deploymentEnabled,brokerPermission:permission,optionPermission,capabilityFresh:fresh,stockEntry,stockExit,optionEntry,optionExit,monitoring,reconciled},note:'Verification of eligibility is not evidence of a submitted or filled order. Broker restrictions and live per-order checks still apply.'};
}
