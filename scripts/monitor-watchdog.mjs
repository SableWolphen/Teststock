import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function watchdog(root,{now=Date.now()}={}) {
 fs.mkdirSync(root,{recursive:true});
 const lock=path.join(root,'watchdog.lock');
 const guard=fs.openSync(lock,'wx',0o600);fs.closeSync(guard);
 try {
  let status;try {status=JSON.parse(fs.readFileSync(path.join(root,'status.json'),'utf8'));}catch{}
  const codes=[];const age=now-Date.parse(status?.at);
  if(!Number.isFinite(age)||age< -2000||age>120000) codes.push('MONITOR_HEARTBEAT_STALE_OR_MISSING');
  if(status?.health!=='READ_ONLY_HEALTHY'||!status?.brokerConnected) codes.push('BROKER_MONITOR_BLOCKED');
  if(!status?.entryData?.connected) codes.push('MARKET_DATA_BLOCKED');
  if(status?.reconciliation?.allAssetReconciliationComplete!==true) codes.push('RECONCILIATION_INCOMPLETE');
  if(status?.liveEnabled!==false||status?.tradingReady!==false) codes.push('UNEXPECTED_LIVE_STATE');
  if(fs.existsSync(path.join(root,'STOP'))) codes.push('MONITOR_STOP_REQUESTED');
  const stateFile=path.join(root,'watchdog-status.json');let previous=[];
  if(fs.existsSync(stateFile)) {
   try {previous=JSON.parse(fs.readFileSync(stateFile,'utf8')).activeCodes;if(!Array.isArray(previous))throw Error();}
   catch {codes.push('WATCHDOG_STATE_INVALID');previous=[];}
  }
  // Only fixed local codes are emitted; no broker bodies, accounts or secrets.
  const events=[...codes.filter(c=>!previous.includes(c)).map(code=>({type:'INCIDENT',code})),...previous.filter(c=>!codes.includes(c)&&/^[A-Z_]+$/.test(c)).map(code=>({type:'RECOVERED',code}))];
  const at=new Date(now).toISOString();
  if(events.length) {
   const fd=fs.openSync(path.join(root,'alerts.jsonl'),'a',0o600);
   try {for(const event of events)fs.writeSync(fd,JSON.stringify({at,...event,delivery:'LOCAL_FILE_ONLY'})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  const report={at,activeCodes:codes,localEventsWritten:events.length,delivery:'LOCAL_FILE_ONLY',userReceiptVerified:false,liveEnabled:false};
  const temp=stateFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(report,null,2),{mode:0o600});fs.renameSync(temp,stateFile);
  return report;
 } finally {fs.unlinkSync(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const i=process.argv.indexOf('--state-dir'),root=process.argv[i+1];
 try {if(i<0||!root||!path.isAbsolute(root))throw Error();console.log(JSON.stringify(watchdog(root)));}
 catch {console.error('WATCHDOG_FAILED: inspect private runtime permissions or existing watchdog lock');process.exitCode=1;}
}
