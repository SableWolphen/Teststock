import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {vault, accessToken} from './robinhood-oauth.mjs';
import {collectReadOnlySnapshot} from './monitor-reconciliation.mjs';
import {probeStoredAlpaca} from './alpaca-data-client.mjs';
import {acquireMonitorLock} from './monitor-lock.mjs';
import {selectStockQuotes,readAlpacaQuotes} from './stock-quote-fallback.mjs';

export const READ_TOOLS = Object.freeze(['get_accounts', 'get_equity_quotes', 'get_equity_positions', 'get_option_positions', 'get_equity_orders', 'get_option_orders', 'get_crypto_positions', 'get_crypto_orders']);
export class ReadOnlyMcp {
  constructor({token, tokenProvider, transport=fetch}) { this.token=token; this.tokenProvider=tokenProvider; this.transport=transport; this.id=0; }
  async rpc(method, params) {
    if(!['initialize','notifications/initialized','tools/list','tools/call'].includes(method)||
       (method==='tools/call'&&!READ_TOOLS.includes(params?.name))) throw new Error('READ_ONLY_TOOL_DENIED');
    const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
    const token=this.tokenProvider?await this.tokenProvider():this.token;
    if(token) headers.Authorization=`Bearer ${token}`;
    if(this.session) headers['Mcp-Session-Id']=this.session;
    if(this.version) headers['MCP-Protocol-Version']=this.version;
    const response=await this.transport('https://agent.robinhood.com/mcp/trading',{
      method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(method.startsWith('notifications/')?{}:{id:++this.id}),method,params}),signal:AbortSignal.timeout(20000),redirect:'error'
    });
    if(!response.ok) throw new Error(`MCP_HTTP_${response.status}`);
    this.session=response.headers.get('mcp-session-id')||this.session;
    if(response.status===202) return;
    // Consume one JSON-RPC result; streaming connections need not close first.
    let message;
    if(response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer='';
      try { while(!message) {
        const {value,done}=await reader.read(); if(done) break;
        buffer+=decoder.decode(value,{stream:true}); buffer=buffer.replace(/\r\n/g,'\n');
        let end;
        while((end=buffer.indexOf('\n\n'))>=0) {
          const frame=buffer.slice(0,end); buffer=buffer.slice(end+2);
          const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
          if(data) { const candidate=JSON.parse(data); if(candidate.id===this.id) message=candidate; }
        }
      }} finally { await reader.cancel(); }
    } else message=await response.json();
    if(!message||message.id!==this.id||message.error) throw new Error('MCP_PROTOCOL_ERROR');
    return message.result;
  }
  async connect() {
    const result=await this.rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'teststock-readonly',version:'1.0.0'}});
    this.version=result.protocolVersion;
    await this.rpc('notifications/initialized',{});
  }
  async call(name,args={}) {
    if(!READ_TOOLS.includes(name)) throw new Error('READ_ONLY_TOOL_DENIED');
    const result=await this.rpc('tools/call',{name,arguments:args});
    if(result?.isError) throw new Error('MCP_TOOL_ERROR');
    return result;
  }
}

