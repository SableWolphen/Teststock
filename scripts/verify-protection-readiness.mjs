import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessProtectionSnapshot} from './protection-coverage.mjs';
import {atomicJson} from './windows-monitor.mjs';

export function verifyProtectionReadiness(root,{now=Date.now()}={}) {
  const read=name=>{try{return JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));}catch{return null;}};
  return assessProtectionSnapshot({snapshot:read('broker-reconciliation.json'),status:read('status.json'),now});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const index=process.argv.indexOf('--state-dir'),root=process.argv[index+1];
  try {
    if(index<0||!root||!path.isAbsolute(root)||!fs.existsSync(root))throw Error();
    const report=verifyProtectionReadiness(root);atomicJson(path.join(root,'protection-readiness.json'),report);
    const {assessments,...summary}=report;console.log(JSON.stringify(summary));
    if(report.blockers.length)process.exitCode=2;
  }catch{console.error('PROTECTION_AUDIT_FAILED: inspect private runtime state');process.exitCode=1;}
}
