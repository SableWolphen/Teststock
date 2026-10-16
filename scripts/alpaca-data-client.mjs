import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {vault} from './robinhood-oauth.mjs';

export const DATA_READS=Object.freeze({
 clock:'https://paper-api.alpaca.markets/v2/clock',
 calendar:'https://paper-api.alpaca.markets/v2/calendar',
 bars:'https://data.alpaca.markets/v2/stocks/bars',
 quotes:'https://data.alpaca.markets/v2/stocks/quotes/latest',
});
export const alpacaVault=root=>vault(root,{filename:'alpaca-data.dpapi'});
export function validateCredentials(value) {
 if(value?.environment!=='paper'||typeof value.key!=='string'||typeof value.secret!=='string'||![value.key,value.secret].every(s=>s.length>=8&&s.length<=1024&&!/[\s\r\n]/.test(s))) throw Error('ALPACA_INVALID_CREDENTIALS');
 return value;
}
export class AlpacaDataReader {
 constructor({credentials,transport=fetch}) {this.credentials=validateCredentials(credentials);this.transport=transport;}
 async read(name,parameters={}) {
  if(!Object.hasOwn(DATA_READS,name)) throw Error('ALPACA_READ_ONLY_DENIED');
  const allowed=name==='clock'?[]:name==='calendar'?['start','end']:name==='quotes'?['symbols','feed']:['symbols','timeframe','start','end','limit','feed','page_token','adjustment','sort'];
  if(Object.keys(parameters).some(k=>!allowed.includes(k))) throw Error('ALPACA_INVALID_QUERY');
  if(['bars','quotes'].includes(name)&&parameters.feed!=='iex') throw Error('ALPACA_IEX_REQUIRED');
  const url=new URL(DATA_READS[name]);for(const [key,value] of Object.entries(parameters))url.searchParams.set(key,String(value));
  const response=await this.transport(url.href,{method:'GET',headers:{'APCA-API-KEY-ID':this.credentials.key,'APCA-API-SECRET-KEY':this.credentials.secret,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw Error(`ALPACA_HTTP_${response.status}`);
  return response.json();
 }
 async probe({now=Date.now()}={}) {
  const clock=await this.read('clock');
  if(typeof clock.is_open!=='boolean'||!Number.isFinite(Date.parse(clock.timestamp))||Math.abs(now-Date.parse(clock.timestamp))>60000||!Number.isFinite(Date.parse(clock.next_open))) throw Error('ALPACA_INVALID_CLOCK');
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const calendar=await this.read('calendar',{start:date,end:date});
  if(!Array.isArray(calendar)||calendar.some(s=>s.date!==date||!/^\d{2}:\d{2}/.test(s.open)||!/^\d{2}:\d{2}/.test(s.close))) throw Error('ALPACA_INVALID_CALENDAR');
  const data=await this.read('bars',{symbols:'SPY',timeframe:'1Day',feed:'iex',limit:10,sort:'desc',start:new Date(now-14*86400000).toISOString(),end:new Date(now).toISOString()});
  const bars=data.bars?.SPY;
  if(!Array.isArray(bars)||!bars.length||bars.some(b=>!Number.isFinite(Date.parse(b.t))||Number(b.c)<=0||!Number.isFinite(Number(b.c)))) throw Error('ALPACA_INVALID_BARS');
  return {verifiedAt:new Date().toISOString(),environment:'paper-data-only',feed:'iex',connected:true,clockVerified:true,calendarVerified:true,historicalBarsVerified:true,marketOpen:clock.is_open,nextOpen:clock.next_open,tradingReady:false,liveEnabled:false};
 }
}
export async function probeStoredAlpaca(root) {
 const store=alpacaVault(root);
 if(!store.exists()) return {connected:false,tradingReady:false,blockers:['ALPACA_NOT_CONFIGURED']};
 try {return await new AlpacaDataReader({credentials:store.load()}).probe();}
 catch(error) {return {connected:false,tradingReady:false,blockers:[/^ALPACA_[A-Z_0-9]+$/.test(error.message)?error.message:'ALPACA_READ_FAILED']};}
}
function html(token) {return `<!doctype html><html><head><meta charset="utf-8"><title>Connect Alpaca data</title></head><body><h1>Connect Alpaca paper data</h1><p>Sign in at app.alpaca.markets, choose Paper Trading, and use that account's API key and secret. This form saves them encrypted for the current Windows user. Teststock's local client only reads clock, calendar and IEX bars. No orders will be placed.</p><form method="post" action="/configure/${token}" autocomplete="off"><label>Paper API key <input name="key" type="password" required maxlength="1024" autocomplete="off"></label><br><label>Paper API secret <input name="secret" type="password" required maxlength="1024" autocomplete="off"></label><p><button>Verify data reads and save encrypted</button></p></form></body></html>`;}
export async function startAlpacaSetup(root,{onReady,transport=fetch,store=alpacaVault(root),timeoutMs=900000}={}) {
 if(!path.isAbsolute(root)||!fs.existsSync(path.join(root,'installation.json'))) throw Error('ALPACA_INSTALL_MONITOR_FIRST');
 const token=crypto.randomBytes(32).toString('base64url');let origin;let saved=false;let busy=false;let settle;
 const completed=new Promise(resolve=>{settle=resolve;});
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const validHost=req.headers.host===new URL(origin).host;
  if(!validHost) {res.writeHead(403);res.end();return;}
  if(req.method==='GET'&&req.url===`/setup/${token}`) {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html(token));return;}
  if(req.method!=='POST'||req.url!==`/configure/${token}`||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')||saved||busy) {res.writeHead(403);res.end();return;}
  busy=true;
  try {
   let body='';for await(const chunk of req) {body+=chunk.toString();if(Buffer.byteLength(body)>8192) throw Error('ALPACA_INPUT_TOO_LARGE');}
   const form=new URLSearchParams(body);
   if(form.getAll('key').length!==1||form.getAll('secret').length!==1||[...form.keys()].some(k=>!['key','secret'].includes(k))) throw Error('ALPACA_INVALID_FORM');
   const credentials=validateCredentials({environment:'paper',key:form.get('key')?.trim(),secret:form.get('secret')?.trim()});
   const verified=await new AlpacaDataReader({credentials,transport}).probe();
   store.save(credentials);saved=true;
   res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('Alpaca paper data verified. Credentials saved with Windows encryption. Live trading remains disabled. You may close this tab.',()=>settle(verified));
  } catch {res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end('Could not verify paper credentials/data access. Return to the setup URL and retry with paper-account keys. No credentials were saved.');}
  finally {busy=false;}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin=`http://127.0.0.1:${server.address().port}`;
 server.requestTimeout=45000;server.headersTimeout=10000;
 let timer;
 try {
  await onReady?.(`${origin}/setup/${token}`);
  return await Promise.race([completed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ALPACA_SETUP_TIMEOUT')),timeoutMs);})]);
 } finally {clearTimeout(timer);server.close();server.closeAllConnections();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const index=process.argv.indexOf('--state-dir'),root=process.argv[index+1];
 if(index<0||!root||!path.isAbsolute(root)) {process.stderr.write('Absolute --state-dir required\n');process.exitCode=1;}
 else if(process.argv.includes('--probe')) probeStoredAlpaca(root).then(result=>{process.stdout.write(JSON.stringify(result)+'\n');if(!result.connected)process.exitCode=2;});
 else startAlpacaSetup(root,{onReady:url=>process.stdout.write(JSON.stringify({event:'ALPACA_SETUP_REQUIRED',url,liveEnabled:false})+'\n')}).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('ALPACA_SETUP_INCOMPLETE\n');process.exitCode=1;});
}
