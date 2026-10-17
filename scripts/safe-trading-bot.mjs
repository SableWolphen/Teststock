// Read-only research. This module deliberately has no broker/order transport.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SAFETY_POLICY} from './safety-policy.mjs';

const positive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const cents = x => Number.isSafeInteger(x) && x >= 0;
const fresh = (t, now, age) => Number.isFinite(Date.parse(t)) && now-Date.parse(t)>=0 && now-Date.parse(t)<=age;
export const UNIVERSE = Object.freeze({stocks:['SPY','QQQ','AAPL','MSFT','NVDA'],crypto:['BTC/USD','ETH/USD','SOL/USD']});

export class ResearchReader {
  constructor({key, secret, transport=fetch}) {
    if (![key,secret].every(x=>typeof x==='string' && x.length>=8 && !/\s/.test(x))) throw Error('DATA_CREDENTIALS_REQUIRED');
    this.headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret}; this.transport=transport;
  }
  async get(lane, {symbol, page_token}={}) {
    const routes={clock:'https://paper-api.alpaca.markets/v2/clock',stocks:'https://data.alpaca.markets/v2/stocks/snapshots',crypto:'https://data.alpaca.markets/v1beta3/crypto/us/snapshots',options:'https://data.alpaca.markets/v1beta1/options/snapshots/'};
    if (!Object.hasOwn(routes,lane)) throw Error('READ_DENIED');
    if (lane==='options' && !UNIVERSE.stocks.includes(symbol)) throw Error('SYMBOL_DENIED');
    const url=new URL(routes[lane]+(lane==='options'?symbol:''));
    if(lane==='stocks') {url.searchParams.set('symbols',UNIVERSE.stocks.join(','));url.searchParams.set('feed','iex');}
    if(lane==='crypto') url.searchParams.set('symbols',UNIVERSE.crypto.join(','));
    if(lane==='options') {url.searchParams.set('feed','indicative');url.searchParams.set('limit','1000');if(page_token)url.searchParams.set('page_token',page_token);}
    // Bounded GET retries only; never log provider bodies, URLs or credentials.
    for(let attempt=0;attempt<3;attempt++) {
      let response;
      try {response=await this.transport(url.href,{method:'GET',headers:this.headers,redirect:'error',signal:AbortSignal.timeout(10000)});}
      catch {if(attempt===2)throw Error('DATA_NETWORK_FAILED');continue;}
      if(response.ok) {try{return await response.json();}catch{throw Error('DATA_INVALID_JSON');}}
      if(![429,500,502,503,504].includes(response.status)||attempt===2) throw Error('DATA_HTTP_FAILED');
      await new Promise(resolve=>setTimeout(resolve,250*2**attempt));
    }
  }
}

export function inspectCandidate(symbol, snapshot, asset, now=Date.now()) {
  const q=snapshot?.latestQuote, prev=snapshot?.prevDailyBar, trade=snapshot?.latestTrade;
  const reasons=[];
  if(!q || !positive(q.bp)||!positive(q.ap)||q.ap<q.bp||!positive(q.bs)||!positive(q.as)) reasons.push('INVALID_QUOTE');
  if(!fresh(q?.t,now,120000)) reasons.push('STALE_QUOTE');
  const spread=q && (q.ap-q.bp)/q.ap;
  if(!Number.isFinite(spread)||spread>(asset==='option'?0.05:0.01)) reasons.push('WIDE_SPREAD');
  let momentum=null;
  if(asset==='option') {
    const match=/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol);
    const expiry=match ? Date.parse(`20${match[2]}-${match[3]}-${match[4]}T21:00:00Z`) : NaN;
    const dte=(expiry-now)/86400000;
    if(!Number.isFinite(dte)||dte<7||dte>90) reasons.push('OPTION_EXPIRY');
    const delta=Math.abs(snapshot?.greeks?.delta);
    if(!positive(delta)||delta<0.2||delta>0.8||!positive(snapshot?.impliedVolatility)||snapshot.impliedVolatility>2) reasons.push('OPTION_GREEKS');
    reasons.push('INDICATIVE_RESEARCH_ONLY');
  } else {
    if(!positive(prev?.c)||!positive(prev?.v)||!positive(trade?.p)||!fresh(trade?.t,now,120000)) reasons.push('MISSING_MOMENTUM_DATA');
    else {momentum=trade.p/prev.c-1;if(momentum<=0||momentum>0.15)reasons.push('MOMENTUM_FILTER');}
  }
  return {symbol,asset,feed:asset==='stock'?'iex':asset==='option'?'indicative':'alpaca-us',researchOnly:true,liveEligible:false,
    status:reasons.some(r=>r!=='INDICATIVE_RESEARCH_ONLY')?'REJECTED':'WATCH',reasons,
    ask:positive(q?.ap)?q.ap:null,spread:Number.isFinite(spread)?spread:null,momentum};
}

