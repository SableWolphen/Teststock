#!/usr/bin/env node
/**
 * OpenAI execution agent for Teststock.
 *
 * Default mode is PAPER. Real Robinhood writes require BOTH:
 *   TESTSTOCK_EXECUTION_MODE=live
 *   TESTSTOCK_LIVE_TRADING=I_UNDERSTAND_REAL_ORDERS
 *
 * The live path uses the OpenAI Responses API with the authenticated Robinhood
 * remote MCP server. No broker credential is committed or logged.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API_URL='https://api.openai.com/v1/responses';
const LIVE_SENTINEL='I_UNDERSTAND_REAL_ORDERS';

const INSTRUCTION_FILES=[
  'AGENTS.md',
  'scripts/chatgpt-executor-prompt.md',
  'scripts/chatgpt-trade-quality-rules.md',
  'scripts/chatgpt-stock-rotation-rules.md',
  'scripts/chatgpt-options-rules.md',
  'scripts/daytrader-profit-discipline.md',
];
const DATA_FILES=[
  'docs/data/execution-dispatch.json',
  'docs/data/trigger-board.json',
  'docs/data/intraday-edge.json',
  'docs/data/daytrader-intelligence.json',
  'docs/data/execution-watchlist.json',
  'docs/signal.json',
  'docs/data/adaptive-performance.json',
  'docs/data/options-profitability-admission.json',
  'docs/data/small-account-options.json',
];

function readIfExists(rel){try{return fs.readFileSync(path.join(ROOT,rel),'utf8');}catch{return null;}}
function readJson(rel){const v=readIfExists(rel);return v?JSON.parse(v):null;}
function config(){return readJson('.openai-mcp.json')||{};}
function executionMode(){
  const v=String(process.env.TESTSTOCK_EXECUTION_MODE||'paper').trim().toLowerCase();
  if(!['paper','live'].includes(v)) throw new Error('TESTSTOCK_EXECUTION_MODE must be paper or live');
  return v;
}
function mcpUrl(){return process.env.OPENAI_MCP_SERVER_URL||config().server_url||'https://agent.robinhood.com/mcp/trading';}
function mcpToken(){const env=config().authorization_env||'ROBINHOOD_MCP_OAUTH_TOKEN';return process.env[env]||'';}
function extractText(response){
  const chunks=[];
  for(const item of response.output||[])if(item.type==='message'&&Array.isArray(item.content))for(const part of item.content)if(part.type==='output_text'&&typeof part.text==='string')chunks.push(part.text);
  return chunks.join('\n').trim();
}
function mcpCallNames(response){return (response.output||[]).filter(x=>x.type==='mcp_call').map(x=>x.name).filter(Boolean);}
function fingerprintOf(x){
  if(!x||typeof x!=='object')return null;
  for(const k of ['fingerprint','dispatchFingerprint','claimKey','id'])if(typeof x[k]==='string'&&x[k])return x[k];
  return null;
}
function selectAction(dispatch){
  if(!(dispatch?.chatgptShouldRun===true||dispatch?.executionNeeded===true))return null;
  const rows=[dispatch.pendingAction,...(dispatch.optionCandidates||[]),...(dispatch.automaticStockCandidates||[]),...(dispatch.seedLaneCandidates||[]),...(dispatch.fallbackActions||[])];
  for(const action of rows){const fingerprint=fingerprintOf(action);if(fingerprint)return{fingerprint,action};}
  return null;
}
function refId(fingerprint){
  const b=Buffer.from(crypto.createHash('sha256').update(String(fingerprint)).digest().subarray(0,16));
  b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;
  const h=b.toString('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
function claim(selected,id){
  const root=process.env.TESTSTOCK_RUNTIME_STATE_DIR||path.join(os.homedir(),'.teststock-runtime');
  const dir=path.join(root,'executor-claims');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,crypto.createHash('sha256').update(selected.fingerprint).digest('hex')+'.json');
  let fd;try{fd=fs.openSync(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')return null;throw e;}
  fs.writeFileSync(fd,JSON.stringify({fingerprint:selected.fingerprint,ref_id:id,claimedAt:new Date().toISOString(),state:'CLAIMED_BEFORE_SUBMIT'},null,2));
  fs.closeSync(fd);return file;
}
function releaseClaim(file){try{if(file)fs.unlinkSync(file);}catch{}}

async function callResponses({instructions,input,tools,maxOutputTokens=3000,timeoutMs=480000,maxToolCalls=24}){
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey)throw new Error('authentication_error: OPENAI_API_KEY is not set');
  const body={model:process.env.OPENAI_MODEL||'gpt-5',instructions,input,tools,tool_choice:'auto',store:false,max_output_tokens:maxOutputTokens,max_tool_calls:maxToolCalls};
  const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
  if(!res.ok){const t=(await res.text().catch(()=>'' )).slice(0,400);throw new Error('OpenAI API error '+res.status+': '+t);}
  return res.json();
}
function remoteMcp(readOnly=false){
  const token=mcpToken();if(!token)throw new Error('authentication_error: ROBINHOOD_MCP_OAUTH_TOKEN is not set');
  const readTools=['get_accounts','get_portfolio','get_equity_positions','get_equity_orders','get_equity_quotes','get_option_positions','get_option_orders','get_option_instruments','get_option_quotes','get_advanced_orders'];
  const liveTools=[...readTools,'place_equity_order','cancel_equity_order','place_option_order','cancel_option_order'];
  return{type:'mcp',server_label:config().server_label||'robinhood-trading',server_url:mcpUrl(),authorization:token,allowed_tools:{tool_names:readOnly?readTools:liveTools},require_approval:readOnly?'never':'always'};
}
function instructions(){return INSTRUCTION_FILES.map(f=>'===== '+f+' =====\n'+(readIfExists(f)||'MISSING')).join('\n\n');}
function packets(){
  const out={};for(const f of DATA_FILES){const v=readIfExists(f);out[f]=v?JSON.parse(v):{missing:true};}return out;
}
function emitSuccess(x){process.stdout.write(JSON.stringify({is_error:false,...x})+'\n');}
function emitFailure(msg){process.stdout.write(JSON.stringify({is_error:true,error:msg})+'\n');process.stderr.write(msg+'\n');process.exitCode=1;}

async function runProbe(){
  const r=await callResponses({instructions:'Connectivity probe only.',input:'Reply READY only.',tools:[],maxOutputTokens:256,timeoutMs:60000,maxToolCalls:1});
  emitSuccess({mode:'probe',result:extractText(r)||'READY',model:r.model});
}
async function runMcpProbe(){
  const r=await callResponses({
    instructions:'Read-only Robinhood connectivity probe. Never modify broker state.',
    input:'Fetch account visibility, current positions and open orders using read-only tools only. Return a concise result.',
    tools:[remoteMcp(true)],maxOutputTokens:1200
  });
  emitSuccess({mode:'mcp-probe',result:extractText(r),mcp_calls:mcpCallNames(r),model:r.model});
}
async function runPaper(){
  const dispatch=readJson('docs/data/execution-dispatch.json')||{};
  const selected=selectAction(dispatch);
  emitSuccess(selected?{mode:'paper',result:'PAPER_ACTION_READY',broker_write:false,fingerprint:selected.fingerprint,ref_id:refId(selected.fingerprint),action:selected.action}:{mode:'paper',result:'NO_ACTION',broker_write:false});
}
async function runLive(){
  if(process.env.TESTSTOCK_LIVE_TRADING!==LIVE_SENTINEL)throw new Error('live trading locked: set TESTSTOCK_LIVE_TRADING='+LIVE_SENTINEL+' yourself; repository defaults never enable it');
  const dispatch=readJson('docs/data/execution-dispatch.json')||{};
  const selected=selectAction(dispatch);
  if(!selected)return emitSuccess({mode:'live',result:'NO_ACTION',broker_write:false});
  const id=refId(selected.fingerprint),claimFile=claim(selected,id);
  if(!claimFile)return emitSuccess({mode:'live',result:'NO_ACTION_ALREADY_CLAIMED',broker_write:false,fingerprint:selected.fingerprint});
  const input=[
    'This invocation has exactly one atomically preclaimed action. Act only on it.',
    'Preclaimed fingerprint: '+selected.fingerprint,
    'Required ref_id for any new order: '+id,
    'Do not submit an independent order for another candidate in this invocation.',
    'If any evidence, freshness, admission, account, liquidity, risk, protection, or broker gate fails, return NO_ACTION.',
    'Never use margin, transfers, deposits, withdrawals, option exercise, naked selling, averaging down, or wider stops.',
    'PRECLAIMED ACTION:',
    JSON.stringify(selected.action,null,2),
    'CURRENT PACKETS:',
    JSON.stringify(packets())
  ].join('\n');
  let r;
  try{r=await callResponses({instructions:instructions(),input,tools:[remoteMcp(false)]});}
  catch(e){throw new Error('live executor failed after claim; claim retained for broker reconciliation: '+e.message);}
  if(r.status&&r.status!=='completed')throw new Error('live executor incomplete after claim; claim retained for broker reconciliation: '+r.status);
  const text=extractText(r),calls=mcpCallNames(r);
  const writeAttempt=calls.some(n=>/^place_|^cancel_|^replace_/.test(n));
  if(!writeAttempt&&/\bNO_ACTION\b/i.test(text))releaseClaim(claimFile);
  emitSuccess({mode:'live',result:text||'COMPLETED',mcp_calls:calls,broker_write_attempted:writeAttempt,fingerprint:selected.fingerprint,ref_id:id,claim_retained:writeAttempt||!/\bNO_ACTION\b/i.test(text),model:r.model,usage:r.usage||null});
}

try{
  if(process.argv.includes('--probe'))await runProbe();
  else if(process.argv.includes('--mcp-probe'))await runMcpProbe();
  else if(executionMode()==='paper')await runPaper();
  else await runLive();
}catch(e){emitFailure(String(e?.message||e));}
