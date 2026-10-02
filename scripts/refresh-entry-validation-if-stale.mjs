import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
let age=Infinity;
try{const d=JSON.parse(fs.readFileSync('docs/data/entry-gate-validation.json','utf8'));age=(Date.now()-Date.parse(d.generatedAt))/60000;}catch{}
if(!Number.isFinite(age)||age<0||age>110){
  console.log('Entry validation stale or missing; recomputing original holdouts');
  const r=spawnSync(process.execPath,['scripts/validate-entry-gates.mjs'],{stdio:'inherit'});
  if(r.error)throw r.error;
  if(r.status!==0)throw new Error('Entry holdout refresh failed');
}else console.log('Reusing fresh entry holdout validation');