// All money is integer cents. Snapshot must be independently reconciled and private.
// Pending buy reservations must include remaining notional and fees, even if cash already excludes them.
export function planSettledCash(candidates, account, now=Date.now()) {
  const blocked=code=>({mode:'RESEARCH_ONLY',liveOrdersEnabled:false,blockers:[code],proposals:[]});
  if(!account||account.source!=='robinhood'||account.reconciled!==true||account.uncertainOrders!==false||!fresh(account.asOf,now,60000))return blocked('ACCOUNT_NOT_VERIFIED');
  const keys=['equityCents','settledCashCents','cashBuyingPowerCents','pendingBuyCommitmentsCents','openRiskCents'];
  if(!keys.every(k=>cents(account[k]))||!account.equityCents||!Array.isArray(account.exposureSymbols)||!account.exposureSymbols.every(s=>typeof s==='string'))return blocked('INVALID_ACCOUNT');
  let cash=Math.max(0,Math.min(account.settledCashCents,account.cashBuyingPowerCents)-account.pendingBuyCommitmentsCents);
  const perTrade=Math.floor(account.equityCents/100);
  let heat=Math.max(0,Math.floor(account.equityCents*0.05)-account.openRiskCents);
  const seen=new Set(account.exposureSymbols), proposals=[];
  for(const c of candidates) {
    if(!['stock','crypto','option'].includes(c.asset)||typeof c.symbol!=='string'||c.status!=='WATCH'||seen.has(c.symbol)||!positive(c.ask))continue;
    // Whole stock/crypto units; long options risk the entire premium, not a synthetic stop.
    const unitCost=Math.ceil(c.ask*100*(c.asset==='option'?100:1)*1.01);
    if(!Number.isSafeInteger(unitCost)||unitCost<=0)continue;
    const unitRisk=c.asset==='option'?unitCost:Math.ceil(unitCost*0.03);
    const quantity=Math.min(Math.floor(cash/unitCost),Math.floor(Math.min(perTrade,heat)/unitRisk));
    if(quantity<=0)continue;
    const costCents=quantity*unitCost,riskCents=quantity*unitRisk;
    cash-=costCents;heat-=riskCents;seen.add(c.symbol);
    proposals.push({symbol:c.symbol,asset:c.asset,quantity,costCents,riskCents,liveEligible:false,requires:'BROKER_CAPABILITY_SECURITY_PROTECTION_AND_ADMISSION_TESTING'});
  }
  return {mode:'RESEARCH_ONLY',liveOrdersEnabled:false,blockers:['LIVE_EXECUTION_LOCKED'],proposals,remainingCashCents:cash};
}

export async function scan(reader,{now=Date.now()}={}) {
  if(SAFETY_POLICY.liveExecutionEnabled!==false)throw Error('SAFETY_LOCK_REQUIRED');
  const report={generatedAt:new Date(now).toISOString(),mode:'RESEARCH_ONLY',liveOrdersEnabled:false,dailyLossLimit:null,candidates:[],lanes:{}};
  let marketOpen=false;
  try {const clock=await reader.get('clock');if(typeof clock.is_open!=='boolean'||!fresh(clock.timestamp,now,60000))throw Error();marketOpen=clock.is_open;report.lanes.session=marketOpen?'OPEN':'CLOSED';}
  catch {report.lanes.session='UNVERIFIED';}
  for(const asset of ['stock','crypto','option']) {
    if(asset!=='crypto'&&!marketOpen) {report.lanes[asset]='SESSION_BLOCKED';continue;}
    try {
      const rows={};
      if(asset==='option') {
        for(const symbol of UNIVERSE.stocks) {
          let token;const tokens=new Set();let complete=false;
          for(let page=0;page<5;page++) {
            const data=await reader.get('options',{symbol,page_token:token});
            if(!data.snapshots||typeof data.snapshots!=='object'||Array.isArray(data.snapshots))throw Error();
            Object.assign(rows,data.snapshots);token=data.next_page_token;
            if(!token){complete=true;break;}if(tokens.has(token))throw Error();tokens.add(token);
          }
          if(!complete)throw Error(); // Never present truncated chains as a complete scan.
        }
      } else {
        const data=await reader.get(asset==='stock'?'stocks':'crypto');
        const snapshots=asset==='stock'?data:data.snapshots;
        for(const symbol of UNIVERSE[asset==='stock'?'stocks':'crypto']) {
          if(!snapshots?.[symbol])throw Error();rows[symbol]=snapshots[symbol];
        }
      }
      report.candidates.push(...Object.entries(rows).map(([s,v])=>inspectCandidate(s,v,asset,now)));
      report.lanes[asset]='COMPLETE';
    } catch {report.lanes[asset]='DATA_UNAVAILABLE_OR_INCOMPLETE';}
  }
  report.candidates.sort((a,b)=>(b.momentum??-1)-(a.momentum??-1)||a.symbol.localeCompare(b.symbol));
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const report=await scan(new ResearchReader({key:process.env.ALPACA_API_KEY,secret:process.env.ALPACA_API_SECRET}));
    const output=path.resolve('work/trading-bot-report.json');await fs.mkdir(path.dirname(output),{recursive:true});
    await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log(JSON.stringify({mode:report.mode,lanes:report.lanes,candidateCount:report.candidates.length}));
    if(Object.values(report.lanes).some(s=>['UNVERIFIED','DATA_UNAVAILABLE_OR_INCOMPLETE'].includes(s)))process.exitCode=2;
  } catch {console.error('SAFE_SCANNER_FAILED');process.exitCode=1;}
}
