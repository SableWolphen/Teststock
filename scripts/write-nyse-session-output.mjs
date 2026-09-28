import fs from 'node:fs/promises';
import { evaluateNyseSession, newYorkClock } from './nyse-session.mjs';

const out=process.argv[2];
if(!out) throw new Error('GITHUB_OUTPUT path required');
const key=process.env.ALPACA_API_KEY;
const secret=process.env.ALPACA_API_SECRET;
if(!key||!secret) throw new Error('Alpaca credentials required for authoritative NYSE calendar gate');

const now=new Date();
const {dateKey}=newYorkClock(now);
const url=new URL('https://paper-api.alpaca.markets/v2/calendar');
url.searchParams.set('start',dateKey);
url.searchParams.set('end',dateKey);
const response=await fetch(url,{headers:{'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret}});
if(!response.ok) throw new Error(`Alpaca calendar HTTP ${response.status}`);
const rows=await response.json();
const row=Array.isArray(rows)?rows.find(x=>x.date===dateKey):null;
const session=evaluateNyseSession({now,calendarSession:row?{date:row.date,open:row.open,close:row.close}:null,entryCutoffMinutesBeforeClose:20,forcedExitStartMinutesBeforeClose:10});
await fs.appendFile(out,`stocks=${session.regularSession?'true':'false'}\ncalendar_available=${session.calendarAvailable?'true':'false'}\nentry_allowed=${session.entryAllowed?'true':'false'}\n`);
console.log(JSON.stringify(session));
