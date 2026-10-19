import fs from 'node:fs';
import path from 'node:path';
// A log append, process success or dialog display is never a user receipt.
export function alertReceipt(root,{now=Date.now()}={}) {
 const read=name=>{try{return JSON.parse(fs.readFileSync(path.join(root,name),'utf8').replace(/^\uFEFF/,''));}catch{return null;}};
 const challenge=read('desktop-alert-challenge.json'),receipt=read('desktop-alert-receipt.json'),delivery=read('desktop-alert-status.json');
 const age=now-Date.parse(delivery?.at??'');
 const session=t=>Number.isFinite(Date.parse(t))?new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t)):null;
 const delivered=['DISPLAYED','READY'].includes(delivery?.state)&&Number.isFinite(age)&&age>=-2000&&age<=120000;
 const valid=challenge?.version===1&&typeof challenge.id==='string'&&/^[a-f0-9-]{36}$/.test(challenge.id)&&receipt?.challengeId===challenge.id&&receipt.source==='DESKTOP_ACKNOWLEDGE_BUTTON'&&Date.parse(receipt.acknowledgedAt)>=Date.parse(challenge.createdAt)&&Date.parse(receipt.acknowledgedAt)<=Date.parse(challenge.expiresAt)&&Date.parse(receipt.acknowledgedAt)<=now+2000&&session(receipt.acknowledgedAt)===session(new Date(now).toISOString());
 return {channel:'LOCAL_DESKTOP',deliveryHeartbeatFresh:delivered,userReceiptVerified:delivered&&valid,scope:'LOGGED_IN_WINDOWS_SESSION_ONLY',unattendedExecutionVerified:false};
}
