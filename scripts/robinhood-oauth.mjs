import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const RESOURCE='https://agent.robinhood.com/mcp/trading';
const METADATA='https://agent.robinhood.com/.well-known/oauth-authorization-server';
const ENDPOINTS={issuer:RESOURCE,authorization_endpoint:'https://robinhood.com/oauth',token_endpoint:'https://api.robinhood.com/oauth2/token/',registration_endpoint:'https://agent.robinhood.com/oauth/trading/register'};
export function validateMetadata(metadata) {
  for(const [key,value] of Object.entries(ENDPOINTS)) if(metadata[key]!==value) throw new Error('OAUTH_METADATA_CHANGED');
  if(!metadata.code_challenge_methods_supported?.includes('S256')||!metadata.token_endpoint_auth_methods_supported?.includes('none')||!metadata.scopes_supported?.includes('internal')) throw new Error('OAUTH_UNSUPPORTED');
  return metadata;
}
async function jsonRequest(url,options={},transport=fetch) {
  const response=await transport(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`OAUTH_HTTP_${response.status}`);
  return response.json();
}
export async function discover(transport=fetch) { return validateMetadata(await jsonRequest(METADATA,{},transport)); }
function dpapi(value,decrypt=false) {
  if(process.platform!=='win32') throw new Error('WINDOWS_VAULT_REQUIRED');
  // Fixed scripts; secrets travel only over private process pipes, never command arguments.
  const prefix = "$ErrorActionPreference='Stop'; [void][Reflection.Assembly]::LoadWithPartialName('System.Security'); $v=[Console]::In.ReadToEnd(); ";
  const code=prefix+(decrypt ? "[Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))" : "[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))");
  const exe=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  try { return execFileSync(exe,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{input:value,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:15000}).trim(); }
  catch { throw new Error('WINDOWS_VAULT_FAILED'); }
}
export function vault(root,{protect=v=>dpapi(v),unprotect=v=>dpapi(v,true),filename='robinhood-oauth.dpapi'}={}) {
  if(!['robinhood-oauth.dpapi','alpaca-data.dpapi'].includes(filename)) throw new Error('INVALID_VAULT_NAME');
  const file=path.join(root,filename);
  return {
    exists:()=>fs.existsSync(file),
    load:()=>JSON.parse(unprotect(fs.readFileSync(file,'utf8'))),
    save(value) {
      fs.mkdirSync(root,{recursive:true});
      const temp=file+'.'+crypto.randomUUID()+'.tmp';
      const fd=fs.openSync(temp,'wx',0o600);
      try { fs.writeFileSync(fd,protect(JSON.stringify(value))); fs.fsyncSync(fd); } finally {fs.closeSync(fd);}
      fs.renameSync(temp,file);
    }
  };
}
export function mergeTokens(response,previous,now=Date.now()) {
  if(typeof response.access_token!=='string'||!response.access_token||String(response.token_type).toLowerCase()!=='bearer'||!Number.isFinite(Number(response.expires_in))||Number(response.expires_in)<=0) throw new Error('OAUTH_INVALID_TOKEN_RESPONSE');
  return {...previous,access_token:response.access_token,refresh_token:response.refresh_token||previous.refresh_token,expires_at:now+Number(response.expires_in)*1000};
}
export async function accessToken(store,{transport=fetch,now=Date.now(),forceRefresh=false}={}) {
  const current=store.load();
  if(typeof current.access_token!=='string'||!Number.isFinite(current.expires_at)||typeof current.client_id!=='string') throw new Error('OAUTH_INVALID_VAULT');
  if(!forceRefresh&&current.expires_at>now+60000) return current.access_token;
  if(!current.refresh_token) throw new Error('OAUTH_SIGN_IN_REQUIRED');
  await discover(transport);
  const response=await jsonRequest(ENDPOINTS.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:current.refresh_token,client_id:current.client_id,resource:RESOURCE})},transport);
  const next=mergeTokens(response,current,now);store.save(next);return next.access_token;
}
export function validateCallback(url,{state,redirectUri}) {
  const expected=new URL(redirectUri);
  if(url.origin!==expected.origin||url.pathname!==expected.pathname) throw new Error('OAUTH_INVALID_CALLBACK');
  if(url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==state) throw new Error('OAUTH_STATE_MISMATCH');
  if(url.searchParams.has('error')) throw new Error('OAUTH_CONSENT_DENIED');
  if(url.searchParams.has('iss')&&url.searchParams.get('iss')!==RESOURCE) throw new Error('OAUTH_ISSUER_MISMATCH');
  const code=url.searchParams.get('code');
  if(!code||url.searchParams.getAll('code').length!==1) throw new Error('OAUTH_MISSING_CODE');
  return code;
}
export async function connect(root) {
  const metadata=await discover();
  const state=crypto.randomBytes(32).toString('base64url');
  const verifier=crypto.randomBytes(48).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  let finish;
  const callback=new Promise(resolve=>{finish=resolve;});
  let redirectUri;
  let accepted=false;
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer');
    if(req.method!=='GET') {res.writeHead(405);res.end();return;}
    let code;
    try {
      const host=new URL(redirectUri).host;
      if(req.headers.host!==host) throw new Error('HOST');
      code=validateCallback(new URL(req.url,redirectUri),{state,redirectUri});
    } catch {res.writeHead(400);res.end('Authorization callback rejected. Retry sign-in from Teststock.');return;}
    if(accepted) {res.writeHead(409);res.end();return;}
    accepted=true;res.writeHead(200,{'Content-Type':'text/plain'});res.end('Robinhood sign-in received. You can close this tab. Teststock remains read-only.');finish(code);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  redirectUri=`http://127.0.0.1:${server.address().port}/callback`;
  let timer;
  try {
    const registration=await jsonRequest(metadata.registration_endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Teststock Read-only Monitor',redirect_uris:[redirectUri],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});
    if(typeof registration.client_id!=='string'||!registration.client_id||registration.client_secret) throw new Error('OAUTH_UNSUPPORTED_CLIENT');
    const auth=new URL(metadata.authorization_endpoint);
    auth.search=new URLSearchParams({client_id:registration.client_id,response_type:'code',redirect_uri:redirectUri,scope:'internal',state,code_challenge:challenge,code_challenge_method:'S256',resource:RESOURCE}).toString();
    process.stdout.write(JSON.stringify({event:'SIGN_IN_REQUIRED',url:auth.href,expiresInSeconds:600,localMode:'read-only',providerScope:'internal'})+'\n');
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('OAUTH_SIGN_IN_TIMEOUT')),600000);});
    const code=await Promise.race([callback,timeout]);
    const response=await jsonRequest(metadata.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,code,redirect_uri:redirectUri,code_verifier:verifier,resource:RESOURCE})});
    const tokens=mergeTokens(response,{client_id:registration.client_id});
    vault(root).save(tokens);
    process.stdout.write(JSON.stringify({event:'AUTHENTICATION_SAVED',encrypted:true,refreshAvailable:Boolean(tokens.refresh_token),liveEnabled:false})+'\n');
  } finally {clearTimeout(timer);server.close();server.closeAllConnections();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const index=process.argv.indexOf('--state-dir');const root=process.argv[index+1];
  if(index<0||!root||!path.isAbsolute(root)) {process.stderr.write('Absolute --state-dir required\n');process.exitCode=1;}
  else connect(root).catch(error=>{process.stderr.write(/^OAUTH_[A-Z_0-9]+$/.test(error.message)?error.message+'\n':'OAUTH_CONNECTION_FAILED\n');process.exitCode=1;});
}
