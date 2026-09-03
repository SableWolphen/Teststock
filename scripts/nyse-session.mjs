const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

export function newYorkClock(date=new Date()){
  const parts=Object.fromEntries(formatter.formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return {dateKey:`${parts.year}-${parts.month}-${parts.day}`,minuteOfDay:Number(parts.hour)*60+Number(parts.minute)};
}

const marketMinute=value=>{const [hour,minute]=String(value||'').split(':').map(Number);return Number.isInteger(hour)&&Number.isInteger(minute)?hour*60+minute:null;};

export function evaluateNyseSession({now=new Date(),calendarSession=null,entryCutoffMinutesBeforeClose=30,forcedExitStartMinutesBeforeClose=15}={}){
  const ny=newYorkClock(now);
  const sessionMatches=calendarSession?.date===ny.dateKey;
  const openMinute=sessionMatches?marketMinute(calendarSession.open):null;
  const closeMinute=sessionMatches?marketMinute(calendarSession.close):null;
  const calendarAvailable=Number.isInteger(openMinute)&&Number.isInteger(closeMinute)&&closeMinute>openMinute;
  if(!calendarAvailable)return {timeZone:'America/New_York',dateKey:ny.dateKey,minuteOfDay:ny.minuteOfDay,calendarAvailable:false,regularSession:false,minutesToClose:null,sessionEnded:true,entryAllowed:false,forcedExitDue:true};
  const regularSession=ny.minuteOfDay>=openMinute&&ny.minuteOfDay<closeMinute;
  const minutesToClose=closeMinute-ny.minuteOfDay;
  const sessionEnded=ny.minuteOfDay>=closeMinute;
  return {timeZone:'America/New_York',dateKey:ny.dateKey,minuteOfDay:ny.minuteOfDay,calendarAvailable:true,openMinute,closeMinute,regularSession,minutesToClose,sessionEnded,entryAllowed:regularSession&&minutesToClose>=entryCutoffMinutesBeforeClose,forcedExitDue:!regularSession||minutesToClose<=forcedExitStartMinutesBeforeClose};
}
