import fs from 'node:fs/promises';
import {evaluateNyseSession,newYorkClock} from './nyse-session.mjs';

const SIGNAL='docs/signal.json';
const WATCH='docs/data/execution-watchlist.json';
const OUT='docs/data/trigger-board.json';
const read=async(f,x)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const signal=await read(SIGNAL,{}),watch=await read(WATCH,{schemaVersion:1,positions:[]}),previous=await read(OUT,null);
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const now=new Date(),nowIso=now.toISOString(),nowMs=now.getTime();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJson(url){let last;for(let i=0;i<3;i++){try{const r=await fetch(url,{headers});if(r.ok)return r.json();last=new Error(`Alpaca ${r.status}: ${await r.text()}`);}catch(e){last=e;}await sleep(250*(2**i));}throw last;}
const unique=a=>[...new Set(a.filter(Boolean))];
const stockOrders=signal.stockPlan?.stockOrders||[];
const stockQueue=signal.stockPlan?.stockCandidateQueue||[];
const stockByTicker=new Map();
for(const x of stockOrders)if(x?.ticker)stockByTicker.set(x.ticker,{...x});
for(const x of stockQueue)if(x?.ticker)stockByTicker.set(x.ticker,{...(stockByTicker.get(x.ticker)||{}),...x});
const stockCandidates=[...stockByTicker.values()].sort((a,b)=>Number(a.queueRank??a.rank??999)-Number(b.queueRank??b.rank??999));
const activePositions=(watch.positions||[]).filter(x=>x&&x.status==='ACTIVE');
const stockSymbols=unique([...stockCandidates.map(x=>x.ticker),...activePositions.filter(x=>x.assetClass==='STOCK').map(x=>x.ticker)]);
const prices={},errors=[];
if(stockSymbols.length){try{const q=new URLSearchParams({symbols:stockSymbols.join(','),feed:'iex'});const raw=await getJson(`https://data.alpaca.markets/v2/stocks/trades/latest?${q}`);for(const [s,v] of Object.entries(raw.trades||{})){const p=Number(v?.p);if(p>0)prices[s]=p;}}catch(e){errors.push(`stock prices: ${e.message}`);}}
const dayTradePolicy=signal.probabilityFirstPolicy?.stocks?.dayTradeSeedLane||{};
const dayTradeOnlyMode=signal.dayTradeOnlyEntryPolicy?.enabled===true;
const nyDateKey=newYorkClock(now).dateKey;
let calendarSession=null;
try{const calendar=await getJson(`https://api.alpaca.markets/v2/calendar?start=${nyDateKey}&end=${nyDateKey}`);calendarSession=Array.isArray(calendar)?calendar[0]||null:null;}catch(e){errors.push(`market calendar: ${e.message}`);}
const marketSession=evaluateNyseSession({now,calendarSession,entryCutoffMinutesBeforeClose:Number(dayTradePolicy.entryCutoffMinutesBeforeClose||30),forcedExitStartMinutesBeforeClose:Number(dayTradePolicy.forcedExitStartMinutesBeforeClose||15)});
const ageMin=t=>{const ms=new Date(t||0).getTime();return Number.isFinite(ms)?(nowMs-ms)/60000:Infinity;};
const signalAgeMinutes=ageMin(signal.generatedAt);
const signalFresh=signalAgeMinutes<=25;
const prevById=new Map((previous?.items||[]).map(x=>[x.id,x]));
function stableItem(base,status,price,reason){const old=prevById.get(base.id),changed=!old||old.status!==status;return {...base,status,reason,observedPrice:price??old?.observedPrice??null,stateChangedAt:changed?nowIso:(old?.stateChangedAt||null)};}
const items=[];
for(const [i,x] of stockCandidates.entries()){
  const p=prices[x.ticker],min=Number(x.minimumEntry),max=Number(x.maximumEntry),tier=x.entryTier==='B'?'B':'A';let status='WAIT_ENTRY',reason='Price is outside the current buy zone.',boundedBelowFloorEntry=false;
  const admission=x.profitabilityAdmission?.state||'UNKNOWN',decisionEligible=x.decisionIntelligence?.eligibleAfterOverlay===true,decisionSeedEligible=x.decisionIntelligence?.eligibleForSeedLane===true,decisionDayTradeSeedEligible=x.decisionIntelligence?.eligibleForDayTradeSeedLane===true,actionAllowed=['AUTO_BUY_ELIGIBLE','WAIT_FOR_TRIGGER'].includes(String(x.action||''));
  // Stock seed lane (2026-08-26, expanded 2026-08-26): apply-profitability-admission.mjs flags up
  // to maxConcurrentPositions distinct SHADOW_ONLY candidates as seedLane.eligible. Each is
  // otherwise blocked upstream (action stays PROFITABILITY_ADMISSION_BLOCK, never loosened) --
  // this only lets a flagged candidate continue through the normal freshness/price checks below so
  // it can surface a distinct SEED_LANE_BUY_TRIGGER (never BUY_TRIGGER) capped at
  // seedLane.maxOrderUsd. It is automatic but still requires every other live guard;
  // final concurrency and same-day-stop exclusion are re-verified live by the execution-check
  // against real-trade-journal.json, not here.
  const seedLaneEligible=x.seedLane?.eligible===true;
  const dayTradeSeedLaneEligible=x.dayTradeSeedLane?.eligible===true;
  const anySeedLaneEligible=seedLaneEligible||dayTradeSeedLaneEligible;
  // Mirrors apply-profitability-admission.mjs's own blocked set (SHADOW_ONLY, LIVE_SUSPENDED).
  // Older explicit allowlist (MICRO_PROBATION/PROBATION/LIVE_ADMITTED only) predated the tiered
  // A-normal/B-micro policy and silently blocked every ELITE_RUNTIME_ELIGIBLE/BEST_ACCEPTABLE_MICRO
  // candidate -- i.e. every current A-tier stock -- from ever reaching a BUY_TRIGGER.
  const admissionOk=!['SHADOW_ONLY','LIVE_SUSPENDED','UNKNOWN'].includes(admission);
  // Day-trade-only mode (2026-09-22, user-requested): normally this branch only catches a blocked
  // SHADOW_ONLY row bypassing the wait (!actionAllowed&&!admissionOk). While dayTradeOnlyEntryPolicy
  // is enabled, apply-profitability-admission.mjs also flags already-admitted ELITE_RUNTIME_ELIGIBLE/
  // BEST_ACCEPTABLE_MICRO rows as dayTradeSeedLaneEligible (see its eligiblePool broadening), so this
  // condition must also catch those (actionAllowed&&admissionOk) or every elite candidate would be
  // stranded with no entry path once BUY_TRIGGER is paused below.
  const dayTradeLaneRoutedAdmitted=dayTradeOnlyMode&&dayTradeSeedLaneEligible&&admissionOk&&actionAllowed;
  if(!actionAllowed&&!anySeedLaneEligible){status='BLOCKED_UPSTREAM';reason=`Candidate action ${x.action||'UNKNOWN'} is not eligible for monitoring.`;}
  else if(dayTradeSeedLaneEligible&&((!actionAllowed&&!admissionOk)||dayTradeLaneRoutedAdmitted)){
    if(!decisionDayTradeSeedEligible){status='BLOCKED_DECISION_INTELLIGENCE';reason='The automatic same-day stock seed lane bypasses only profitability admission; seed-specific decision intelligence did not pass.';}
    else if(!signalFresh){status='REFRESHING_SIGNAL';reason='Current research generation is being refreshed. This candidate is display-only until a fresh generation arrives; no buy trigger may fire from aged research.';}
    else if(!marketSession.calendarAvailable){status='DAY_TRADE_SESSION_UNVERIFIED';reason='Authoritative NYSE session data is unavailable; same-day entry fails closed.';}
    else if(!marketSession.regularSession){status='DAY_TRADE_MARKET_CLOSED';reason='Same-day stock entries are allowed only during the authoritative regular session.';}
    else if(!marketSession.entryAllowed){status='DAY_TRADE_ENTRY_CUTOFF';reason=`Fewer than ${Number(x.dayTradeSeedLane?.entryCutoffMinutesBeforeClose||30)} minutes remain before the authoritative close; no new same-day position.`;}
    else if(!(p>0)){status='PRICE_UNAVAILABLE';reason='Latest Alpaca stock price unavailable.';}
    else if(p>max){status='DO_NOT_CHASE';reason='Price is above maximumEntry.';}
    else if(p>=min&&p<=max){status='STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER';reason=`Automatic same-day stock learning candidate is inside its buy zone with ${marketSession.minutesToClose} minutes to the authoritative close. Capped at $${Number(x.dayTradeSeedLane?.maxOrderUsd||20)} using existing Robinhood cash only and must be flat today.`;}
    // Bounded below-floor entry (2026-09-18, user request): mirrors the existing bounded
    // above-max chase allowance (CLAUDE.md) symmetrically on the low side -- up to 1% below the
    // computed minimumEntry still fires the seed-lane trigger, since it's an even smaller margin
    // of safety than a normal seed-lane fill. The live executor must apply a tightened stop and
    // reduced size to offset that, exactly as the above-max bounded allowance already requires.
    else if(p>=min*0.99&&p<min){status='STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER';boundedBelowFloorEntry=true;reason=`Automatic same-day stock learning candidate is within 1% below its buy-zone floor with ${marketSession.minutesToClose} minutes to the authoritative close. Capped at $${Number(x.dayTradeSeedLane?.maxOrderUsd||20)} using existing Robinhood cash only and must be flat today. Reduced margin of safety versus a normal in-zone fill: the executor must use a tightened stop and reduced size to offset it.`;}
  }
  else if(!actionAllowed&&seedLaneEligible&&!admissionOk){
    if(!decisionSeedEligible){status='BLOCKED_DECISION_INTELLIGENCE';reason='The automatic stock seed lane bypasses only profitability admission; seed-specific decision intelligence did not pass.';}
    else if(!signalFresh){status='REFRESHING_SIGNAL';reason='Current research generation is being refreshed. This candidate is display-only until a fresh generation arrives; no buy trigger may fire from aged research.';}
    else if(!(p>0)){status='PRICE_UNAVAILABLE';reason='Latest Alpaca stock price unavailable.';}
    else if(p>max){status='DO_NOT_CHASE';reason='Price is above maximumEntry.';}
    else if(p>=min&&p<=max&&!dayTradeOnlyMode){status='SEED_LANE_BUY_TRIGGER';reason=`Automatic stock learning candidate is inside its buy zone. Capped at $${Number(x.seedLane?.maxOrderUsd||20)} using existing Robinhood cash only; every live guard and required protection still applies.`;}
    else if(p>=min&&p<=max&&dayTradeOnlyMode){status='SWING_SEED_LANE_PAUSED_DAY_TRADE_ONLY_MODE';reason='This swing seed-lane candidate is inside its buy zone but new swing-lane stock entries are paused while dayTradeOnlyEntryPolicy is enabled (user-requested 2026-09-22, small same-day gains phase). New stock entries can only come from the day-trade seed lane until this policy is turned back off.';}
    else if(p>=min*0.99&&p<min&&!dayTradeOnlyMode){status='SEED_LANE_BUY_TRIGGER';boundedBelowFloorEntry=true;reason=`Automatic stock learning candidate is within 1% below its buy-zone floor. Capped at $${Number(x.seedLane?.maxOrderUsd||20)} using existing Robinhood cash only. Reduced margin of safety versus a normal in-zone fill: the executor must use a tightened stop and reduced size to offset it. Every other live guard and required protection still applies.`;}
    else if(p>=min*0.99&&p<min&&dayTradeOnlyMode){status='SWING_SEED_LANE_PAUSED_DAY_TRADE_ONLY_MODE';boundedBelowFloorEntry=true;reason='This swing seed-lane candidate is within 1% below its buy-zone floor but new swing-lane stock entries are paused while dayTradeOnlyEntryPolicy is enabled (user-requested 2026-09-22, small same-day gains phase). New stock entries can only come from the day-trade seed lane until this policy is turned back off.';}
  }
  else if(!admissionOk){status='BLOCKED_PROFITABILITY_ADMISSION';reason=`Profitability admission ${admission} cannot create live stock risk.`;}
  else if(!decisionEligible){status='BLOCKED_DECISION_INTELLIGENCE';reason='Decision-intelligence overlay did not pass; do not publish a buy trigger.';}
  else if(!signalFresh){status='REFRESHING_SIGNAL';reason='Current research generation is being refreshed. This candidate is display-only until a fresh generation arrives; no buy trigger may fire from aged research.';}
  else if(!(p>0)){status='PRICE_UNAVAILABLE';reason='Latest Alpaca stock price unavailable.';}
  else if(p>max){status='DO_NOT_CHASE';reason='Price is above maximumEntry.';}
  else if(p>=min&&p<=max&&!dayTradeOnlyMode){status='BUY_TRIGGER';reason=tier==='A'?'A/ELITE stock is inside its buy zone. It has priority over B candidates but must still pass every live guard.':'B/BEST_ACCEPTABLE stock is inside its buy zone. It may be used at reduced encoded size only when no live A candidate survives every guard.';}
  else if(p>=min&&p<=max&&dayTradeOnlyMode){status='SWING_ENTRY_PAUSED_DAY_TRADE_ONLY_MODE';reason='This candidate is inside its normal buy zone but new swing-lane stock entries are paused while dayTradeOnlyEntryPolicy is enabled (user-requested 2026-09-22, small same-day gains phase). New stock entries can only come from the day-trade seed lane until this policy is turned back off.';}
  // Day-trade seed-lane fills use their own tighter target1/target2 (2%/3% above entry, set on
  // x.dayTradeSeedLane by apply-profitability-admission.mjs) instead of the shared swing 1.5R/2.6R
  // geometry on x.target1/x.target2 -- isolated to this one status so BUY_TRIGGER/SEED_LANE_BUY_TRIGGER
  // rows are unaffected.
  const isDayTradeLaneTrigger=status==='STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER';
  const itemTarget1=isDayTradeLaneTrigger&&Number(x.dayTradeSeedLane?.target1)>0?Number(x.dayTradeSeedLane.target1):Number(x.target1);
  const itemTarget2=isDayTradeLaneTrigger&&Number(x.dayTradeSeedLane?.target2)>0?Number(x.dayTradeSeedLane.target2):Number(x.target2);
  items.push(stableItem({id:`ENTRY:STOCK:${x.ticker}`,kind:'ENTRY',assetClass:'STOCK',ticker:x.ticker,entryTier:tier,entryTierLabel:x.entryTierLabel||(tier==='B'?'BEST_ACCEPTABLE':'ELITE'),entryTierSizeMultiplier:Number(x.entryTierSizeMultiplier??(tier==='B'?.5:1)),queueRank:Number(x.queueRank??x.rank??i+1),opportunityScore:Number(x.decisionScore??x.portfolioOpportunityScore??x.opportunityScore??x.growthQuality??0),growthQuality:Number(x.growthQuality||0),rewardRisk:Number(x.rewardRisk||0),profitabilityAdmission:admission,decisionIntelligenceEligible:decisionEligible,decisionIntelligenceSeedEligible:decisionSeedEligible,decisionIntelligenceDayTradeSeedEligible:decisionDayTradeSeedEligible,seedLaneEligible,seedLane:x.seedLane||null,dayTradeSeedLaneEligible,dayTradeSeedLane:x.dayTradeSeedLane||null,marketSession,minimumEntry:min,maximumEntry:max,boundedBelowFloorEntry,stop:Number(x.stop),target1:itemTarget1,target2:itemTarget2,signalGeneratedAt:signal.generatedAt||null},status,p,reason));
}
const EARLY_PROFIT_TRIM_GAIN_PCT=0.05;
for(const pos of activePositions){const p=prices[pos.ticker],stop=Number(pos.stop),t1=Number(pos.target1),t2=Number(pos.target2),entry=Number(pos.entry);let status='HOLD',reason='No saved sell trigger reached.';if(pos.assetClass==='STOCK'&&pos.dayTradeSeedLane===true&&marketSession.forcedExitDue){status='STOCK_DAY_TRADE_FORCED_EXIT';reason=marketSession.calendarAvailable?`Same-day position must be closed; ${marketSession.sessionEnded?'the regular session has ended':`${marketSession.minutesToClose} minutes remain before close`}. Re-fire until Robinhood confirms flat.`:'Same-day position remains open but authoritative session data is unavailable; fail closed and prioritize broker reconciliation/risk reduction.';}else if(!(p>0)){status='PRICE_UNAVAILABLE';reason='Latest market price unavailable; do not infer that protection is healthy.';}else if(stop>0&&p<=stop){status='TRIGGER_1_STOP';reason='Saved stop/invalidation reached. Claude should verify the live position and execute the supported sell immediately when permitted.';}else if(t2>0&&p>=t2&&!pos.target2Completed){status='TRIGGER_3_TARGET2';reason='Target 2 reached. Claude should verify the live position and execute the validated Target 2/runner plan.';}else if(t1>0&&p>=t1&&!pos.target1Completed){status='TRIGGER_2_TARGET1';reason='Target 1 reached. Claude should verify the live position and execute the validated partial-profit plan.';}else if(entry>0&&p>=entry*(1+EARLY_PROFIT_TRIM_GAIN_PCT)&&!pos.earlyTrimCompleted){status='TRIGGER_EARLY_PROFIT_TRIM';reason=`Position is up ${(((p/entry)-1)*100).toFixed(1)}% from its recorded cost basis, past the ${(EARLY_PROFIT_TRIM_GAIN_PCT*100).toFixed(0)}% early profit-trim threshold (user-authorized 2026-09-21, to keep capital cycling instead of waiting only for the full target). Claude should verify the live position and sell roughly half to lock in the gain and free capital, leaving the remainder to run toward the saved target. Fires once per cost basis.`;}items.push(stableItem({id:`POSITION:${pos.id||`${pos.assetClass}:${pos.ticker}`}`,kind:'POSITION',assetClass:pos.assetClass,ticker:pos.ticker,queueRank:0,dayTradeSeedLane:pos.dayTradeSeedLane===true,marketSession,entry,stop,target1:t1,target2:t2,target1Completed:Boolean(pos.target1Completed),target2Completed:Boolean(pos.target2Completed),earlyTrimCompleted:Boolean(pos.earlyTrimCompleted),runnerPct:Number(pos.runnerPct||0),armedAt:pos.armedAt||null},status,p,reason));}
const actionable=new Set(['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_FORCED_EXIT','TRIGGER_1_STOP','TRIGGER_2_TARGET1','TRIGGER_3_TARGET2','TRIGGER_EARLY_PROFIT_TRIM']);
const events=items.filter(x=>actionable.has(x.status)).map(x=>({id:x.id,assetClass:x.assetClass,ticker:x.ticker,trigger:x.status,entryTier:x.entryTier??null,entryTierLabel:x.entryTierLabel??null,entryTierSizeMultiplier:x.entryTierSizeMultiplier??null,setupGrade:x.setupGrade??null,queueRank:x.queueRank??null,opportunityScore:x.opportunityScore??null,growthQuality:x.growthQuality??null,rewardRisk:x.rewardRisk??null,profitabilityAdmission:x.profitabilityAdmission??null,qualificationSource:x.qualificationSource??null,tournamentGeneratedAt:x.tournamentGeneratedAt??null,decisionIntelligenceEligible:x.decisionIntelligenceEligible??null,seedLane:x.seedLane??null,dayTradeSeedLane:x.dayTradeSeedLane??null,marketSession:x.marketSession??null,minimumEntry:x.minimumEntry??null,maximumEntry:x.maximumEntry??null,stop:x.stop??null,target1:x.target1??null,target2:x.target2??null,observedPrice:x.observedPrice,stateChangedAt:x.stateChangedAt,reason:x.reason}));
const buyCompetition=events.filter(x=>x.trigger==='BUY_TRIGGER').sort((a,b)=>((a.assetClass==='STOCK'&&a.entryTier==='A')?0:(a.assetClass==='STOCK'&&a.entryTier==='B')?1:2)-((b.assetClass==='STOCK'&&b.entryTier==='A')?0:(b.assetClass==='STOCK'&&b.entryTier==='B')?1:2)||Number(a.queueRank||999)-Number(b.queueRank||999)||Number(b.opportunityScore||0)-Number(a.opportunityScore||0));
for(const [i,e] of buyCompetition.entries())e.queueRole=i===0?'CURRENT_BEST_BUY':'FALLBACK_BUY';
const oldHealth=previous?.monitorHealth,monitorHealth=errors.length?'DEGRADED':'OK';
const previousGeneration=previous?.items?.find(x=>x?.signalGeneratedAt)?.signalGeneratedAt||null;
const forcedExitPending=events.some(x=>x.trigger==='STOCK_DAY_TRADE_FORCED_EXIT');
const meaningfulChanged=forcedExitPending||!previous||oldHealth!==monitorHealth||previous?.researchState!==(signalFresh?'ACTIVE':'REFRESHING')||previousGeneration!==(signal.generatedAt||null)||JSON.stringify((previous.items||[]).map(x=>[x.id,x.status,x.observedPrice,x.entryTier]))!==JSON.stringify(items.map(x=>[x.id,x.status,x.observedPrice,x.entryTier]));
const heartbeatDue=!previous?.publishedAt||ageMin(previous.publishedAt)>=30;
const publishedAt=(meaningfulChanged||heartbeatDue)?nowIso:previous.publishedAt;
const out={schemaVersion:6,source:'TESTSTOCK_NON_LLM_TRIGGER_MONITOR',publishedAt,monitorHealth,monitorCadenceMinutes:5,priceSource:'ALPACA_MARKET_DATA',claudeMarketPollingRequired:false,siteAvailability:'NYSE_STOCK_DAY_TRADING_ONLY',researchState:signalFresh?'ACTIVE':'REFRESHING',researchAgeMinutes:Number.isFinite(signalAgeMinutes)?Number(signalAgeMinutes.toFixed(1)):null,marketSession,displayPolicy:'Never present aged research as an active trading signal. During refresh, keep the latest candidate visible as display-only and block new buy triggers until a fresh generation arrives.',stockSessionRule:'Same-day stock entries require an authoritative regular-session calendar and at least 20 minutes to close. Tagged same-day positions emit a forced exit from 10 minutes before close and after the session until confirmed flat.',executionWakeBridge:{status:'DISPATCH_PACKET_READY_FOR_AUTOMATIC_EXECUTOR',note:'This monitor detects triggers without an LLM. The authorized Claude runner consumes the generated dispatch and is the sole Robinhood Trading MCP execution agent.'},watchlist:{activePositions:activePositions.length,armingRule:'After a confirmed same-day buy, persist dayTradeSeedLane=true with the saved protection levels. Keep it ACTIVE until Robinhood confirms flat so forced exits continue to fire.'},executionNeeded:events.length>0,buyCompetition:{eligibleNow:buyCompetition.length,best:buyCompetition[0]||null,fallbacks:buyCompetition.slice(1),tierPriority:['A','B'],candidateSource:'stockPlan.stockCandidateQueue + stockPlan.stockOrders',rule:'A/ELITE live stock triggers go first. After A-tier candidates, B/BEST_ACCEPTABLE may be executed at no more than 25% encoded normal size while live capacity remains, including after an A fill. Failed candidates fall through to the next eligible candidate in the same run. Never force a trade when all hard guards fail.'},events,items,errors:errors.length?errors:[],triggerDefinitions:{BUY_TRIGGER:'Qualified fresh entry zone reached; live broker checks still required.',SEED_LANE_BUY_TRIGGER:'An A-tier SHADOW_ONLY stock candidate reached its entry zone. Automatic through Claude Robinhood Trading MCP, capped at $20, existing cash only, and every other live guard remains mandatory.',STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER:'A non-overlapping A-tier same-day seed candidate reached its entry zone during the regular session with at least 30 minutes to close. Automatic through Claude Robinhood Trading MCP and capped at $20.',STOCK_DAY_TRADE_FORCED_EXIT:'A tagged same-day position must be reconciled and closed. This repeats from 15 minutes before close and after the session until Robinhood confirms flat.',TRIGGER_1_STOP:'Stop/invalidation reached — verify position and sell protected quantity.',TRIGGER_2_TARGET1:'Target 1 reached — execute validated first scale-out.',TRIGGER_3_TARGET2:'Target 2 reached — execute validated exit/runner decision.',TRIGGER_EARLY_PROFIT_TRIM:'Position is up at least 5% from its recorded cost basis, short of the full target — sell roughly half to lock in the gain and free capital, let the remainder run.'},creditPolicy:'Alpaca/GitHub monitor prices. Claude should read the small dispatch packet first and avoid market/broker work when no action is needed.'};
if(meaningfulChanged||heartbeatDue)await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log(`Trigger monitor ${monitorHealth}: research ${out.researchState}, ${events.length} actionable event(s), ${buyCompetition.length} competing buy(s) from ${stockCandidates.length} stock candidate(s); file ${meaningfulChanged||heartbeatDue?'updated':'unchanged'}.`);
