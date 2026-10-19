import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ReadOnlyMcp,quoteGuard,claimIntent,cycle} from './windows-monitor.mjs';
const now=Date.parse('2026-10-16T15:00:00Z');
const quote={symbol:'SPY',venue_bid_time:new Date(now).toISOString(),venue_ask_time:new Date(now).toISOString(),has_traded:true,state:'active',bid_price:'100',ask_price:'101'};
function temp(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'teststock-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('fresh market validates; stale, future, crossed and missing quotes fail closed',()=>{
 assert.equal(quoteGuard(quote,now),null);
 for(const q of [undefined,{...quote,venue_bid_time:'bad'},{...quote,venue_bid_time:new Date(now-30001).toISOString()},{...quote,venue_bid_time:new Date(now+3000).toISOString()},{...quote,bid_price:102},{...quote,bid_price:0},{...quote,ask_price:120}]) assert.ok(quoteGuard(q,now));
});
test('read-only boundary rejects arbitrary and write tools before transport',async()=>{
 const client=new ReadOnlyMcp({transport:()=>{throw Error('transport must not run');}});
 for(const name of ['place_equity_order','cancel_option_order','tools/call','transfer_funds']) await assert.rejects(client.call(name),/READ_ONLY_TOOL_DENIED/);
});
test('MCP initialization, notification and allowlisted tool use expected protocol',async()=>{
 const requests=[];
 const client=new ReadOnlyMcp({token:'private-token',transport:async(url,options)=>{
  assert.equal(url,'https://agent.robinhood.com/mcp/trading');
  const request=JSON.parse(options.body);requests.push(request);
  if(request.method==='notifications/initialized') return new Response(null,{status:202});
  return Response.json({jsonrpc:'2.0',id:request.id,result:request.method==='initialize'?{protocolVersion:'2025-03-26'}:{content:[]}});
 }});
 await client.connect();await client.call('get_accounts');assert.equal(requests.length,3);
});
test('SSE responses work without waiting for server close',async()=>{
 const client=new ReadOnlyMcp({transport:async()=>new Response('data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n',{headers:{'content-type':'text/event-stream'}})});
 assert.deepEqual(await client.call('get_accounts'),{ok:true});
});

test('overlapping MCP reads match each response to its own request id',async()=>{
 const client=new ReadOnlyMcp({transport:async(url,options)=>{
  const request=JSON.parse(options.body);
  await new Promise(resolve=>setTimeout(resolve,request.id===1?15:1));
  return Response.json({jsonrpc:'2.0',id:request.id,result:{name:request.params.name}});
 }});
 const results=await Promise.all([client.call('get_accounts'),client.call('get_equity_positions')]);
 assert.deepEqual(results,[{name:'get_accounts'},{name:'get_equity_positions'}]);
});

