import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessProtectionSnapshot} from './protection-coverage.mjs';
import {probeStoredAlpaca} from './alpaca-data-client.mjs';
import {SAFETY_POLICY} from './safety-policy.mjs';
export async function shadowReadiness(root,{now}={}) {
 const entryData=await probeStoredAlpaca(root);now??=Date.now();const blockers=[];
 let snapshot;
 try {snapshot=JSON.parse(fs.readFileSync(path.join(root,'broker-reconciliation.json'),'utf8'));} catch {blockers.push('BROKER_SNAPSHOT_MISSING');}
 const age=now-Date.parse(snapshot?.generatedAt);
 const fresh=Number.isFinite(age)&&age>=-2000&&age<=120000;
 if(snapshot&&!fresh) blockers.push('BROKER_SNAPSHOT_STALE');
 let status;try {status=JSON.parse(fs.readFileSync(path.join(root,'status.json'),'utf8'));}catch{}
 const currentAge=now-Date.parse(status?.at);
 if(status?.brokerConnected!==true||status?.reconciliation?.positionsReadComplete!==true||status?.reconciliation?.orderHistoryReadComplete!==true||!Number.isFinite(currentAge)||currentAge< -2000||currentAge>120000) blockers.push('CURRENT_BROKER_RECONCILIATION_UNVERIFIED');
 if(!entryData.connected)blockers.push('LOCAL_ALPACA_DATA_UNVERIFIED');
 const coverage=assessProtectionSnapshot({snapshot,status,now});
 const assessments=coverage.assessments;blockers.push(...coverage.blockers);
 blockers.push('LIVE_ENTRY_EXIT_UNVERIFIED','BROKER_PROTECTION_FLOW_UNVERIFIED','STRATEGY_EVIDENCE_NOT_ADMITTED','OPERATIONAL_SOAK_INCOMPLETE',...(snapshot?.blockers||[]));
 return {generatedAt:new Date(now).toISOString(),shadowOnly:true,liveEnabled:SAFETY_POLICY.liveExecutionEnabled,allowRealMoneyOrders:false,entryData,brokerSnapshotFresh:fresh,assessments,blockers:[...new Set(blockers)],note:'Holding coverage observations are not instructions to change existing holdings. Alpaca data or paper tests do not establish Robinhood live execution capabilities.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const index=process.argv.indexOf('--state-dir'),root=process.argv[index+1];
 if(index<0||!root||!path.isAbsolute(root)) {process.stderr.write('Absolute --state-dir required\n');process.exitCode=1;}
 else shadowReadiness(root).then(result=>{fs.writeFileSync(path.join(root,'shadow-readiness.json'),JSON.stringify(result,null,2),{mode:0o600});process.stdout.write(JSON.stringify({shadowOnly:true,liveEnabled:false,allowRealMoneyOrders:false,brokerSnapshotFresh:result.brokerSnapshotFresh,holdingAssessments:result.assessments.length,observedStopOrders:result.assessments.filter(a=>a.matchedStopObserved).length,blockers:result.blockers})+'\n');}).catch(()=>{process.stderr.write('SHADOW_READINESS_FAILED\n');process.exitCode=1;});
}
