import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AlpacaDataReader,startAlpacaSetup,alpacaVault,validateCredentials} from './alpaca-data-client.mjs';
import {vault} from './robinhood-oauth.mjs';
const credentials={environment:'paper',key:'paper-key-fixture',secret:'paper-secret-fixture'};
const now=Date.parse('2026-10-16T13:00:00Z');
const transport=async url=>{
 const u=new URL(url);
 if(u.pathname.endsWith('/clock')) return Response.json({timestamp:new Date(now).toISOString(),is_open:false,next_open:'2026-10-16T13:30:00Z'});
 if(u.pathname.endsWith('/calendar')) return Response.json([{date:'2026-10-16',open:'09:30',close:'16:00'}]);
 return Response.json({bars:{SPY:[{t:'2026-10-15T04:00:00Z',c:100}]}});
};
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpaca-safe-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'installation.json'),'{}');return dir;}
test('Alpaca reader allows only fixed GET data routes and explicitly IEX feed',async()=>{
 let count=0;const reader=new AlpacaDataReader({credentials,transport:async(url,options)=>{count++;assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers['APCA-API-SECRET-KEY'],credentials.secret);return transport(url);}});
 for(const name of ['orders','place_order','https://api.alpaca.markets/v2/orders','account','__proto__']) await assert.rejects(reader.read(name),/READ_ONLY_DENIED/);
 assert.equal(count,0);await assert.rejects(reader.read('bars',{feed:'sip'}),/IEX_REQUIRED/);await assert.rejects(reader.read('clock',{redirect:'evil'}),/INVALID_QUERY/);
 const result=await reader.probe({now});assert.equal(result.connected,true);assert.equal(result.liveEnabled,false);assert.equal(count,3);
});
test('live credentials mode, malformed keys, stale clock, authentication and malformed data fail closed',async()=>{
 assert.throws(()=>validateCredentials({...credentials,environment:'live'}),/INVALID_CREDENTIALS/);assert.throws(()=>validateCredentials({...credentials,secret:'bad\nvalue'}),/INVALID_CREDENTIALS/);
 await assert.rejects(new AlpacaDataReader({credentials,transport:async()=>new Response(null,{status:401})}).probe(),/HTTP_401/);
 await assert.rejects(new AlpacaDataReader({credentials,transport}).probe({now:now+120000}),/INVALID_CLOCK/);
 await assert.rejects(new AlpacaDataReader({credentials,transport:async url=>url.includes('/bars')?Response.json({bars:{SPY:[]}}):transport(url)}).probe({now}),/INVALID_BARS/);
});
test('separate Windows vaults never overwrite each other and reject arbitrary filenames',{skip:process.platform!=='win32'},t=>{
 const root=temp(t);vault(root).save({test:'synthetic-robinhood'});alpacaVault(root).save(credentials);assert.deepEqual(alpacaVault(root).load(),credentials);assert.deepEqual(vault(root).load(),{test:'synthetic-robinhood'});assert.doesNotMatch(fs.readFileSync(path.join(root,'alpaca-data.dpapi'),'utf8'),/paper-secret/);assert.throws(()=>vault(root,{filename:'../escape'}),/INVALID_VAULT_NAME/);
});
test('local setup rejects cross-origin submissions and saves only after all read checks pass',async t=>{
 const root=temp(t);let resolveUrl;const ready=new Promise(resolve=>{resolveUrl=resolve;});let saved;let reads=0;
 const currentTransport=async url=>{reads++;const u=new URL(url);if(u.pathname.endsWith('/clock')) return Response.json({timestamp:new Date().toISOString(),is_open:false,next_open:'2026-10-16T13:30:00Z'});if(u.pathname.endsWith('/calendar'))return Response.json([{date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),open:'09:30',close:'16:00'}]);return Response.json({bars:{SPY:[{t:new Date().toISOString(),c:100}]}});};
 let rejectAuthentication=true;
 const pending=startAlpacaSetup(root,{timeoutMs:5000,onReady:resolveUrl,transport:async url=>rejectAuthentication?new Response('private upstream error must never appear',{status:401}):currentTransport(url),store:{save:value=>{saved=value;}}});
 const setupUrl=await ready;const setup=await fetch(setupUrl);assert.equal(setup.status,200);assert.match(setup.headers.get('content-security-policy'),/form-action 'self'/);assert.match(await setup.text(),/type="password"/);
 const postUrl=setupUrl.replace('/setup/','/configure/');const origin=new URL(setupUrl).origin;
 const body=new URLSearchParams({key:credentials.key,secret:credentials.secret});
 const rejected=await fetch(postUrl,{method:'POST',headers:{Origin:'https://evil.example'},body});assert.equal(rejected.status,403);assert.equal(reads,0);assert.equal(saved,undefined);
 const failed=await fetch(postUrl,{method:'POST',headers:{Origin:origin},body});assert.equal(failed.status,200);const feedback=await failed.text();assert.match(feedback,/Connection not saved/);assert.match(feedback,/ALPACA_HTTP_401/);assert.doesNotMatch(feedback,/private upstream|paper-secret/);assert.equal(saved,undefined);
 rejectAuthentication=false;
 const result=await fetch(postUrl,{method:'POST',headers:{Origin:origin},body});assert.equal(result.status,200);assert.equal((await pending).connected,true);assert.deepEqual(saved,credentials);assert.equal(reads,3);
});
import {runAlpacaDataTask} from './run-alpaca-data-task.mjs';
test('credential bridge rejects arbitrary scripts before reading the vault and locks child mode to paper',()=>{
 let accessed=false;const store={load:()=>{accessed=true;return credentials;}};
 assert.throws(()=>runAlpacaDataTask('unused','chatgpt-executor.mjs',{store}),/DATA_TASK_DENIED/);assert.equal(accessed,false);
 let options;assert.equal(runAlpacaDataTask('unused','check-alpaca-market-session.mjs',{store,spawn:(exe,args,opts)=>{options=opts;assert.ok(args[0].endsWith('check-alpaca-market-session.mjs'));return{status:0};}}),0);
 assert.equal(options.env.TESTSTOCK_EXECUTION_MODE,'paper');assert.equal(options.env.TESTSTOCK_LIVE_TRADING,undefined);assert.equal(options.env.APCA_API_BASE_URL,'https://paper-api.alpaca.markets');
});
