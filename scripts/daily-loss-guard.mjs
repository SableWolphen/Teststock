import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fresh} from './trading-research-policy.mjs';
const money=x=>Number.isSafeInteger(x)&&x>=0;
export const lossSession=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
// The fixed cap alone is meaningless on a small account ($80 is more than a $64 account).
// The effective cap is the smaller of the fixed cap and a percentage of current equity.
export function effectiveDailyLossLimitCents(equityCents,fixedCents=8000,pct=5){
  if(!money(equityCents)||equityCents===0)return fixedCents;
  return Math.max(1,Math.min(fixedCents,Math.floor(equityCents*pct/100)));
}
export function evaluateDailyLoss(account,previous,limitCents=8000,now=Date.now()) {
  const fail=code=>({allowed:false,reason:code,state:null});
  const day=lossSession(now),loss=account?.dailyLoss;
  if(account?.source!=='robinhood'||account.reconciled!==true||!fresh(account.asOf,now,60000)||!loss||!fresh(loss.asOf,now,60000)||loss.sessionDate!==day||![loss.grossRealizedLossCents,loss.unrealizedLossCents].every(money)||!money(limitCents)||limitCents===0)return fail('DAILY_LOSS_UNVERIFIED');
  if(previous?.version!==1||!/^\d{4}-\d{2}-\d{2}$/.test(previous.sessionDate)||!Number.isFinite(Date.parse(previous.sessionDate))||previous.sessionDate>day||typeof previous.halted!=='boolean'||!money(previous.peakLossCents)||!money(previous.grossRealizedLossCents)||!Number.isFinite(Date.parse(previous.updatedAt))||Date.parse(previous.updatedAt)>now)return fail('DAILY_STATE_UNAVAILABLE');
  const sameDay=previous.sessionDate===day;
  if(sameDay&&!fresh(previous.updatedAt,now,360000))return fail('DAILY_STATE_STALE');
  if(sameDay&&loss.grossRealizedLossCents<previous.grossRealizedLossCents)return fail('DAILY_LOSS_REWIND');
  const measured=loss.grossRealizedLossCents+loss.unrealizedLossCents;
  if(!money(measured))return fail('DAILY_LOSS_UNVERIFIED');
  const peakLossCents=Math.max(measured,sameDay?previous.peakLossCents:0);
  const halted=(sameDay&&previous.halted)||peakLossCents>=limitCents;
  return {allowed:!halted,reason:halted?'DAILY_LOSS_LIMIT':'DAILY_LOSS_CLEAR',state:{version:1,sessionDate:day,halted,peakLossCents,grossRealizedLossCents:loss.grossRealizedLossCents,limitCents,updatedAt:new Date(now).toISOString()}};
}
// A private, pre-initialized state file is required. Never put this file in GitHub.
// The caller must persist the latch before using an allowed planning decision.
export async function updateDailyLossGuard(file,account,limitCents=8000,now=Date.now()) {
  let lock;const temp=`${file}.${randomUUID()}.tmp`;
  try {
    lock=await fs.open(`${file}.lock`,'wx',0o600);
    const previous=JSON.parse(await fs.readFile(file,'utf8'));
    const result=evaluateDailyLoss(account,previous,limitCents,now);
    if(result.state){await fs.writeFile(temp,JSON.stringify(result.state)+'\n',{mode:0o600,flag:'wx'});await fs.rename(temp,file);}
    return result;
  }catch{return {allowed:false,reason:'DAILY_STATE_UNAVAILABLE',state:null};}
  finally{await fs.rm(temp,{force:true}).catch(()=>{});if(lock){await lock.close();await fs.rm(`${file}.lock`,{force:true}).catch(()=>{});}}
}
