// Pure, auditable trading intelligence; no broker writes or credentials.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function rankOpportunities(items=[],now=Date.now()){
 return items.map(x=>{
 const age=now-Date.parse(x.quotedAt||'');
 const bid=Number(x.bid),ask=Number(x.ask),volume=Number(x.volume||0);
 const liquid=finite(bid)&&finite(ask)&&bid>0&&ask>=bid&&((ask-bid)/ask)<=0.2&&volume>=10;
 const fresh=Number.isFinite(age)&&age>=0&&age<=60000;
 const edge=Number(x.expectedReturnAfterCosts);
 const eligible=liquid&&fresh&&finite(edge)&&edge>0&&x.verifiedSource===true;
 return {...x,eligible,classification:'MANUAL_ONLY_BLOCKED',score:eligible?edge-((ask-bid)/ask)*0.5:null,reasons:[...(!fresh?['STALE_QUOTE']:[]),...(!liquid?['ILLIQUID']:[]),...(!finite(edge)||edge<=0?['NO_POSITIVE_NET_EDGE']:[]),...(x.verifiedSource!==true?['UNVERIFIED_SOURCE']:[])]};
 }).sort((a,b)=>(b.score??-Infinity)-(a.score??-Infinity));
}
export function positionRisk(position,{now=Date.now(),precloseMinutes=45}={}){
 const entry=Number(position.confirmedEntry),bid=Number(position.executableBid),qty=Number(position.quantity);
 const quoteAge=now-Date.parse(position.quotedAt||'');
 const valid=finite(entry)&&entry>0&&finite(bid)&&bid>=0&&finite(qty)&&qty>0&&quoteAge>=0&&quoteAge<=60000;
 const pnl=valid?(bid-entry)*qty*Number(position.multiplier||100):null;
 const pct=valid?(bid-entry)/entry:null;
 const expiry=Date.parse(position.expirationAt||'');
 const close=Date.parse(position.sessionCloseAt||'');
 const nearClose=Number.isFinite(close)&&close>=now&&close-now<=precloseMinutes*60000;
 const expired=Number.isFinite(expiry)&&expiry<=now;
 const alerts=[...(expired?['EXPIRED']:[]),...(nearClose?['PRECLOSE_EXIT_REQUIRED']:[]),...(valid&&pct<=-0.4?['STOP_THRESHOLD']:[]),...(valid&&pct>=0.5?['PROFIT_THRESHOLD']:[]),...(!valid?['QUOTE_OR_ENTRY_UNVERIFIED']:[])];
 return {symbol:position.symbol,optionId:position.optionId,pnl,pnlPct:pct,executableBid:valid?bid:null,alerts,exitPriority:alerts.some(a=>a!=='QUOTE_OR_ENTRY_UNVERIFIED')};
}
export function capitalPolicy({unleveragedBuyingPower=0,equity=0,price=0,multiplier=100,maxRiskFraction=0.02}={}){
 const buyingPower=Number(unleveragedBuyingPower),capital=Number(equity),unitCost=Number(price)*Number(multiplier);
 const valid=[buyingPower,capital,unitCost,maxRiskFraction].every(finite)&&buyingPower>=0&&capital>0&&unitCost>0&&maxRiskFraction>0&&maxRiskFraction<=0.05;
 const maxUnits=valid?Math.max(0,Math.floor(Math.min(buyingPower,capital*maxRiskFraction)/unitCost)):0;
 return {maxUnits,allowed:maxUnits>0,usesMargin:false,allowsAveragingDown:false};
}
export function strategyScorecard(trades=[]){
 const groups=new Map();
 for(const t of trades){if(!t||!t.confirmedExit||!t.confirmedEntry||!finite(t.netPnl)||!t.strategy)continue;const a=groups.get(t.strategy)||[];a.push(t.netPnl);groups.set(t.strategy,a);}
 return [...groups].map(([strategy,pnls])=>({strategy,trades:pnls.length,netPnl:pnls.reduce((a,b)=>a+b,0),winRate:pnls.filter(v=>v>0).length/pnls.length,promotionEligible:pnls.length>=30&&pnls.reduce((a,b)=>a+b,0)>0}));
}
export function controlCenter({capability={},account={},positions=[],candidates=[],trades=[],heartbeatAt,now=Date.now()}={}){
 const age=now-Date.parse(heartbeatAt||'');
 const health=Number.isFinite(age)&&age>=0&&age<=120000?'HEALTHY':'STALE_OR_UNVERIFIED';
 return {goal:100000000,accountValue:account.totalValue??null,buyingPower:account.unleveragedBuyingPower??null,execution:'AUTOMATIC_ONLY',liveEntryEligible:false,capabilityMode:capability.mode||'UNVERIFIED',health,positions:positions.map(p=>positionRisk(p,{now})),opportunities:rankOpportunities(candidates,now),strategies:strategyScorecard(trades),newRiskBlocked:true};
}
