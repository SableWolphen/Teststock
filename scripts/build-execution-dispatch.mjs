import fs from 'node:fs/promises';

const BOARD='docs/data/trigger-board.json';
const SIGNAL='docs/signal.json';
const OUT='docs/data/execution-dispatch.json';
const read=async(f,x)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const board=await read(BOARD,null);
const signal=await read(SIGNAL,{});
const previous=await read(OUT,null);
const now=new Date();
const nowIso=now.toISOString();
const MAX_BOARD_AGE_MS=15*60*1000;
const MAX_ENTRY_AGE_MS=10*60*1000;
const publishedMax=Number(signal?.stockPlan?.policy?.maxConcurrentNewPositions??signal?.stockPlan?.opportunityExpansion?.maxConcurrentQualifiedStocks??signal?.tradeFrequencyGuard?.maxConcurrentPositions??4);
const MAX_NEW_BUYS_PER_DISPATCH=Math.max(1,Math.min(4,Number.isFinite(publishedMax)?publishedMax:4));

const priority={TRIGGER_1_STOP:100,TRIGGER_3_TARGET2:80,TRIGGER_2_TARGET1:70,BUY_TRIGGER:50};
const actionMap={TRIGGER_1_STOP:'VERIFY_POSITION_AND_SELL_STOP',TRIGGER_3_TARGET2:'VERIFY_POSITION_AND_EXECUTE_TARGET2_OR_RUNNER',TRIGGER_2_TARGET1:'VERIFY_POSITION_AND_EXECUTE_TARGET1',BUY_TRIGGER:'VERIFY_LIVE_GUARDS_AND_EXECUTE_IF_STILL_ELIGIBLE'};
const ageMs=value=>{const timestamp=Date.parse(value||'');return Number.isFinite(timestamp)?Math.max(0,now.getTime()-timestamp):Infinity;};
const boardAgeMs=ageMs(board?.publishedAt);
const boardHealthy=board?.monitorHealth==='OK'&&boardAgeMs<=MAX_BOARD_AGE_MS;
const previousFingerprints=new Set(previous?.dispatchFingerprints||[previous?.pendingAction?.fingerprint].filter(Boolean));

const candidates=(board?.events||[]).filter(e=>priority[e.trigger]&&!(e.trigger==='BUY_TRIGGER'&&e.assetClass!=='STOCK')).map(e=>{
  const fingerprint=`${e.id}|${e.trigger}|${e.stateChangedAt}`;
  const triggerAgeMs=ageMs(e.stateChangedAt);
  const isFresh=e.trigger!=='BUY_TRIGGER'||triggerAgeMs<=MAX_ENTRY_AGE_MS;
  const isNew=!previousFingerprints.has(fingerprint);
  return {...e,fingerprint,priority:priority[e.trigger],requestedAction:actionMap[e.trigger],triggerAgeMs,expiresAt:e.trigger==='BUY_TRIGGER'?new Date(Date.parse(e.stateChangedAt)+MAX_ENTRY_AGE_MS).toISOString():null,isFresh,isNew,isActionable:boardHealthy&&isFresh&&isNew};
}).sort((a,b)=>b.priority-a.priority||Number(a.queueRank||999)-Number(b.queueRank||999)||String(a.ticker).localeCompare(String(b.ticker)));

const hasExitEvent=candidates.some(x=>x.trigger!=='BUY_TRIGGER');
const permittedCandidates=hasExitEvent?candidates.filter(x=>x.trigger!=='BUY_TRIGGER'):candidates;
const actionableCandidates=permittedCandidates.filter(x=>x.isActionable);
const selected=actionableCandidates[0]||null;
const compact=x=>({fingerprint:x.fingerprint,isNew:x.isNew,isActionable:x.isActionable,priority:x.priority,assetClass:x.assetClass,ticker:x.ticker,trigger:x.trigger,entryTier:x.entryTier??null,entryTierLabel:x.entryTierLabel??null,entryTierSizeMultiplier:x.entryTierSizeMultiplier??null,queueRank:x.queueRank??null,queueRole:x.queueRole??null,profitabilityAdmission:x.profitabilityAdmission??null,decisionIntelligenceEligible:x.decisionIntelligenceEligible??null,requestedAction:x.requestedAction,observedPrice:x.observedPrice,triggerStateChangedAt:x.stateChangedAt,triggerAgeMs:x.triggerAgeMs,expiresAt:x.expiresAt,reason:x.reason,packet:`${x.ticker} | ${x.trigger} | observed ${x.observedPrice ?? 'UNKNOWN'} | ${x.requestedAction}`});
const pendingAction=selected?compact(selected):null;
const automaticStockCandidates=hasExitEvent?[]:actionableCandidates.filter(x=>x.trigger==='BUY_TRIGGER').slice(0,MAX_NEW_BUYS_PER_DISPATCH).map(compact);
const fallbackActions=selected?.trigger==='BUY_TRIGGER'?automaticStockCandidates.slice(1):[];

