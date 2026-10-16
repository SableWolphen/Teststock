import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RESOURCE,validateMetadata,validateCallback,mergeTokens,accessToken,vault} from './robinhood-oauth.mjs';
import {ReadOnlyMcp} from './windows-monitor.mjs';
const metadata={issuer:RESOURCE,authorization_endpoint:'https://robinhood.com/oauth',token_endpoint:'https://api.robinhood.com/oauth2/token/',registration_endpoint:'https://agent.robinhood.com/oauth/trading/register',code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:['internal']};
function temp(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'teststock-auth-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir; }
test('OAuth rejects substituted endpoints and unsupported PKCE',()=>{
 assert.equal(validateMetadata(metadata),metadata);
 assert.throws(()=>validateMetadata({...metadata,token_endpoint:'https://evil.example/token'}),/METADATA_CHANGED/);
 assert.throws(()=>validateMetadata({...metadata,code_challenge_methods_supported:['plain']}),/UNSUPPORTED/);
});
test('callback binds state, loopback origin, exact path, issuer and one code',()=>{
 const args={state:'random-state',redirectUri:'http://127.0.0.1:8123/callback'};
 assert.equal(validateCallback(new URL(args.redirectUri+'?state=random-state&code=okay'),args),'okay');
 for(const suffix of ['?state=wrong&code=x','?state=random-state&error=access_denied','?state=random-state&code=x&code=y','?state=random-state&code=x&iss=https://evil.example','?state=random-state&state=random-state&code=x']) assert.throws(()=>validateCallback(new URL(args.redirectUri+suffix),args));
 assert.throws(()=>validateCallback(new URL('http://localhost:8123/callback?state=random-state&code=x'),args));
});
test('rotating refresh token is saved before returning access token',async()=>{
 const now=100000;let saved;let calls=0;
 const store={load:()=>({client_id:'client',refresh_token:'old-refresh',access_token:'expired',expires_at:999999}),save:v=>{saved=v;}};
 const token=await accessToken(store,{now,forceRefresh:true,transport:async(url,options)=>{
  calls++;
  if(url.includes('.well-known')) return Response.json(metadata);
  assert.equal(options.redirect,'error');assert.equal(options.body.get('refresh_token'),'old-refresh');assert.equal(options.body.get('resource'),RESOURCE);
  return Response.json({token_type:'Bearer',access_token:'fresh',refresh_token:'rotated',expires_in:300});
 }});
 assert.equal(token,'fresh');assert.equal(saved.refresh_token,'rotated');assert.equal(saved.expires_at,400000);assert.equal(calls,2);
});
test('fresh tokens require no refresh; absent refresh and revoked grants fail closed',async()=>{
 assert.equal(await accessToken({load:()=>({client_id:'client',access_token:'valid',expires_at:999999})},{now:0,transport:()=>{throw Error('no request');}}),'valid');
 await assert.rejects(accessToken({load:()=>({client_id:'client',access_token:'expired',expires_at:0})}),/SIGN_IN_REQUIRED/);
 await assert.rejects(accessToken({load:()=>({client_id:'client',access_token:'expired',refresh_token:'r',expires_at:0})},{transport:async url=>url.includes('.well-known')?Response.json(metadata):new Response(null,{status:400})}),/OAUTH_HTTP_400/);
 assert.throws(()=>mergeTokens({access_token:'x',token_type:'Bearer',expires_in:0},{}),/INVALID_TOKEN_RESPONSE/);
});
test('per-request token provider cannot expand tool permissions',async()=>{
 let reads=0;const client=new ReadOnlyMcp({tokenProvider:async()=>{reads++;return 'fresh';},transport:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer fresh');return Response.json({id:1,result:{content:[]}});}});
 await assert.rejects(client.call('place_equity_order'),/READ_ONLY_TOOL_DENIED/);assert.equal(reads,0);
 await client.call('get_accounts');assert.equal(reads,1);
});
test('Windows DPAPI round trip encrypts secrets at rest', {skip:process.platform!=='win32'},t=>{
 const root=temp(t);const store=vault(root);const value={access_token:'test-secret-not-a-real-token',refresh_token:'test-refresh'};
 store.save(value);assert.equal(store.exists(),true);assert.doesNotMatch(fs.readFileSync(path.join(root,'robinhood-oauth.dpapi'),'utf8'),/test-secret|test-refresh/);assert.deepEqual(store.load(),value);
});
