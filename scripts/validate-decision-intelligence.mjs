import fs from 'node:fs/promises';
const signal=JSON.parse(await fs.readFile('docs/signal.json','utf8'));
const tournament=JSON.parse(await fs.readFile('docs/data/stock-tournament.json','utf8'));
const fail=[];
const p=tournament.decisionIntelligencePolicy;
if(p?.mode!=='BOUNDED_DECISION_OVERLAY')fail.push('bounded overlay policy');
if(!String(p?.authority||'').includes('Cannot create eligibility'))fail.push('non-expansive authority');
if(signal.executionArchitecture?.mode!=='TWO_TOURNAMENTS_ONLY')fail.push('two tournaments');
if(signal.executionArchitecture?.crossAssetSelection!==false)fail.push('no cross-asset selection');
if(signal.autopilot?.requiresPerOrderApproval!==true)fail.push('per-order approval');
if(signal.autopilot?.automaticQualifiedBuys!==false)fail.push('no automatic stock buys');
if(signal.stockPlan?.policy?.noMargin!==true)fail.push('no margin');
if(signal.stockPlan?.policy?.noAverageDown!==true)fail.push('no averaging down');
const hardText=JSON.stringify(signal.hardRules||[]).toLowerCase();
if(!hardText.includes('widen'))fail.push('no widened stops');
if(!hardText.includes('chase'))fail.push('no chasing');
for(const x of tournament.liveQueue||[]){
  const d=x.decisionIntelligence;
  if(!d||d.hardGatesRemainAuthoritative!==true)fail.push(`${x.ticker}: diagnostics`);
  if(d?.eligibleAfterOverlay&&!['AUTO_BUY_ELIGIBLE','WAIT_FOR_TRIGGER'].includes(x.action))fail.push(`${x.ticker}: created eligibility`);
  if(d?.upstreamActionAllowed&&!d?.eligibleAfterOverlay&&x.action!=='DECISION_INTELLIGENCE_BLOCK')fail.push(`${x.ticker}: block not authoritative`);
  if(d?.opportunityDecay?.expired&&d?.eligibleAfterOverlay)fail.push(`${x.ticker}: expired eligible`);
  if(d?.screener?.liquidity==='FAIL'&&d?.eligibleAfterOverlay)fail.push(`${x.ticker}: liquidity fail eligible`);
}
if(fail.length)throw new Error(`decision-intelligence validation failed: ${[...new Set(fail)].join(', ')}`);
console.log(`decision-intelligence validation passed: ${(tournament.liveQueue||[]).length} ranked; hard risk and approval authority preserved`);
