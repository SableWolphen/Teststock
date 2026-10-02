import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {reconcileWatchlist,brokerProfile,validateSnapshot} from './broker-state.mjs';

export function unwrapTool(result){
  if(result?.isError)throw new Error('Robinhood read-only tool returned an error');
  if(result?.structuredContent)return result.structuredContent.data||result.structuredContent;
  for(const c of result?.content||[])if(c.type==='text'){try{const d=JSON.parse(c.text);if(d.error)throw new Error('Broker returned error');return d.data||d;}catch(e){if(e.message==='Broker returned error')throw e;}}
  throw new Error('Invalid Robinhood tool response');
}
export async function collectSnapshot(call){
  const data=await call('get_accounts',{});
  if(!Array.isArray(data.accounts))throw new Error('Missing brokerage accounts');
  const eligible=data.accounts.filter(a=>a?.agentic_allowed===true&&a.state==='active'&&!a.deactivated&&!a.permanently_deactivated);
  if(eligible.length!==1)throw new Error('Expected one accessible active Agentic account');
  const account_number=eligible[0].account_number;
  async function positions(name,args){
    const rows=[],seen=new Set();let cursor;
    do{
      const d=await call(name,{account_number,...args,...(cursor?{cursor}:{})});
      if(!Array.isArray(d.positions))throw new Error('Invalid broker position page');
      rows.push(...d.positions.filter(Boolean));cursor=d.next;
      if(cursor){if(seen.has(cursor))throw new Error('Repeated broker position cursor');seen.add(cursor);}
    }while(cursor);
    return rows;
  }
  // Keep this sequential to respect broker limits; no broker writes are exposed.
  const equities=await positions('get_equity_positions',{});
  const options=await positions('get_option_positions',{nonzero:true});
  return validateSnapshot({generatedAt:new Date().toISOString(),complete:true,equities,options});
}
export async function remoteReader({fetchImpl=fetch,env=process.env}={}){
  const config=JSON.parse(await fs.readFile('.openai-mcp.json','utf8'));
  const token=env[config.authorization_env||'ROBINHOOD_MCP_OAUTH_TOKEN'];
  if(!token)throw new Error('authentication_error: ROBINHOOD_MCP_OAUTH_TOKEN is not set');
  const url=env.OPENAI_MCP_SERVER_URL||config.server_url;
  let session,id=0;
  async function rpc(method,params,notification=false){
    const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'};
    if(session)headers['Mcp-Session-Id']=session;
    const request={jsonrpc:'2.0',method,params,...(!notification?{id:++id}:{})};
    const r=await fetchImpl(url,{method:'POST',headers,body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw new Error(`Robinhood MCP read failed: HTTP ${r.status}`);
    session=r.headers.get('mcp-session-id')||session;
    if(notification||r.status===202||r.status===204)return;
    const text=await r.text();let response;
    if(r.headers.get('content-type')?.includes('text/event-stream')){
      for(const event of text.split(/\r?\n\r?\n/)){const lines=event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart());if(!lines.length)continue;const item=JSON.parse(lines.join('\n'));if(item.id===request.id)response=item;}
    }else response=JSON.parse(text);
    if(!response||response.error)throw new Error('Robinhood MCP returned an invalid/error response');
    return response.result;
  }
  await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'teststock-read-only-reconciliation',version:'1.0.0'}});
  await rpc('notifications/initialized',{},true);
  return async(name,args)=>{
    if(!['get_accounts','get_equity_positions','get_option_positions'].includes(name))throw new Error('Read-only reconciliation tool not allowed');
    return unwrapTool(await rpc('tools/call',{name,arguments:args}));
  };
}
export async function reconcile({snapshot=null}={}){
  snapshot=validateSnapshot(snapshot||await collectSnapshot(await remoteReader()));
  const read=async(f,fallback)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
  const watch=await read('docs/data/execution-watchlist.json',{positions:[]});
  const profile=await read('docs/data/managed-position-profile.json',{});
  const outWatch=reconcileWatchlist(watch,snapshot),outProfile=brokerProfile(profile,snapshot);
  const runtime=process.env.TESTSTOCK_RUNTIME_STATE_DIR||path.join(os.homedir(),'.teststock-runtime');
  await fs.mkdir(runtime,{recursive:true,mode:0o700});
  // Runtime snapshots remain private; a checkout reset cannot resurrect sold shares.
  for(const [name,data] of [['broker-position-snapshot.json',snapshot],['execution-watchlist.json',outWatch],['managed-position-profile.json',outProfile]]){
    const file=path.join(runtime,name);await fs.writeFile(file+'.tmp',JSON.stringify(data,null,2),{mode:0o600});await fs.rename(file+'.tmp',file);
  }
  await fs.writeFile('docs/data/execution-watchlist.json',JSON.stringify(outWatch,null,2));
  await fs.writeFile('docs/data/managed-position-profile.json',JSON.stringify(outProfile,null,2));
  console.log(`BROKER_RECONCILIATION_OK equities=${snapshot.equities.length} options=${snapshot.options.length}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await reconcile();
