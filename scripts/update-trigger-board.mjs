import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const WATCH='docs/data/execution-watchlist.json';
const OUT='docs/data/trigger-board.json';
const read=async(f,x)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const signal=await read(SIGNAL,{}),watch=await read(WATCH,{schemaVersion:1,positions:[]}),previous=await read(OUT,null),cryptoAdmission=await read('docs/data/crypto-profitability-admission.json',{});
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
const cryptoOrders=signal.cryptoPlan?.cryptoOrders||[];
const activePositions=(watch.positions||[]).filter(x=>x&&x.status==='ACTIVE');
const stockSymbols=unique([...stockCandidates.map(x=>x.ticker),...activePositions.filter(x=>x.assetClass==='STOCK').map(x=>x.ticker)]);
const cryptoSymbols=unique([...cryptoOrders.map(x=>x.ticker),...activePositions.filter(x=>x.assetClass==='CRYPTO').map(x=>x.ticker)]);
const prices={},errors=[];
if(stockSymbols.length){try{const q=new URLSearchParams({symbols:stockSymbols.join(','),feed:'iex'});const raw=await getJson(`https://data.alpaca.markets/v2/stocks/trades/latest?${q}`);for(const [s,v] of Object.entries(raw.trades||{})){const p=Number(v?.p);if(p>0)prices[s]=p;}}catch(e){errors.push(`stock prices: ${e.message}`);}}
if(cryptoSymbols.length){try{const q=new URLSearchParams({symbols:cryptoSymbols.join(',')});const raw=await getJson(`https://data.alpaca.markets/v1beta3/crypto/us/latest/trades?${q}`);for(const [s,v] of Object.entries(raw.trades||{})){const p=Number(v?.p);if(p>0)prices[s]=p;}}catch(e){errors.push(`crypto prices: ${e.message}`);}}
const ageMin=t=>{const ms=new Date(t||0).getTime();return Number.isFinite(ms)?(nowMs-ms)/60000:Infinity;};
const signalAgeMinutes=ageMin(signal.generatedAt);
const signalFresh=signalAgeMinutes<=25;
const prevById=new Map((previous?.items||[]).map(x=>[x.id,x]));
function stableItem(base,status,price,reason){const old=prevById.get(base.id),changed=!old||old.status!==status;return {...base,status,reason,observedPrice:price??old?.observedPrice??null,stateChangedAt:changed?nowIso:(old?.stateChangedAt||null)};}
const items=[];
for(const [i,x] of stockCandidates.entries()){
  const p=prices[x.ticker],min=Number(x.minimumEntry),max=Number(x.maximumEntry),tier=x.entryTier==='B'?'B':'A';let status='WAIT_ENTRY',reason='Price is outside the current buy zone.';
  const admission=x.profitabilityAdmission?.state||'UNKNOWN',decisionEligible=x.decisionIntelligence?.eligibleAfterOverlay===true,decisionSeedEligible=x.decisionIntelligence?.eligibleForSeedLane===true,actionAllowed=['AUTO_BUY_ELIGIBLE','WAIT_FOR_TRIGGER'].includes(String(x.action||''));
  // Stock seed lane (2026-08-26, expanded 2026-08-26): apply-profitability-admission.mjs flags up
  // to maxConcurrentPositions distinct SHADOW_ONLY candidates as seedLane.eligible. Each is
  // otherwise blocked upstream (action stays PROFITABILITY_ADMISSION_BLOCK, never loosened) --
  // this only lets a flagged candidate continue through the normal freshness/price checks below so
  // it can surface a distinct SEED_LANE_BUY_TRIGGER (never BUY_TRIGGER) capped at
  // seedLane.maxOrderUsd. It is automatic but still requires every other live guard;
  // final concurrency and same-day-stop exclusion are re-verified live by the execution-check
  // against real-trade-journal.json, not here.
  const seedLaneEligible=x.seedLane?.eligible===true;
  // Mirrors apply-profitability-admission.mjs's own blocked set (SHADOW_ONLY, LIVE_SUSPENDED).
  // Older explicit allowlist (MICRO_PROBATION/PROBATION/LIVE_ADMITTED only) predated the tiered
  // A-normal/B-micro policy and silently blocked every ELITE_RUNTIME_ELIGIBLE/BEST_ACCEPTABLE_MICRO
  // candidate -- i.e. every current A-tier stock -- from ever reaching a BUY_TRIGGER.
  const admissionOk=!['SHADOW_ONLY','LIVE_SUSPENDED','UNKNOWN'].includes(admission);
  if(!actionAllowed&&!seedLaneEligible){status='BLOCKED_UPSTREAM';reason=`Candidate action ${x.action||'UNKNOWN'} is not eligible for monitoring.`;}
  else if(!actionAllowed&&seedLaneEligible&&!admissionOk){
    if(!decisionSeedEligible){status='BLOCKED_DECISION_INTELLIGENCE';reason='The automatic stock seed lane bypasses only profitability admission; seed-specific decision intelligence did not pass.';}
    else if(!signalFresh){status='REFRESHING_SIGNAL';reason='Current research generation is being refreshed. This candidate is display-only until a fresh generation arrives; no buy trigger may fire from aged research.';}
    else if(!(p>0)){status='PRICE_UNAVAILABLE';reason='Latest Alpaca stock price unavailable.';}
    else if(p>max){status='DO_NOT_CHASE';reason='Price is above maximumEntry.';}
    else if(p>=min&&p<=max){status='SEED_LANE_BUY_TRIGGER';reason=`Automatic stock learning candidate is inside its buy zone. Capped at $${Number(x.seedLane?.maxOrderUsd||5)} using existing Robinhood cash only; every live guard and required protection still applies.`;}
  }
  else if(!admissionOk){status='BLOCKED_PROFITABILITY_ADMISSION';reason=`Profitability admission ${admission} cannot create live stock risk.`;}
  else if(!decisionEligible){status='BLOCKED_DECISION_INTELLIGENCE';reason='Decision-intelligence overlay did not pass; do not publish a buy trigger.';}
  else if(!signalFresh){status='REFRESHING_SIGNAL';reason='Current research generation is being refreshed. This candidate is display-only until a fresh generation arrives; no buy trigger may fire from aged research.';}
  else if(!(p>0)){status='PRICE_UNAVAILABLE';reason='Latest Alpaca stock price unavailable.';}
  else if(p>max){status='DO_NOT_CHASE';reason='Price is above maximumEntry.';}
  else if(p>=min&&p<=max){status='BUY_TRIGGER';reason=tier==='A'?'A/ELITE stock is inside its buy zone. It has priority over B candidates but must still pass every live guard.':'B/BEST_ACCEPTABLE stock is inside its buy zone. It may be used at reduced encoded size only when no live A candidate survives every guard.';}
  items.push(stableItem({id:`ENTRY:STOCK:${x.ticker}`,kind:'ENTRY',assetClass:'STOCK',ticker:x.ticker,entryTier:tier,entryTierLabel:x.entryTierLabel||(tier==='B'?'BEST_ACCEPTABLE':'ELITE'),entryTierSizeMultiplier:Number(x.entryTierSizeMultiplier??(tier==='B'?.5:1)),queueRank:Number(x.queueRank??x.rank??i+1),opportunityScore:Number(x.decisionScore??x.portfolioOpportunityScore??x.opportunityScore??x.growthQuality??0),growthQuality:Number(x.growthQuality||0),rewardRisk:Number(x.rewardRisk||0),profitabilityAdmission:admission,decisionIntelligenceEligible:decisionEligible,decisionIntelligenceSeedEligible:decisionSeedEligible,seedLaneEligible,seedLane:x.seedLane||null,minimumEntry:min,maximumEntry:max,stop:Number(x.stop),target1:Number(x.target1),target2:Number(x.target2),signalGeneratedAt:signal.generatedAt||null},status,p,reason));
}
for(const [i,x] of cryptoOrders.entries()){
  const p=prices[x.ticker],min=Number(x.minimumEntry),max=Number(x.maximumEntry);let status='WAIT_ENTRY',reason='Price is outside the current crypto buy zone.';
  const seedPolicy=signal.probabilityFirstPolicy?.crypto?.dayTradeSeedLane||{};
  const grade=String(x.setupGrade||'').toUpperCase();
  const seedEligible=seedPolicy.enabled===true&&cryptoAdmission.state!=='LIVE_SUSPENDED'&&(seedPolicy.requiredGrades||['A','A+']).includes(grade);
  const seedLane=seedEligible?{eligible:true,maxOrderUsd:Number(seedPolicy.maxOrderUsd||5),maxConcurrentPositions:Number(seedPolicy.maxConcurrentPositions||1),maxNewPositionsPerUtcDay:Number(seedPolicy.maxNewPositionsPerUtcDay||1),maxHoldingHours:Number(seedPolicy.maxHoldingHours||8),maxStopLossesPerUtcDay:Number(seedPolicy.maxStopLossesPerUtcDay||2),requiresPerOrderApproval:false,requiresBrokerResidentStop:seedPolicy.requiresBrokerResidentStop===true,existingRobinhoodCashOnly:true,agentMayInitiateDeposits:false,agentMayInitiateBankTransfers:false,marginAllowed:false,executionLane:'CLAUDE_ROBINHOOD_TRADING_MCP'}:{eligible:false};
  if(!seedEligible){status='BLOCKED_PROFITABILITY_ADMISSION';reason=`Crypto profitability admission ${cryptoAdmission.state||'UNKNOWN'} does not permit normal execution and the automatic seed lane is unavailable.`;}else if(!signalFresh){status='REFRESHING_SIGNAL';reason='Current crypto generation is being refreshed.';}else if(!(p>0)){status='PRICE_UNAVAILABLE';reason='Latest Alpaca crypto price unavailable.';}else if(p>max){status='DO_NOT_CHASE';reason='Price is above maximumEntry.';}else if(p>=min&&p<=max){status='CRYPTO_SEED_LANE_BUY_TRIGGER';reason=`Automatic crypto learning candidate is inside its buy zone. Capped at $${seedLane.maxOrderUsd} using existing Robinhood cash only and executed only through Claude Robinhood Trading MCP after every live guard passes.`;}
  items.push(stableItem({id:`ENTRY:CRYPTO:${x.ticker}`,kind:'ENTRY',assetClass:'CRYPTO',ticker:x.ticker,setupGrade:grade,queueRank:Number(x.rank||i+1),opportunityScore:Number(x.opportunityScore??x.growthQuality??0),growthQuality:Number(x.growthQuality||0),rewardRisk:Number(x.rewardRisk||0),profitabilityAdmission:cryptoAdmission.state||'UNKNOWN',seedLaneEligible:seedEligible,seedLane,minimumEntry:min,maximumEntry:max,stop:Number(x.stop),target1:Number(x.target1),target2:Number(x.target2),signalGeneratedAt:signal.generatedAt||null},status,p,reason));
}
for(const pos of activePositions){const p=prices[pos.ticker],stop=Number(pos.stop),t1=Number(pos.target1),t2=Number(pos.target2);let status='HOLD',reason='No saved sell trigger reached.';if(!(p>0)){status='PRICE_UNAVAILABLE';reason='Latest market price unavailable; do not infer that protection is healthy.';}else if(stop>0&&p<=stop){status='TRIGGER_1_STOP';reason='Saved stop/invalidation reached. Claude should verify the live position and execute the supported sell immediately when permitted.';}else if(t2>0&&p>=t2&&!pos.target2Completed){status='TRIGGER_3_TARGET2';reason='Target 2 reached. Claude should verify the live position and execute the validated Target 2/runner plan.';}else if(t1>0&&p>=t1&&!pos.target1Completed){status='TRIGGER_2_TARGET1';reason='Target 1 reached. Claude should verify the live position and execute the validated partial-profit plan.';}items.push(stableItem({id:`POSITION:${pos.id||`${pos.assetClass}:${pos.ticker}`}`,kind:'POSITION',assetClass:pos.assetClass,ticker:pos.ticker,queueRank:0,stop,target1:t1,target2:t2,target1Completed:Boolean(pos.target1Completed),target2Completed:Boolean(pos.target2Completed),runnerPct:Number(pos.runnerPct||0),armedAt:pos.armedAt||null},status,p,reason));}
const actionable=new Set(['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','CRYPTO_SEED_LANE_BUY_TRIGGER','TRIGGER_1_STOP','TRIGGER_2_TARGET1','TRIGGER_3_TARGET2']);
const events=items.filter(x=>actionable.has(x.status)).map(x=>({id:x.id,assetClass:x.assetClass,ticker:x.ticker,trigger:x.status,entryTier:x.entryTier??null,entryTierLabel:x.entryTierLabel??null,entryTierSizeMultiplier:x.entryTierSizeMultiplier??null,setupGrade:x.setupGrade??null,queueRank:x.queueRank??null,opportunityScore:x.opportunityScore??null,growthQuality:x.growthQuality??null,rewardRisk:x.rewardRisk??null,profitabilityAdmission:x.profitabilityAdmission??null,decisionIntelligenceEligible:x.decisionIntelligenceEligible??null,seedLane:x.seedLane??null,minimumEntry:x.minimumEntry??null,maximumEntry:x.maximumEntry??null,stop:x.stop??null,target1:x.target1??null,target2:x.target2??null,observedPrice:x.observedPrice,stateChangedAt:x.stateChangedAt,reason:x.reason}));
const buyCompetition=events.filter(x=>x.trigger==='BUY_TRIGGER').sort((a,b)=>((a.assetClass==='STOCK'&&a.entryTier==='A')?0:(a.assetClass==='STOCK'&&a.entryTier==='B')?1:2)-((b.assetClass==='STOCK'&&b.entryTier==='A')?0:(b.assetClass==='STOCK'&&b.entryTier==='B')?1:2)||Number(a.queueRank||999)-Number(b.queueRank||999)||Number(b.opportunityScore||0)-Number(a.opportunityScore||0));
for(const [i,e] of buyCompetition.entries())e.queueRole=i===0?'CURRENT_BEST_BUY':'FALLBACK_BUY';
const oldHealth=previous?.monitorHealth,monitorHealth=errors.length?'DEGRADED':'OK';
const previousGeneration=previous?.items?.find(x=>x?.signalGeneratedAt)?.signalGeneratedAt||null;
const meaningfulChanged=!previous||oldHealth!==monitorHealth||previous?.researchState!==(signalFresh?'ACTIVE':'REFRESHING')||previousGeneration!==(signal.generatedAt||null)||JSON.stringify((previous.items||[]).map(x=>[x.id,x.status,x.observedPrice,x.entryTier]))!==JSON.stringify(items.map(x=>[x.id,x.status,x.observedPrice,x.entryTier]));
const heartbeatDue=!previous?.publishedAt||ageMin(previous.publishedAt)>=30;
const publishedAt=(meaningfulChanged||heartbeatDue)?nowIso:previous.publishedAt;
const out={schemaVersion:5,source:'TESTSTOCK_NON_LLM_TRIGGER_MONITOR',publishedAt,monitorHealth,monitorCadenceMinutes:5,priceSource:'ALPACA_MARKET_DATA',claudeMarketPollingRequired:false,siteAvailability:'24_7_PUBLIC_DASHBOARD',researchState:signalFresh?'ACTIVE':'REFRESHING',researchAgeMinutes:Number.isFinite(signalAgeMinutes)?Number(signalAgeMinutes.toFixed(1)):null,displayPolicy:'Never present aged research as an active trading signal. During refresh, keep the latest candidate visible as display-only and block new buy triggers until a fresh generation arrives.',stockSessionRule:'Stock entry eligibility can close with the market; the site and monitoring health remain independently visible.',executionWakeBridge:{status:'DISPATCH_PACKET_READY_FOR_AUTOMATIC_EXECUTOR',note:'This monitor detects triggers without an LLM. The authorized Claude runner consumes the generated dispatch and is the sole Robinhood Trading MCP execution agent.'},watchlist:{activePositions:activePositions.length,armingRule:'After a confirmed Robinhood buy, the execution agent must establish and verify the encoded protection through Robinhood. Unverified protection means no new seed risk.'},executionNeeded:events.length>0,buyCompetition:{eligibleNow:buyCompetition.length,best:buyCompetition[0]||null,fallbacks:buyCompetition.slice(1),tierPriority:['A','B'],candidateSource:'stockPlan.stockCandidateQueue + stockPlan.stockOrders',rule:'A/ELITE live stock triggers go first. If no A survives the live broker guards, B/BEST_ACCEPTABLE may be executed at its reduced encoded size. Failed candidates fall through to the next eligible candidate in the same run. Never force a trade when all hard guards fail.'},events,items,errors:errors.length?errors:[],triggerDefinitions:{BUY_TRIGGER:'Qualified fresh entry zone reached; live broker checks still required.',SEED_LANE_BUY_TRIGGER:'An A-tier SHADOW_ONLY stock candidate reached its entry zone. Automatic through Claude Robinhood Trading MCP, capped at $5, existing cash only, and every other live guard remains mandatory.',CRYPTO_SEED_LANE_BUY_TRIGGER:'An A/A+ crypto candidate reached its entry zone. Automatic through Claude Robinhood Trading MCP, capped at $5, existing cash only, one position at a time, and every other live guard remains mandatory.',TRIGGER_1_STOP:'Stop/invalidation reached — verify position and sell protected quantity.',TRIGGER_2_TARGET1:'Target 1 reached — execute validated first scale-out.',TRIGGER_3_TARGET2:'Target 2 reached — execute validated exit/runner decision.'},creditPolicy:'Alpaca/GitHub monitor prices. Claude should read the small dispatch packet first and avoid market/broker work when no action is needed.'};
if(meaningfulChanged||heartbeatDue)await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log(`Trigger monitor ${monitorHealth}: research ${out.researchState}, ${events.length} actionable event(s), ${buyCompetition.length} competing buy(s) from ${stockCandidates.length} stock candidate(s); file ${meaningfulChanged||heartbeatDue?'updated':'unchanged'}.`);
