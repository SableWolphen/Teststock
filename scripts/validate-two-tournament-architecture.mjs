import fs from 'node:fs/promises';
const s=JSON.parse(await fs.readFile('docs/signal.json','utf8'));
const fail=[];
const a=s.executionArchitecture;
if(s.schemaVersion<36)fail.push('schema <36');
if(a?.mode!=='TWO_TOURNAMENTS_ONLY')fail.push('architecture mode');
if(a?.researchAuthority!=='TESTSTOCK')fail.push('research authority');
if(a?.tournaments?.stock?.enabled!==true)fail.push('stock tournament');
if(a?.tournaments?.crypto?.enabled!==true)fail.push('crypto tournament');
if(a?.crossAssetSelection!==false)fail.push('cross-asset selection');
if(!Array.isArray(a?.disabledAssetClasses)||!a.disabledAssetClasses.includes('OPTION'))fail.push('option disabled');
if(s.stockPlan?.eliteOption!=null)fail.push('live elite option still present');
for(const t of s.capitalLadder?.tiers||[]){if(t.newOptionsAllowed!==false||Number(t.maxOptionRiskPct||0)!==0)fail.push('capital tier option risk');}
if(Number(s.tradeFrequencyGuard?.maxNewOptionsPerDay||0)!==0)fail.push('option frequency');
if(s.generatorIntegrity?.traceableFeatures?.twoTournamentArchitecture!==true)fail.push('integrity marker');
if(fail.length)throw new Error(`two-tournament validation failed: ${[...new Set(fail)].join(', ')}`);
console.log('two-tournament architecture validation passed: stock + crypto only');
