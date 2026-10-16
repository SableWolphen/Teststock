import fs from 'node:fs';
import crypto from 'node:crypto';
// Serialize recovery and creation so a contender cannot rename a newly acquired lock.
export function acquireMonitorLock(lock) {
 const recovery=lock+'.recovery';const guard=fs.openSync(recovery,'wx',0o600);fs.closeSync(guard);
 try {
  if(fs.existsSync(lock)) {
   const owner=JSON.parse(fs.readFileSync(lock,'utf8'));
   if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw Error('MONITOR_LOCK_OWNER_UNVERIFIED');
   let dead=false;try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')dead=true;else throw Error('MONITOR_LOCK_OWNER_UNVERIFIED');}
   if(!dead)throw Error('MONITOR_LOCKED');
   fs.renameSync(lock,lock+'.abandoned-'+crypto.randomUUID());
  }
  const fd=fs.openSync(lock,'wx',0o600);
  try{fs.writeSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }finally{fs.unlinkSync(recovery);}
}
