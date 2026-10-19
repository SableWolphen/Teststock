// Review/escalation only. No broker transport or order authority.
export function sessionExitReview({entryData={},holdingCount=0,now=Date.now()}={}) {
 const age=now-Date.parse(entryData.verifiedAt||'');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
 const date=`${parts.year}-${parts.month}-${parts.day}`,s=entryData.calendarSession;
 const minutes=v=>{const m=/^(\d{2}):(\d{2})$/.exec(v??'');return m&&Number(m[1])<24&&Number(m[2])<60?Number(m[1])*60+Number(m[2]):null;};
 const open=minutes(s?.open),close=minutes(s?.close),minute=Number(parts.hour)*60+Number(parts.minute);
 const calendarVerified=entryData.connected===true&&entryData.calendarVerified===true&&Number.isFinite(age)&&age>=-2000&&age<=30000&&s?.date===date&&open!==null&&close!==null&&close>open;
 const out={calendarVerified,sessionDate:date,holdingCount,brokerWrites:false,unattendedExecutionVerified:false,exitReviewRequired:false,exitReviewUpcoming:false};
 if(holdingCount===null)return {...out,state:'SESSION_EXIT_TIME_UNVERIFIED',exitReviewRequired:true};
 if(!holdingCount)return {...out,state:'NO_HOLDINGS'};
 if(!calendarVerified)return {...out,state:'SESSION_EXIT_TIME_UNVERIFIED',exitReviewRequired:true};
 // Hourly scheduled execution must act at the final whole-hour check BEFORE
 // the 15-minute cutoff, including early-close sessions. This does not prove
 // the executor will wake or can submit a confirmed exit.
 const lastCheck=Math.floor((close-15)/60)*60;
 return {...out,lastScheduledReviewNy:`${String(Math.floor(lastCheck/60)).padStart(2,'0')}:00`,closeNy:s.close,
   exitReviewRequired:minute>=lastCheck,exitReviewUpcoming:minute>=lastCheck-30&&minute<lastCheck,
   state:minute>=close?'SESSION_CLOSED_WITH_HOLDINGS':minute>=lastCheck?'SESSION_EXIT_REVIEW_REQUIRED':minute>=lastCheck-30?'SESSION_EXIT_REVIEW_UPCOMING':'MONITORING'};
}
