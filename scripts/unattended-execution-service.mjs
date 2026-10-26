#!/usr/bin/env node
// Independent Teststock preflight worker. No broker write methods are reachable here.
// This is the first stage of an unattended executor, NOT a live order executor.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {evaluateTradingReadiness} from './trading-readiness.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=(file)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));}catch{return null;}};
const age=(date,now)=>{const t=Date.parse(date||'');return Number.isFinite(t)&&t<=now?now-t:Infinity;};
export function evaluatePreflight({dispatch,health,capability,attestation,now=Date.now()}={}){
  const reasons=[];
  if(!dispatch||!health)reasons.push('MISSING_DISPATCH_OR_HEALTH');
  if(age(dispatch?.generatedAt,now)>15*60000)reasons.push('STALE_DISPATCH');
  if(age(health?.generatedAt,now)>15*60000)reasons.push('STALE_HEALTH');
  if(dispatch?.dispatchHealth!=='OK'||health?.status!=='OK')reasons.push('UNHEALTHY_MARKET_DATA');
  if(health?.newRiskPermission!=='ALLOWED')reasons.push('NEW_RISK_BLOCKED');
  if(dispatch?.manualExecutionOnly!==false||dispatch?.riskCreationBlockedByExecutor!==false)reasons.push('DISPATCH_EXECUTOR_LOCK');
  const ready=evaluateTradingReadiness({capability:capability||{},broker:attestation?.broker||{},scheduler:attestation?.scheduler||{},reconciliation:attestation?.reconciliation||{},now});
  if(!ready.stockReady&&!ready.optionReady)reasons.push('UNVERIFIED_UNATTENDED_BROKER_EXECUTION');
  const action=dispatch?.pendingAction||null;
  if(!action||action.isActionable!==true)reasons.push('NO_ACTIONABLE_TRADE');
  if(action&&age(action.freshnessAnchor||action.triggerStateChangedAt,now)>10*60000&&String(action.trigger).includes('BUY'))reasons.push('STALE_ENTRY');
  return {status:reasons.length?'NO_ORDER':'READY_FOR_SEPARATE_ORDER_REVIEW',brokerWrite:false,liveOrderSubmitted:false,reasons,checks:ready.checks,actionFingerprint:action?.fingerprint||null};
}
export function runOnce({now=Date.now()}={}){
 const result=evaluatePreflight({dispatch:read('docs/data/execution-dispatch.json'),health:read('docs/data/live-trading-health.json'),capability:read('docs/data/executor-capabilities.json'),attestation:read('docs/data/unattended-runtime-attestation.json'),now});
 return {generatedAt:new Date(now).toISOString(),mode:'READ_ONLY_PREFLIGHT',...result};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=runOnce();
 process.stdout.write(JSON.stringify(result)+'\n');
 if(process.argv.includes('--mcp-probe')){
   // Explicitly read-only. Requires separately provisioned broker OAuth and OpenAI API secrets.
   // Never invoke --live, place_*, cancel_*, or any writable broker client.
   const child=spawnSync(process.execPath,['scripts/chatgpt-executor.mjs','--mcp-probe'],{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,TESTSTOCK_EXECUTION_MODE:'paper'}});
   const ok=child.status===0;
   process.stdout.write(JSON.stringify({readOnlyBrokerProbe:ok?'PASSED':'FAILED',noOrdersSubmitted:true})+'\n');
   if(!ok)process.exitCode=1;
 }
}