const seedEvents=(board?.events||[]).filter(e=>e.trigger==='SEED_LANE_BUY_TRIGGER'&&e.assetClass==='STOCK').map(e=>{
  const fingerprint=`${e.id}|${e.trigger}|${e.stateChangedAt}`;
  const triggerAgeMs=ageMs(e.stateChangedAt);
  const isFresh=triggerAgeMs<=MAX_ENTRY_AGE_MS;
  const isNew=!previousFingerprints.has(fingerprint);
  return {...e,fingerprint,triggerAgeMs,isFresh,isNew,isActionable:boardHealthy&&isFresh&&isNew};
});
const compactSeed=e=>({
  fingerprint:e.fingerprint,assetClass:'STOCK',ticker:e.ticker,trigger:e.trigger,
  maxOrderUsd:Number(e.seedLane?.maxOrderUsd||5),
  maxConcurrentPositions:Number(e.seedLane?.maxConcurrentPositions||5),
  requiresPerOrderApproval:false,
  requestedAction:'VERIFY_LIVE_GUARDS_CONCURRENCY_AND_EXECUTE_SEED_IF_STILL_ELIGIBLE',
  observedPrice:e.observedPrice,triggerStateChangedAt:e.stateChangedAt,
  reason:e.reason,
  packet:`${e.ticker} | SEED_LANE_BUY_TRIGGER | observed ${e.observedPrice ?? 'UNKNOWN'} | capped at $${Number(e.seedLane?.maxOrderUsd||5)} | automatic after live recheck`
});
const seedLaneCandidates=hasExitEvent?[]:seedEvents.filter(e=>e.isActionable).map(compactSeed);

const out={
  schemaVersion:3,source:'TESTSTOCK_EVENT_DISPATCH',generatedAt:nowIso,boardPublishedAt:board?.publishedAt||null,
  boardAgeMs:Number.isFinite(boardAgeMs)?boardAgeMs:null,maximumBoardAgeMs:MAX_BOARD_AGE_MS,
  monitorHealth:board?.monitorHealth||'UNAVAILABLE',dispatchHealth:boardHealthy?'OK':'FAIL_CLOSED_STALE_OR_UNHEALTHY_BOARD',
  claudeShouldRun:Boolean(pendingAction)||seedLaneCandidates.length>0,claudeShouldPollMarket:false,executionNeeded:permittedCandidates.length>0||seedLaneCandidates.length>0,
  dispatchFingerprints:[...permittedCandidates.map(x=>x.fingerprint),...seedLaneCandidates.map(x=>x.fingerprint)],priorityOrder:['TRIGGER_1_STOP','TRIGGER_3_TARGET2','TRIGGER_2_TARGET1','BUY_TRIGGER','SEED_LANE_BUY_TRIGGER'],
  pendingAction,automaticStockCandidates,approvalCandidates:[],approvalBatchId:null,fallbackActions,seedLaneCandidates,
  multiStockPolicy:{enabled:true,maximumAutomaticCandidatesPerDispatch:MAX_NEW_BUYS_PER_DISPATCH,automaticQualifiedEntries:true,userApprovalRequired:false,oneWinnerDoesNotBlockOtherQualifiedStocks:true,rule:'Claude may execute already-qualified current-generation stock candidates automatically in rank order. Each order still requires a fingerprint claim, immediate live guard recheck, sizing calculation and broker reconciliation. Recompute remaining portfolio capacity after every confirmed fill and never force all available slots to be filled.'},
  queuedActions:permittedCandidates.filter(x=>!x.isActionable).map(x=>({ticker:x.ticker,trigger:x.trigger,fingerprint:x.fingerprint,isNew:x.isNew,isFresh:x.isFresh})),
  noActionInstruction:'If claudeShouldRun is false, stop immediately. Do not call Robinhood, research markets, or produce a long report.',
  actionInstruction:'Atomically claim each candidate fingerprint in private execution state before broker submission. Exit events always take priority and block every new buy for the run. For BUY_TRIGGER dispatches, process automaticStockCandidates in rank order without requesting user approval. Recheck each candidate independently immediately before submission; after every confirmed fill recompute cash, account floor, deployed capital, planned stop risk, correlation, portfolio heat, trade-frequency limits, protection capability and concurrent-position capacity. Skip any candidate that no longer qualifies. Seed-lane candidates are also automatic only while their current maxOrderUsd/maxConcurrentPositions limits, same-day stop exclusion, live account state and all normal safety gates still pass. Reconcile ambiguous or partial results by client order ID; never blindly retry an uncertain submission.',
  consumerContract:{invokeOnlyWhen:'claudeShouldRun === true',atomicClaimKey:'candidate.fingerprint',maximumNewBuysPerDispatch:MAX_NEW_BUYS_PER_DISPATCH,approvalMode:'NONE_AUTOMATIC',userApprovalRequired:false,automaticQualifiedStocks:true,multipleConcurrentStocksAllowed:true,fallbackRule:'Process already-qualified stock candidates in order. Failed candidates fall through. Confirmed fills reduce remaining capacity before the next candidate.',duplicateRule:'One fingerprint may create at most one broker order. Persist the claim outside this public repository before submission.',retryRule:'After an ambiguous response, reconcile by client order ID and broker state. Never create a replacement order until the original is conclusively cancelled or rejected.',creditRule:'Use one Claude run for the ordered candidate sequence where practical. Do not invoke Claude for unchanged fingerprints, unhealthy/stale boards, expired entries, order-status polling, or no-action reports.'},
  stockApprovalNotification:{needed:false,batchId:null,tickers:[],instruction:'Stock approval notifications are disabled because qualified stock entries are automatic.'},
  stopPriorityRule:'A stop event outranks profit targets and buys. When any exit event exists, do not evaluate or submit a new buy.',
  wakeBridge:{status:'DISPATCH_PACKET_READY_FOR_AUTOMATIC_EXECUTOR',note:'GitHub generates the event packet without an LLM. The authorized Claude runtime executes qualified stock and crypto actions through Robinhood MCP.'}
};

await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log(pendingAction?`New actionable dispatch: ${pendingAction.packet}; ${automaticStockCandidates.length} automatic stock candidate(s).`:seedLaneCandidates.length?`Automatic seed-lane dispatch: ${seedLaneCandidates.map(x=>x.packet).join(' || ')}.`:'Dispatch idle or suppressed: no new safe brokerage action.');
