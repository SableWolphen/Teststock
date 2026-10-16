// Automatic-only order policy. This module never bypasses independent broker verification.
import { evaluateTradingReadiness } from './trading-readiness.mjs';
import { SAFETY_POLICY } from './safety-policy.mjs';
export function automaticExecutionPolicy({capability={},attestation={},assetClass='EQUITY',isExit=false,now=Date.now()}={}){
  const readiness=evaluateTradingReadiness({capability,broker:attestation.broker,scheduler:attestation.scheduler,reconciliation:attestation.reconciliation,now});
  const verified=SAFETY_POLICY.liveExecutionEnabled&&(assetClass==='OPTION'?readiness.optionReady:readiness.stockReady);
  if(isExit)return {mode:'AUTOMATIC_ONLY',action:'ATTEMPT_VERIFIED_RISK_REDUCING_EXIT',allowNewRisk:false,requiresBrokerReconciliation:true,manualHandoff:false,checks:readiness.checks};
  return {mode:'AUTOMATIC_ONLY',action:verified?'ELIGIBLE_FOR_LIVE_ORDER_CHECKS':'BLOCK_NEW_ENTRY',allowNewRisk:verified,requiresBrokerReconciliation:true,manualHandoff:false,checks:readiness.checks};
}