export function quoteGuard(quote, now=Date.now(), maxAgeMs=30000) {
  const bidTime=Date.parse(quote?.venue_bid_time); const askTime=Date.parse(quote?.venue_ask_time);
  if(!Number.isFinite(bidTime)||!Number.isFinite(askTime)||bidTime>now+2000||askTime>now+2000) return 'STALE_OR_INVALID_QUOTE';
  const time=Math.min(bidTime,askTime); const bid=Number(quote?.bid_price); const ask=Number(quote?.ask_price);
  if(quote?.has_traded!==true||quote?.state!=='active') return 'INACTIVE_MARKET';
  if(!Number.isFinite(time)||now-time>maxAgeMs||time>now+2000) return 'STALE_OR_INVALID_QUOTE';
  if(!Number.isFinite(bid)||!Number.isFinite(ask)||bid<=0||ask<bid) return 'INVALID_MARKET';
  if((ask-bid)/ask>0.10) return 'WIDE_SPREAD';
  return null;
}
export function atomicJson(file,value) {
  const temp=file+'.'+crypto.randomUUID()+'.tmp';
  const fd=fs.openSync(temp,'wx',0o600);
  try { fs.writeFileSync(fd,JSON.stringify(value,null,2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp,file);
}
export function claimIntent(root,fingerprint) {
  if(typeof fingerprint!=='string'||!fingerprint.trim()) throw new Error('INVALID_FINGERPRINT');
  fs.mkdirSync(path.join(root,'claims'),{recursive:true});
  const digest=crypto.createHash('sha256').update(fingerprint).digest('hex');
  const file=path.join(root,'claims',digest+'.json');
  let fd; try { fd=fs.openSync(file,'wx',0o600); } catch(e) { if(e.code==='EEXIST') return null; throw e; }
  try { fs.writeFileSync(fd,JSON.stringify({fingerprint,clientOrderId:digest,state:'OBSERVED_ONLY',at:new Date().toISOString()})); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return digest;
}
function unpack(result) {
  if(result?.structuredContent) return result.structuredContent;
  for(const part of result?.content||[]) if(part.type==='text') { try { return JSON.parse(part.text); } catch {} }
  throw new Error('UNSUPPORTED_MCP_SCHEMA');
}
export async function cycle({root,client,symbols=[],now,fallbackReader=readAlpacaQuotes}) {
  const at=new Date(now??Date.now()).toISOString();
  const status={at,mode:'read-only',liveEnabled:false,brokerConnected:false,quoteCount:0,blockers:[]};
  let primaryQuotes=[];
  if(!client) status.blockers.push('AUTHENTICATION_NOT_CONFIGURED');
  else {
    try {
      if(!client.version) await client.connect();
      await client.call('get_accounts');
      status.brokerConnected=true;
      let previous;
      try { previous=JSON.parse(fs.readFileSync(path.join(root,'broker-reconciliation.json'),'utf8')); }
      catch(error) { if(error.code!=='ENOENT') throw error; }
      const snapshot=await collectReadOnlySnapshot(client,{accountFingerprint:previous?.accountFingerprint});
      fs.mkdirSync(root,{recursive:true});
      atomicJson(path.join(root,'broker-reconciliation.json'),snapshot);
      status.reconciliation={at:snapshot.generatedAt,positionsReadComplete:true,orderHistoryReadComplete:true,allAssetReconciliationComplete:false,positionCount:snapshot.managedPositions.length,orderCount:snapshot.orders.length,fillCount:snapshot.fills.length,workingOrderCount:snapshot.orders.filter(o=>o.working).length,blockers:snapshot.blockers};
      if(!symbols.length) status.blockers.push('NO_SYMBOLS_CONFIGURED');
      else {
        const payload=unpack(await client.call('get_equity_quotes',{symbols}));
        const quotes=(payload.data?.results||payload.results)?.map(row=>row?.quote).filter(Boolean);
        if(!Array.isArray(quotes)) throw new Error('UNSUPPORTED_MCP_SCHEMA');
        primaryQuotes=quotes.filter(q=>!quoteGuard(q,now??Date.now())).map(q=>({symbol:q.symbol,bid:q.bid_price,ask:q.ask_price,bidAt:q.venue_bid_time,askAt:q.venue_ask_time}));
        for(const symbol of symbols) {
          const quote=quotes.find(q=>q.symbol===symbol);
          const reason=quoteGuard(quote,now??Date.now());
          if(reason) status.blockers.push(`${symbol}:${reason}`); else status.quoteCount++;
        }
      }
    } catch(error) {
      status.brokerConnected=false;
      status.reconciliation={positionsReadComplete:false,orderHistoryReadComplete:false,allAssetReconciliationComplete:false};
      // Never persist upstream bodies, credentials, account numbers or exception text.
      status.blockers.push(/^MCP_HTTP_\d+$/.test(error.message)?error.message:'BROKER_READ_FAILED');
    }
  }
  const marketData=await selectStockQuotes({symbols,primary:async()=>primaryQuotes,secondary:needed=>fallbackReader(root,needed),now});
  status.marketData={complete:marketData.complete,quoteCount:marketData.quotes.length,sources:[...new Set(marketData.quotes.map(q=>q.source))],missing:marketData.missing,attempts:marketData.attempts,executionAuthorized:false,scope:'MONITORING_QUOTES_ONLY'};
  // Backup pricing never clears broker authentication/reconciliation/primary-quote blockers.
  status.health=status.blockers.length?'BLOCKED':'READ_ONLY_HEALTHY';
  status.entryData=await probeStoredAlpaca(root);
  status.tradingReady=false;
  fs.mkdirSync(root,{recursive:true});
  const log=path.join(root,`monitor-${at.slice(0,10)}.jsonl`);
  const fd=fs.openSync(log,'a',0o600);
  try { fs.writeSync(fd,JSON.stringify(status)+'\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  atomicJson(path.join(root,'status.json'),status);
  return status;
}
async function main() {
  const stateIndex=process.argv.indexOf('--state-dir');
  const root=stateIndex>=0?process.argv[stateIndex+1]:process.env.TESTSTOCK_RUNTIME_STATE_DIR;
  if(!root||!path.isAbsolute(root)) throw new Error('Set an absolute private TESTSTOCK_RUNTIME_STATE_DIR');
  fs.mkdirSync(root,{recursive:true});
  const lock=path.join(root,'monitor.lock');
  acquireMonitorLock(lock);
  let stopped=false; process.on('SIGINT',()=>{stopped=true;}); process.on('SIGTERM',()=>{stopped=true;});
  let settings={};
  try { settings=JSON.parse(fs.readFileSync(path.join(root,'monitor.json'),'utf8')); }
  catch(error) { if(error.code!=='ENOENT') { fs.unlinkSync(lock); throw error; } }
  const symbols=[...new Set((process.env.TESTSTOCK_MONITOR_SYMBOLS||settings.symbols?.join(',')||'').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean))];
  if(symbols.length>20||symbols.some(s=>! /^[A-Z][A-Z0-9.-]{0,14}$/.test(s))) { fs.unlinkSync(lock); throw new Error('INVALID_SYMBOLS'); }
  const token=process.env.ROBINHOOD_MCP_OAUTH_TOKEN;
  const store=vault(root);
  const client=store.exists()?new ReadOnlyMcp({tokenProvider:()=>accessToken(store)}):token?new ReadOnlyMcp({token}):null;
  try { do {
    if(fs.existsSync(path.join(root,'STOP'))) break;
    const status=await cycle({root,client,symbols});
    process.stdout.write(JSON.stringify(status)+'\n');
    if(process.argv.includes('--once')) { if(status.health==='BLOCKED') process.exitCode=2; break; }
    // Fixed bounded cadence; no LLM cost and no overlapping cycles.
    for(let i=0;i<30&&!stopped;i++) await new Promise(resolve=>setTimeout(resolve,1000));
  } while(!stopped); } finally { fs.unlinkSync(lock); }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(()=>{process.stderr.write('MONITOR_FAILED: inspect private state and configuration\n');process.exitCode=1;});
