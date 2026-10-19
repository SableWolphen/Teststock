import {evaluateNyseSession,newYorkClock} from './nyse-session.mjs';

// Never fall back to a weekday guess or a different credential environment.
export async function readCalendarSession({env=process.env,transport=fetch,now=new Date()}={}) {
  const blocked=code=>({code,stocks:false,calendarAvailable:false,entryAllowed:false,generatedAt:now.toISOString()});
  const key=env.ALPACA_API_KEY||env.APCA_API_KEY_ID;
  const secret=env.ALPACA_API_SECRET||env.APCA_API_SECRET_KEY;
  if(!key||!secret)return blocked('ALPACA_CREDENTIALS_MISSING');
  const {dateKey}=newYorkClock(now);
  const url=new URL('https://paper-api.alpaca.markets/v2/calendar');
  url.searchParams.set('start',dateKey);url.searchParams.set('end',dateKey);
  let response,rows;
  try {
    response=await transport(url,{headers:{'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret},redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok)return blocked(`ALPACA_CALENDAR_HTTP_${response.status}`);
    rows=await response.json();
  } catch { return blocked('ALPACA_CALENDAR_UNAVAILABLE'); }
  if(!Array.isArray(rows))return blocked('ALPACA_CALENDAR_INVALID');
  if(rows.length===0)return {...blocked('MARKET_CLOSED'),calendarAvailable:true};
  const matching=rows.filter(x=>x?.date===dateKey);
  const validTime=x=>typeof x==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x);
  if(matching.length!==1||!validTime(matching[0].open)||!validTime(matching[0].close))return blocked('ALPACA_CALENDAR_INVALID');
  const session=evaluateNyseSession({now,calendarSession:matching[0],entryCutoffMinutesBeforeClose:20,forcedExitStartMinutesBeforeClose:10});
  if(!session.calendarAvailable)return blocked('ALPACA_CALENDAR_INVALID');
  return {...session,stocks:session.regularSession,code:session.regularSession?'REGULAR_SESSION_OPEN':'MARKET_CLOSED',generatedAt:now.toISOString()};
}

export const sessionOutputs=s=>`stocks=${s.stocks===true}\ncalendar_available=${s.calendarAvailable===true}\nentry_allowed=${s.entryAllowed===true}\nsession_status=${s.code}\n`;
