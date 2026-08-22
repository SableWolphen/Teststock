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
const actionMap={TRIGGER_1_STOP:'VERIFY_POSITION_AND_SELL_STOP',TRIGGER_3_TARGET2:'VERIFY_POSITION_AND_EXECUTE_TARGET2_OR_RUNNER',TRIGGER_2_TARGET1:'VERIFY_POSITION_AND_EXECUTE_TARGET1',BUY_TRIGGER:'VERIFY_LIVE_GUARDS_AND_REQUEST_APPROVAL_IF_STILL_ELIGIBLE'};
const ageMs=value=>{const timestamp=Date.parse(value||'');return Number.isFinite(timestamp)?Math.max(0,now.getTime()-timestamp):Infinity;};
const boardAgeMs=ageMs(board?.publishedAt);
const boardHealthy=board?.monitorHealth==='OK'&&boardAgeMs<=MAX_BOARD_AGE_MS;
const previousFingerprints=new Set(previous?.dispatchFingerprints||[previous?.pendingAction?.fingerprint].filter(Boolean));

const candidates=(board?.events||[]).filter(e=>priority[e.trigger]).map(e=>{
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
const compact=x=>({fingerprint:x.fingerprint,isNew:x.isNew,isActionable:x.isActionable,priority:x.priority,assetClass:x.assetClass,ticker:x.ticker,trigger:x.trigger,entryTier:x.entryTier??null,entryTierLabel:x.entryTierLabel??null,entryTierSizeMultiplier:x.entryTierSizeMultiplier??null,queueRank:x.queueRank??null,queueRole:x.queueRole??null,requestedAction:x.requestedAction,observedPrice:x.observedPrice,triggerStateChangedAt:x.stateChangedAt,triggerAgeMs:x.triggerAgeMs,expiresAt:x.expiresAt,reason:x.reason,packet:`${x.ticker} | ${x.trigger} | observed ${x.observedPrice ?? 'UNKNOWN'} | ${x.requestedAction}`});
const pendingAction=selected?compact(selected):null;
const actionableBuys=hasExitEvent?[]:actionableCandidates.filter(x=>x.trigger==='BUY_TRIGGER').slice(0,MAX_NEW_BUYS_PER_DISPATCH).map(compact);
const approvalCandidates=actionableBuys;
const fallbackActions=selected?.trigger==='BUY_TRIGGER'?actionableCandidates.filter(x=>x.trigger==='BUY_TRIGGER').slice(1).map(compact):[];

const out={
  schemaVersion:2,source:'TESTSTOCK_EVENT_DISPATCH',generatedAt:nowIso,boardPublishedAt:board?.publishedAt||null,
  boardAgeMs:Number.isFinite(boardAgeMs)?boardAgeMs:null,maximumBoardAgeMs:MAX_BOARD_AGE_MS,
  monitorHealth:board?.monitorHealth||'UNAVAILABLE',dispatchHealth:boardHealthy?'OK':'FAIL_CLOSED_STALE_OR_UNHEALTHY_BOARD',
  claudeShouldRun:Boolean(pendingAction),claudeShouldPollMarket:false,executionNeeded:permittedCandidates.length>0,
  dispatchFingerprints:permittedCandidates.map(x=>x.fingerprint),priorityOrder:['TRIGGER_1_STOP','TRIGGER_3_TARGET2','TRIGGER_2_TARGET1','BUY_TRIGGER'],
  pendingAction,approvalCandidates,fallbackActions,
  multiStockPolicy:{enabled:true,maximumApprovalCandidatesPerDispatch:MAX_NEW_BUYS_PER_DISPATCH,perOrderApprovalRequired:true,oneWinnerDoesNotBlockOtherQualifiedStocks:true,rule:'A tournament winner gets first priority, not exclusive ownership of the portfolio. After any approved/filled buy, continue evaluating the remaining already-qualified candidates against remaining cash, deployed-capital, planned-stop-risk, correlation, frequency, protection and concurrent-position limits. Never force the portfolio to its maximum.'},
  queuedActions:permittedCandidates.filter(x=>!x.isActionable).map(x=>({ticker:x.ticker,trigger:x.trigger,fingerprint:x.fingerprint,isNew:x.isNew,isFresh:x.isFresh})),
  noActionInstruction:'If claudeShouldRun is false, stop immediately. Do not call Robinhood, fetch the full signal, research markets, or produce a long report.',
  actionInstruction:'Atomically claim each candidate fingerprint in private execution state before any broker action. Exit events always take priority and exclude new buys. For BUY_TRIGGER dispatches, evaluate approvalCandidates in rank order. A live-qualified candidate may be presented for its own exact user approval even when another Teststock stock is already open. After each approved fill, recompute remaining cash, account floor, total deployed capital, planned stop risk, correlation, trade-frequency limits, protection capability and concurrent-position capacity before considering the next candidate. Do not reuse one approval for another ticker. If a candidate fails before submission, continue to the next already-qualified candidate in the same run. Never force a trade or fill every available slot. Reconcile ambiguous or partial results by client order ID; never retry an uncertain submission as a new order.',
  consumerContract:{invokeOnlyWhen:'claudeShouldRun === true',atomicClaimKey:'candidate.fingerprint',maximumNewBuysPerDispatch:MAX_NEW_BUYS_PER_DISPATCH,perOrderApprovalRequired:true,multipleConcurrentStocksAllowed:true,fallbackRule:'Process already-qualified stock candidates in order. Failed candidates fall through. Successfully approved and filled candidates do not end scanning if remaining portfolio capacity exists.',duplicateRule:'One fingerprint may create at most one broker order. Persist the claim outside this public repository before submission.',retryRule:'After an ambiguous response, reconcile by client order ID and broker state. Never create a replacement order until the original is conclusively cancelled or rejected.',creditRule:'Use one Claude run for the ordered candidate sequence where practical. Do not invoke Claude for unchanged fingerprints, unhealthy/stale boards, expired entries, order-status polling, or no-action reports.'},
  stopPriorityRule:'A stop event outranks profit targets and buys. When any exit event exists, do not evaluate or submit a new buy.',
  wakeBridge:{status:'DISPATCH_PACKET_READY_NO_DIRECT_CLAUDE_WEBHOOK',note:'GitHub generates the event packet without an LLM. An authorized execution runtime must fetch this packet or be triggered externally.'}
};

await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log(pendingAction?`New actionable dispatch: ${pendingAction.packet}; ${approvalCandidates.length} approval candidate(s), ${fallbackActions.length} fallback(s).`:'Dispatch idle or suppressed: no new safe brokerage action.');
