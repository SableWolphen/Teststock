// Broker-agnostic autonomous cycle planner. Produces auditable intents; never places orders.
import {screenOptions,exitPriority,orderReadiness} from './options-command-center.mjs';
export function planTradingCycle({positions=[],orders=[],optionQuotes=[],cash=0,capabilities={},now=new Date().toISOString(),marketOpen=false,killSwitch=false,maxPremium=50}={}){
 const pendingIds=new Set(orders.filter(o=>['queued','confirmed','unconfirmed','partially_filled','pending'].includes(String(o.state).toLowerCase())).flatMap(o=>(o.legs||[]).map(l=>l.option_id).filter(Boolean)));
 const exits=exitPriority(positions.map(p=>({...p,pendingSell:Boolean(p.pendingSell)||pendingIds.has(p.optionId)})),now);
 const alerts=exits.filter(p=>p.priority==='REVIEW_NOW').map(p=>({type:'EXIT_REVIEW',optionId:p.optionId,reasons:p.reasons}));
 const fresh=Date.parse(capabilities.verifiedAt);
 const capabilitiesFresh=Number.isFinite(fresh)&&Date.parse(now)>=fresh&&Date.parse(now)-fresh<=3600000;
 const exitsVerified=capabilitiesFresh&&capabilities.liveOrderSubmission===true&&capabilities.liveOptionEntrySubmission===true&&capabilities.liveOptionExitSubmission===true&&capabilities.liveOptionExitVerifiedThisSession===true;
 const candidates=screenOptions(optionQuotes,{cash,maxPremium,now});
 const blockers=[];
 if(killSwitch)blockers.push('KILL_SWITCH');
 if(!marketOpen)blockers.push('MARKET_CLOSED');
 if(!exitsVerified)blockers.push('BROKER_ENTRY_EXIT_UNVERIFIED');
 if(alerts.length)blockers.push('EXISTING_POSITION_PRIORITY');
 const eligible=candidates.filter(c=>c.eligible&&!pendingIds.has(c.optionId));
 const top=eligible[0]||null;
 const readiness=orderReadiness({brokerConfirmed:exitsVerified,quoteFresh:Boolean(top),exitVerified:exitsVerified,duplicateOrder:top?pendingIds.has(top.optionId):false,availableCash:cash,cost:top?.premium??Infinity});
 return {generatedAt:now,mode:'BROKER_REVIEW_REQUIRED',automaticSubmissionAuthorized:false,blockers:[...blockers,...(top?readiness.blocks:[])],alerts,exitQueue:exits,candidates:candidates.slice(0,20),nextAction:blockers.length?'MANAGE_EXISTING_OR_WAIT':top&&readiness.readyForBrokerReview?'REVIEW_BROKER_ORDER':'WAIT_FOR_QUALIFIED_SETUP',proposedContract:!blockers.length&&readiness.readyForBrokerReview?top:null};
}
