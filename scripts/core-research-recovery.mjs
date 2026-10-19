// Research scheduling only. This never authorizes an order or changes controls.
export function coreResearchRecovery({control,packet,runs=[],now=Date.now()}={}) {
 if(control?.enabled!==true)return {dispatch:false,reason:'RESEARCH_PAUSED_OR_CONTROL_UNVERIFIED'};
 const clock=new Date(now),weekday=clock.getUTCDay(),hour=clock.getUTCHours();
 // Match trading_bot.yml's existing schedule window. This is a resource window,
 // not a market-open assertion; the scanner still verifies the provider clock.
 if(weekday===0||weekday===6||hour<13||hour>21)return {dispatch:false,reason:'OUTSIDE_RESEARCH_SCHEDULE_WINDOW'};
 if(!Array.isArray(runs)||runs.some(r=>['queued','in_progress','waiting','requested','pending'].includes(r?.status)))return {dispatch:false,reason:'RESEARCH_IN_FLIGHT_OR_STATE_UNVERIFIED'};
 const generated=Date.parse(packet?.generatedAt??''),expires=Date.parse(packet?.expiresAt??'');
 const fresh=packet?.mode==='RESEARCH_ONLY'&&packet.liveOrdersEnabled===false&&packet.diagnostics?.scope?.name==='CURRENT_ACCESS_CORE'&&Number.isFinite(generated)&&Number.isFinite(expires)&&generated<=now&&now-generated<=300000&&expires>now&&expires<=generated+300000;
 return {dispatch:!fresh,reason:fresh?'CORE_PACKET_FRESH':'CORE_PACKET_EXPIRED_OR_UNVERIFIED'};
}
