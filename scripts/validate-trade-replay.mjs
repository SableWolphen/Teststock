import fs from 'node:fs/promises';
const x=JSON.parse(await fs.readFile('docs/data/trade-replay.json','utf8'));
const die=m=>{throw new Error(`trade-replay validation failed: ${m}`)};
if(x.schemaVersion!==1)die('schemaVersion');
if(!x.generatedAt||!Number.isFinite(new Date(x.generatedAt).getTime()))die('generatedAt');
if(!['OK','DEGRADED'].includes(x.status))die('status');
if(x.authority!=='RESEARCH_ONLY')die('authority');
if(!Array.isArray(x.trades)||!x.summary)die('payload');
for(const t of x.trades){for(const k of ['maximumFavorableExcursionR','maximumAdverseExcursionR','barCount'])if(!Number.isFinite(Number(t[k])))die(`bad ${k}`);}
console.log('Trade replay validation passed.');
