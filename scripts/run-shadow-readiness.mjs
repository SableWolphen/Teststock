import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {protectionDrill} from './protection-shadow-drill.mjs';
import {probeStoredAlpaca} from './alpaca-data-client.mjs';
import {SAFETY_POLICY} from './safety-policy.mjs';
export async function shadowReadiness(root,{now=Date.now()}={}) {
 const entryData=await probeStoredAlpaca(root);const blockers=[];
 const session={regularHours:entryData.connected&&entryData.marketOpen===true,date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))};
 let snapshot;
 try {snapshot=JSON.parse(fs.readFileSync(path.join(root,'broker-reconciliation.json'),'utf8'));} catch {blockers.push('BROKER_SNAPSHOT_MISSING');}
 const age=now-Date.parse(snapshot?.generatedAt);
 const fresh=Number.isFinite(age)&&age>=-2000&&age<=120000;
 if(snapshot&&!fresh) blockers.push('BROKER_SNAPSHOT_STALE');
 let status;try {status=JSON.parse(fs.readFileSync(path.join(root,'status.json'),'utf8'));}catch{}
 const currentAge=now-Date.parse(status?.at);
 if(!status?.brokerConnected||status?.reconciliation?.positionsReadComplete!==true||status?.reconciliation?.orderHistoryReadComplete!==true||!Number.isFinite(currentAge)||currentAge< -2000||currentAge>120000) blockers.push('CURRENT_BROKER_RECONCILIATION_UNVERIFIED');
 if(!entryData.connected)blockers.push('LOCAL_ALPACA_DATA_UNVERIFIED');
 const assessments=[];
 if(fresh&&snapshot.positionsReadComplete===true&&snapshot.orderHistoryReadComplete===true) for(const p of snapshot.equities||[]) {
  const orders=(snapshot.orders||[]).filter(o=>o.asset==='EQUITY'&&o.symbol===p.symbol&&o.side==='sell'&&o.working);
  const stop=orders.find(o=>o.trigger==='stop');
  const exit=orders.find(o=>o.trigger!=='stop');
  const protectiveOrder=stop?{id:stop.id,symbol:stop.symbol,side:stop.side,type:stop.type==='limit'?'stop_limit':stop.type==='market'?'stop_market':'unsupported',quantity:stop.quantity,filledQuantity:stop.confirmedFilledQuantity,marketHours:stop.market_hours,stopPrice:stop.stop_price,state:stop.state,timeInForce:stop.time_in_force,sessionDate:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stop.created_at)),observedAt:snapshot.generatedAt}:null;
  assessments.push({symbol:p.symbol,observedStopOrder:Boolean(stop),assessment:protectionDrill({position:{symbol:p.symbol,quantity:p.quantity,observedAt:snapshot.generatedAt},protectiveOrder,exitOrder:exit,session,now})});
 }
 blockers.push('LIVE_ENTRY_EXIT_UNVERIFIED','BROKER_PROTECTION_FLOW_UNVERIFIED','STRATEGY_EVIDENCE_NOT_ADMITTED','OPERATIONAL_SOAK_INCOMPLETE',...(snapshot?.blockers||[]));
 return {generatedAt:new Date(now).toISOString(),shadowOnly:true,liveEnabled:SAFETY_POLICY.liveExecutionEnabled,allowRealMoneyOrders:false,entryData,brokerSnapshotFresh:fresh,assessments,blockers:[...new Set(blockers)],note:'Holding coverage observations are not instructions to change existing holdings. Alpaca data or paper tests do not establish Robinhood live execution capabilities.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const index=process.argv.indexOf('--state-dir'),root=process.argv[index+1];
 if(index<0||!root||!path.isAbsolute(root)) {process.stderr.write('Absolute --state-dir required\n');process.exitCode=1;}
 else shadowReadiness(root).then(result=>{fs.writeFileSync(path.join(root,'shadow-readiness.json'),JSON.stringify(result,null,2),{mode:0o600});process.stdout.write(JSON.stringify({shadowOnly:true,liveEnabled:false,allowRealMoneyOrders:false,brokerSnapshotFresh:result.brokerSnapshotFresh,holdingAssessments:result.assessments.length,observedStopOrders:result.assessments.filter(a=>a.observedStopOrder).length,blockers:result.blockers})+'\n');}).catch(()=>{process.stderr.write('SHADOW_READINESS_FAILED\n');process.exitCode=1;});
}
