#!/usr/bin/env node
/**
 * Teststock always-on supervisor.
 *
 * Runs the existing executor (scripts/chatgpt-executor.mjs) on a timer during
 * US regular market hours. It places no orders itself and cannot bypass any
 * executor gate. Paper mode is the default; live mode still needs the
 * executor's own sentinel, fresh capability attestation, and admission gates.
 *
 * Fail-closed: the kill switch, stale dispatch data, a failed data refresh, or
 * repeated executor failures stop all ticks and send an alert. A halted service
 * also stops managing exits, so the alert must reach a human.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateNyseSession} from './nyse-session.mjs';

const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MAX_DISPATCH_AGE_MS=15*60*1000;

export function runtimeDir(env=process.env){return env.TESTSTOCK_RUNTIME_STATE_DIR||path.join(os.homedir(),'.teststock-runtime');}
export function killFile(env=process.env){return env.TESTSTOCK_KILL_FILE||path.join(runtimeDir(env),'KILL');}

export function isKilled(env=process.env){
  if(['1','true','yes'].includes(String(env.TESTSTOCK_KILL||'').toLowerCase()))return {killed:true,reason:'TESTSTOCK_KILL env set'};
  try{fs.accessSync(killFile(env));return {killed:true,reason:'kill file present: '+killFile(env)};}catch{return {killed:false};}
}

// Regular session 09:30-16:00 New York on weekdays, minus listed holiday dates.
// No built-in holiday calendar: set TESTSTOCK_HOLIDAYS=YYYY-MM-DD,... for closures.
export function sessionFor(now=new Date(),env=process.env){
  const ny=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short'}).format(now);
  const date=evaluateNyseSession({now}).dateKey;
  const holidays=String(env.TESTSTOCK_HOLIDAYS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(['Sat','Sun'].includes(ny)||holidays.includes(date))return {open:false,reason:'market closed (weekend/holiday)',session:null};
  const session=evaluateNyseSession({now,calendarSession:{date,open:'09:30',close:'16:00'}});
  return {open:session.regularSession,reason:session.regularSession?'regular session':'outside regular hours',session};
}

// The executor reads docs/data/execution-dispatch.json from disk. Never act on
// a packet older than 15 minutes, or one with an unreadable timestamp.
export function dispatchFresh(dispatch,now=new Date(),maxAgeMs=MAX_DISPATCH_AGE_MS){
  const t=Date.parse(dispatch?.generatedAt);
  if(!Number.isFinite(t))return {fresh:false,reason:'dispatch has no valid generatedAt'};
  const age=now.getTime()-t;
  if(age<-60000)return {fresh:false,reason:'dispatch timestamp is in the future'};
  if(age>maxAgeMs)return {fresh:false,reason:'dispatch is '+Math.round(age/60000)+' minutes old'};
  return {fresh:true,ageMs:age};
}

export function decideTick({now=new Date(),env=process.env,consecutiveFailures=0,maxFailures=3}={}){
  const k=isKilled(env);
  if(k.killed)return {run:false,state:'KILLED',reason:k.reason};
  if(!Number.isFinite(now.getTime()))return {run:false,state:'HALTED',reason:'invalid clock'};
  if(consecutiveFailures>=maxFailures)return {run:false,state:'HALTED',reason:consecutiveFailures+' consecutive failures'};
  const s=sessionFor(now,env);
  if(!s.open)return {run:false,state:'IDLE',reason:s.reason};
  return {run:true,state:'RUNNING',reason:s.reason};
}

export async function sendAlert(message,env=process.env,fetchImpl=globalThis.fetch){
  const url=env.TESTSTOCK_ALERT_WEBHOOK_URL;
  process.stderr.write('[alert] '+message+'\n');
  if(!url)return {sent:false,reason:'no webhook configured'};
  try{const r=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Teststock: '+message}),signal:AbortSignal.timeout(10000)});return {sent:r.ok,status:r.status};}
  catch(e){return {sent:false,reason:String(e.message||e)};}
}

function writeHeartbeat(state,env=process.env){
  const dir=runtimeDir(env);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'service-heartbeat.json');
  fs.writeFileSync(file+'.tmp',JSON.stringify({...state,at:new Date().toISOString(),mode:env.TESTSTOCK_EXECUTION_MODE||'paper'},null,2));
  fs.renameSync(file+'.tmp',file);
}

function refreshData(){
  return new Promise(resolve=>{
    if(process.env.TESTSTOCK_SKIP_GIT_PULL==='1')return resolve({ok:true,skipped:true});
    execFile('git',['pull','--ff-only','--quiet'],{cwd:ROOT,timeout:60000},err=>resolve(err?{ok:false,error:String(err.message).slice(0,200)}:{ok:true}));
  });
}

function runExecutor(env=process.env){
  return new Promise(resolve=>{
    const child=spawn(process.execPath,[path.join(ROOT,'scripts/chatgpt-executor.mjs')],{cwd:ROOT,env});
    let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',()=>{});
    const timer=setTimeout(()=>child.kill('SIGKILL'),540000);
    child.on('close',()=>{clearTimeout(timer);const line=out.trim().split('\n').filter(Boolean).at(-1)||'';try{resolve(JSON.parse(line));}catch{resolve({is_error:true,error:'unparseable executor output'});}});
    child.on('error',e=>{clearTimeout(timer);resolve({is_error:true,error:String(e.message)});});
  });
}

async function tick(failures){
  const d=decideTick({consecutiveFailures:failures});
  if(!d.run)return {d,failures,result:null};
  const pulled=await refreshData();
  if(!pulled.ok){await sendAlert('data refresh failed: '+pulled.error);return {d:{...d,state:'STALE',reason:'git pull failed'},failures:failures+1,result:null};}
  let dispatch=null;try{dispatch=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/data/execution-dispatch.json'),'utf8'));}catch{}
  const f=dispatchFresh(dispatch);
  if(!f.fresh){await sendAlert('stale dispatch, no action: '+f.reason);return {d:{...d,state:'STALE',reason:f.reason},failures:failures+1,result:null};}
  const result=await runExecutor();
  if(result.is_error){await sendAlert('executor failure ('+(failures+1)+'): '+result.error);return {d,failures:failures+1,result};}
  if(result.broker_write_attempted)await sendAlert('broker write attempted: '+JSON.stringify({fingerprint:result.fingerprint,mcp_calls:result.mcp_calls}));
  return {d,failures:0,result};
}

async function main(){
  const intervalMs=Math.max(60000,Number(process.env.TESTSTOCK_TICK_SECONDS||300)*1000);
  let failures=0,lastState='';
  for(;;){
    const r=await tick(failures);failures=r.failures;
    if(r.d.state!==lastState&&['KILLED','HALTED'].includes(r.d.state))await sendAlert('service '+r.d.state+': '+r.d.reason);
    lastState=r.d.state;
    writeHeartbeat({state:r.d.state,reason:r.d.reason,failures,lastResult:r.result&&(r.result.result||r.result.error)||null});
    await new Promise(res=>setTimeout(res,intervalMs));
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
