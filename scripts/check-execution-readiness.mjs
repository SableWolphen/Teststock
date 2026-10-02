// Read-only readiness check. Never exposes credentials or account identifiers.
import fs from 'node:fs/promises';
import {collectSnapshot,remoteReader} from './reconcile-broker-state.mjs';
const mode=process.env.TESTSTOCK_EXECUTION_MODE||'paper';
const status={generatedAt:new Date().toISOString(),executionMode:mode,liveAuthorizationPresent:process.env.TESTSTOCK_LIVE_TRADING==='I_UNDERSTAND_REAL_ORDERS',openaiKeyPresent:Boolean(process.env.OPENAI_API_KEY),robinhoodTokenPresent:Boolean(process.env.ROBINHOOD_MCP_OAUTH_TOKEN),openaiConnectivity:'NOT_TESTED',robinhoodConnectivity:'NOT_TESTED',brokerWritesPerformed:false,blockers:[]};
if(mode!=='live')status.blockers.push('EXECUTION_MODE_NOT_LIVE');
if(!status.liveAuthorizationPresent)status.blockers.push('LIVE_AUTHORIZATION_NOT_CONFIGURED');
if(!status.openaiKeyPresent)status.blockers.push('OPENAI_API_KEY_MISSING');
else{
  try{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5',input:'Reply READY only.',max_output_tokens:256,store:false}),signal:AbortSignal.timeout(60000)});status.openaiConnectivity=r.ok?'CONNECTED':`HTTP_${r.status}`;if(!r.ok)status.blockers.push('OPENAI_CONNECTIVITY_FAILED');}
  catch{status.openaiConnectivity='FAILED';status.blockers.push('OPENAI_CONNECTIVITY_FAILED');}
}
if(!status.robinhoodTokenPresent)status.blockers.push('ROBINHOOD_MCP_OAUTH_TOKEN_MISSING');
else{
  try{await collectSnapshot(await remoteReader());status.robinhoodConnectivity='CONNECTED';}
  catch{status.robinhoodConnectivity='FAILED';status.blockers.push('ROBINHOOD_READ_ONLY_PROBE_FAILED');}
}
status.status=status.blockers.length?'BLOCKED':'READY_FOR_GATED_EXECUTION';
await fs.mkdir('docs/data',{recursive:true});await fs.writeFile('docs/data/executor-readiness.json',JSON.stringify(status,null,2));
console.log(JSON.stringify(status));