test('malformed JSON-RPC and oversized unfinished SSE frames fail closed',async()=>{
 const invalid=new ReadOnlyMcp({transport:async()=>Response.json({id:1,result:{}})});
 await assert.rejects(invalid.call('get_accounts'),/MCP_PROTOCOL_ERROR/);
 const oversized=new ReadOnlyMcp({transport:async()=>new Response('data: '+'x'.repeat(1024*1024),{headers:{'content-type':'text/event-stream'}})});
 await assert.rejects(oversized.call('get_accounts'),/MCP_RESPONSE_TOO_LARGE/);
});
test('intent deduplication survives restart and concurrent processes',t=>{
 const root=temp(t);const id=claimIntent(root,'same');assert.ok(id);assert.equal(claimIntent(root,'same'),null);
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {claimIntent} from './scripts/windows-monitor.mjs'; console.log(claimIntent(process.argv[1],'same'));`,root],{encoding:'utf8'});
 assert.equal(child.status,0);assert.equal(child.stdout.trim(),'null');
 assert.throws(()=>claimIntent(root,''),/INVALID_FINGERPRINT/);
});
test('missing authentication creates durable blocked status',async t=>{
 const root=temp(t);const status=await cycle({root,now});assert.equal(status.health,'BLOCKED');
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'status.json'))).liveEnabled,false);
 assert.equal(fs.readFileSync(path.join(root,'monitor-2026-10-16.jsonl'),'utf8').trim().split('\n').length,1);
});
test('healthy mocked reads and stale quotes are distinguished',async t=>{
 const root=temp(t);const client={version:'mock',call:async(name)=>({structuredContent:{data:name==='get_accounts'?{accounts:[{account_number:'test-account',agentic_allowed:true,state:'active'}]}:name==='get_equity_quotes'?{results:[{quote}]}:name.includes('positions')?{positions:[]}:{orders:[]}}})};
 assert.equal((await cycle({root,client,symbols:['SPY'],now})).health,'READ_ONLY_HEALTHY');
 assert.equal((await cycle({root,client,symbols:['SPY'],now:now+60000})).health,'BLOCKED');
});
test('upstream credential text never enters logs',async t=>{
 const root=temp(t);await cycle({root,now,client:{version:'mock',call:async()=>{throw Error('secret-account-token');}}});
 assert.doesNotMatch(fs.readFileSync(path.join(root,'status.json'),'utf8'),/secret-account-token/);
});

test('read health stays separate from option protection and private holdings never enter status',async t=>{
 const root=temp(t),option={option_id:'private-contract',chain_symbol:'PRIVATEHOLDING',quantity:'1',type:'long',expiration_date:'2030-10-16',pending_assignment_quantity:'0',pending_exercise_quantity:'0',pending_expiration_quantity:'0',pending_buy_quantity:'0',pending_sell_quantity:'0'};
 const client={version:'mock',call:async(name)=>({structuredContent:{data:name==='get_accounts'?{accounts:[{account_number:'test-account',agentic_allowed:true,state:'active'}]}:name==='get_equity_quotes'?{results:[{quote:{...quote,venue_bid_time:new Date().toISOString(),venue_ask_time:new Date().toISOString()}}]}:name==='get_option_positions'?{positions:[option]}:name.includes('positions')?{positions:[]}:{orders:[]}}})};
 const status=await cycle({root,client,symbols:['SPY']});
 assert.equal(status.health,'READ_ONLY_HEALTHY');assert.equal(status.protection.currentReadVerified,true);assert.equal(status.protection.holdingCount,1);assert.equal(status.protection.matchedStopCount,0);
 assert.ok(status.protection.blockers.includes('HOLDING_PROTECTION_UNVERIFIED'));assert.equal(status.tradingReady,false);
 assert.doesNotMatch(JSON.stringify(status),/private-contract|PRIVATEHOLDING/);
 assert.ok(Date.parse(status.at)>=Date.parse(status.cycleStartedAt));
});
test('legacy live switches cannot submit orders',()=>{
 const child=spawnSync(process.execPath,['scripts/chatgpt-executor.mjs'],{encoding:'utf8',env:{...process.env,TESTSTOCK_EXECUTION_MODE:'live',TESTSTOCK_LIVE_TRADING:'I_UNDERSTAND_REAL_ORDERS'}});
 assert.equal(child.status,1);assert.match(child.stdout,/LIVE_DISABLED/);
});
test('one-shot monitor exits blocked without auth, removes its lock, and honors STOP',t=>{
 const root=temp(t);const env={...process.env,TESTSTOCK_RUNTIME_STATE_DIR:root,ROBINHOOD_MCP_OAUTH_TOKEN:''};
 const first=spawnSync(process.execPath,['scripts/windows-monitor.mjs','--once'],{env,encoding:'utf8'});
 assert.equal(first.status,2);assert.equal(fs.existsSync(path.join(root,'monitor.lock')),false);
 fs.writeFileSync(path.join(root,'STOP'),'');
 assert.equal(spawnSync(process.execPath,['scripts/windows-monitor.mjs','--once'],{env}).status,0);
});

