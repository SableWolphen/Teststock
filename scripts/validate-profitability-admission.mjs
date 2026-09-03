import fs from 'node:fs/promises';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const [s,t]=await Promise.all(['docs/signal.json','docs/data/stock-tournament.json'].map(read)),fail=[];
if(t.profitabilityAdmissionPolicy?.mode!=='TIERED_A_NORMAL_B_MICRO_WITH_REAL_SUSPENSION')fail.push('policy mode');
if(s.autopilot?.requiresPerOrderApproval!==false||s.autopilot?.automaticQualifiedBuys!==true)fail.push('automatic stock policy');
for(const x of t.liveQueue||[]){
  const a=x.profitabilityAdmission||{},blocked=['SHADOW_ONLY','LIVE_SUSPENDED'].includes(a.state);
  if(a.historicalEvidenceIsDiagnosticOnly!==true)fail.push(`${x.ticker}: historical authority`);
  if(a.state==='ELITE_RUNTIME_ELIGIBLE'){
    if(x.entryTier!=='A')fail.push(`${x.ticker}: elite state on non-A`);
    if(Number(a.sizeMultiplier)>1||Number(x.adaptiveSizeMultiplier)>1)fail.push(`${x.ticker}: A size`);
    if(a.regimeDisabled===true||a.contradictoryShadow===true||a.negativeRealProbation===true)fail.push(`${x.ticker}: unsafe A runtime eligibility`);
  }
  if(a.state==='BEST_ACCEPTABLE_MICRO'){
    if(x.entryTier!=='B')fail.push(`${x.ticker}: B micro state on non-B`);
    if(Number(a.sizeMultiplier)>.25||Number(x.adaptiveSizeMultiplier)>.25||Number(x.entryTierSizeMultiplier)>.25)fail.push(`${x.ticker}: B micro size`);
    if(a.regimeDisabled===true||a.contradictoryShadow===true||a.negativeRealProbation===true)fail.push(`${x.ticker}: unsafe B micro eligibility`);
  }
  if(a.state==='MICRO_PROBATION'){
    if(Number(a.sizeMultiplier)>.25||Number(x.adaptiveSizeMultiplier)>.25)fail.push(`${x.ticker}: micro size`);
    const shadow=Number(a.shadow?.samples)>=6&&Number(a.shadow?.winRatePct)>=50&&Number(a.shadow?.averageR)>=.15&&a.regimeDisabled!==true&&a.contradictoryShadow!==true;
    if(!shadow)fail.push(`${x.ticker}: forward micro evidence`);
  }
  if(x.entryTier==='B'&&!blocked&&Number(x.adaptiveSizeMultiplier)>.25)fail.push(`${x.ticker}: B above micro cap`);
  if(blocked&&x.action!=='PROFITABILITY_ADMISSION_BLOCK')fail.push(`${x.ticker}: block`);
  if(x.seedLane?.eligible===true&&x.dayTradeSeedLane?.eligible===true)fail.push(`${x.ticker}: swing/day-trade overlap`);
  if(x.dayTradeSeedLane?.eligible===true&&(x.entryTier!=='A'||a.state!=='SHADOW_ONLY'||a.regimeDisabled===true||a.contradictoryShadow===true||Number(x.dayTradeSeedLane.maxOrderUsd)!==20||x.dayTradeSeedLane.journalTag!=='dayTradeSeedLane:true'))fail.push(`${x.ticker}: invalid day-trade seed eligibility`);
}
if(s.generatorIntegrity?.traceableFeatures?.tieredStockProfitabilityAdmission!==true)fail.push('tiered admission integrity');
if(s.generatorIntegrity?.traceableFeatures?.eliteARuntimeEligibility!==true)fail.push('A runtime integrity');
if(s.generatorIntegrity?.traceableFeatures?.bTierMicroProbation!==true)fail.push('B micro integrity');
if(fail.length)throw new Error(`profitability admission validation failed: ${[...new Set(fail)].join(', ')}`);
console.log(`profitability admission validation passed: A normal runtime eligibility; B micro capped at 25%; A=${(t.liveQueue||[]).filter(x=>x.profitabilityAdmission?.state==='ELITE_RUNTIME_ELIGIBLE').length}; B=${(t.liveQueue||[]).filter(x=>x.profitabilityAdmission?.state==='BEST_ACCEPTABLE_MICRO').length}`);
