// Pure, conservative qualification for day-trading research.
// Never grants broker authority; a qualified result still needs every existing live gate.
import {SAFETY_POLICY} from './safety-policy.mjs';
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function daytradeEvidenceGate(evidence={}, {assetClass='STOCK'}={}) {
  const rules=assetClass==='OPTION'?SAFETY_POLICY.options:SAFETY_POLICY.stocks;
  const failures=[];
  const n=number(evidence.independentResolvedTrades),days=number(evidence.distinctTradingDays);
  const pf=number(evidence.afterCostProfitFactor),edge=number(evidence.afterCostExpectancyUsd);
  if(n===null||n<rules.microSamples) failures.push('INSUFFICIENT_INDEPENDENT_OUTCOMES');
  if(days===null||days<rules.microDays) failures.push('INSUFFICIENT_TRADING_DAYS');
  if(pf===null||pf<rules.minProfitFactor) failures.push('AFTER_COST_PROFIT_FACTOR_UNPROVEN');
  if(edge===null||edge<=0) failures.push('AFTER_COST_EXPECTANCY_NOT_POSITIVE');
  if(evidence.outOfSampleVerified!==true) failures.push('OUT_OF_SAMPLE_EVIDENCE_MISSING');
  if(evidence.executablePricesVerified!==true) failures.push('EXECUTABLE_PRICE_EVIDENCE_MISSING');
  if(evidence.brokerEntryExitVerified!==true) failures.push('BROKER_ENTRY_EXIT_UNVERIFIED');
  if(evidence.protectiveExitVerified!==true) failures.push('PROTECTIVE_EXIT_UNVERIFIED');
  if(evidence.accountRiskLimitsVerified!==true) failures.push('ACCOUNT_RISK_LIMITS_UNVERIFIED');
  return {eligible:failures.length===0,failures,scope:'QUALIFICATION_ONLY_NO_BROKER_AUTHORITY',minimumSamples:rules.microSamples,minimumDays:rules.microDays,minimumProfitFactor:rules.minProfitFactor};
}
