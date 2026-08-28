import fs from 'node:fs/promises';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const [intel,tournament,signal]=await Promise.all(['docs/data/congressional-intelligence.json','docs/data/stock-tournament.json','docs/signal.json'].map(read));
const fail=[];
if(intel.mode!=='SHADOW_DIAGNOSTIC_ONLY'||intel.admission?.liveInfluenceAllowed!==false)fail.push('shadow-only admission');
if(!String(intel.authority).includes('cannot create live eligibility'))fail.push('non-expansive authority');
if(signal.autopilot?.requiresPerOrderApproval!==false||signal.autopilot?.automaticQualifiedBuys!==true)fail.push('automatic stock policy');
if(signal.executionArchitecture?.mode!=='TWO_TOURNAMENTS_ONLY')fail.push('two tournaments');
const keys=new Set();for(const x of intel.records||[]){const k=[x.politician.toUpperCase(),x.ticker,x.transactionDate,x.side,String(x.amountRange).replace(/\s/g,'')].join('|');if(keys.has(k))fail.push('duplicate filing');keys.add(k);if(Number(x.recencyWeight)>1||Number(x.recencyWeight)<0)fail.push('invalid decay');if(Date.parse(x.transactionDate)>Date.now()+86400000)fail.push('future transaction');}
for(const x of [...(tournament.liveQueue||[]),...(tournament.researchFinalists||[])]){const c=x.congressionalIntelligence;if(!c||c.rankingContribution!==0||c.liveInfluenceAllowed!==false||c.hardGatesRemainAuthoritative!==true)fail.push(`${x.ticker||x.symbol}: influence`);}
if(fail.length)throw new Error(`congressional-intelligence validation failed: ${[...new Set(fail)].join(', ')}`);
console.log(`congressional-intelligence validation passed: ${intel.records.length} deduplicated records; shadow-only; risk and approval preserved`);
