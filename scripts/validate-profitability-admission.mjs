import { stockExecutionPolicyFailures } from './stock-execution-policy-validation.mjs';
import fs from 'node:fs/promises';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const [s,t]=await Promise.all(['docs/signal.json','docs/data/stock-tournament.json'].map(read)),fail=[];
fail.push(...stockExecutionPolicyFailures(s));
const dayTradeOnlyMode=s.dayTradeOnlyEntryPolicy?.enabled===true;
if(t.profitabilityAdmissionPolicy?.mode!=='EVIDENCE_FIRST_DAY_TRADING')fail.push('policy mode');
for(const x of t.liveQueue||[]){
  const a=x.profitabilityAdmission||{},blocked=['SHADOW_ONLY','LIVE_SUSPENDED'].includes(a.state);
  if(a.historicalEvidenceIsDiagnosticOnly!==true)fail.push(`${x.ticker}: historical authority`);
  if(a.state==='MICRO_PROBATION'){
    if(Number(a.sizeMultiplier)>.25||Number(x.adaptiveSizeMultiplier)>.25)fail.push(`${x.ticker}: micro size`);
    const shadow=Number(a.shadow?.samples)>=100&&Number(a.shadow?.distinctTradingDays)>=20&&Number(a.shadow?.winRatePct)>=50&&Number(a.shadow?.averageR)>=.10&&Number(a.shadow?.profitFactor)>=1.25&&a.regimeDisabled!==true&&a.contradictoryShadow!==true;
    if(!shadow)fail.push(`${x.ticker}: forward micro evidence`);
  }
  if(x.entryTier==='B'&&!blocked&&Number(x.adaptiveSizeMultiplier)>.25)fail.push(`${x.ticker}: B above micro cap`);
  if(blocked&&x.action!=='PROFITABILITY_ADMISSION_BLOCK')fail.push(`${x.ticker}: block`);
  if(x.seedLane?.eligible===true&&x.dayTradeSeedLane?.eligible===true)fail.push(`${x.ticker}: swing/day-trade overlap`);
  // Day-trade-only mode (2026-09-22) lets apply-profitability-admission.mjs also flag an already-
  // admitted ELITE_RUNTIME_ELIGIBLE/BEST_ACCEPTABLE_MICRO row dayTradeSeedLane-eligible (not just
  // SHADOW_ONLY bypass rows), so this validator must accept that admitted state too -- only while
  // the policy is actually enabled, so the stricter SHADOW_ONLY-only check still applies normally.
  const dayTradeStateOk=dayTradeOnlyMode&&['MICRO_PROBATION','PROBATION','LIVE_ADMITTED'].includes(a.state);
  if(x.dayTradeSeedLane?.eligible===true&&(!['A','B'].includes(x.entryTier)||!dayTradeStateOk||a.regimeDisabled===true||a.contradictoryShadow===true||Number(x.dayTradeSeedLane.maxOrderUsd)!==(x.entryTier==='B'?7.5:30)||x.dayTradeSeedLane.journalTag!=='dayTradeSeedLane:true'))fail.push(`${x.ticker}: invalid day-trade seed eligibility`);
  if(x.seedLane?.eligible===true)fail.push(`${x.ticker}: evidence-first mode forbids swing seed bypass`);
}
if(s.generatorIntegrity?.traceableFeatures?.shadowFirstProfitabilityAdmission!==true)fail.push('shadow-first integrity');
if(s.generatorIntegrity?.traceableFeatures?.evidenceFirstDayTrading!==true)fail.push('evidence-first integrity');
if(s.generatorIntegrity?.traceableFeatures?.bTierMicroProbation!==true)fail.push('B micro integrity');
if(fail.length)throw new Error(`profitability admission validation failed: ${[...new Set(fail)].join(', ')}`);
console.log(`profitability admission validation passed: evidence-first stock day trading; micro=${(t.liveQueue||[]).filter(x=>x.profitabilityAdmission?.state==='MICRO_PROBATION').length}`);
