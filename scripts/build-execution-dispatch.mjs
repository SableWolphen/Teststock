import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

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
const actionableBuys=hasExitEvent?[]:actionableCandidates.filter(x=>x.trigger==='BUY_TRIGGER').slice(0,MAX_NEW_BUYS_PER_DISPATCH).map(compact);
const approvalCandidates=actionableBuys;
const approvalBatchId=approvalCandidates.length?createHash('sha256').update(approvalCandidates.map(x=>x.fingerprint).join('\n')).digest('hex').slice(0,16):null;
const fallbackActions=selected?.trigger==='BUY_TRIGGER'?actionableCandidates.filter(x=>x.trigger==='BUY_TRIGGER').slice(1).map(compact):[];

const out={
  schemaVersion:3,source:'TESTSTOCK_EVENT_DISPATCH',generatedAt:nowIso,boardPublishedAt:board?.publishedAt||null,
  boardAgeMs:Number.isFinite(boardAgeMs)?boardAgeMs:null,maximumBoardAgeMs:MAX_BOARD_AGE_MS,
  monitorHealth:board?.monitorHealth||'UNAVAILABLE',dispatchHealth:boardHealthy?'OK':'FAIL_CLOSED_STALE_OR_UNHEALTHY_BOARD',
  claudeShouldRun:Boolean(pendingAction),claudeShouldPollMarket:false,executionNeeded:permittedCandidates.length>0,
  dispatchFingerprints:permittedCandidates.map(x=>x.fingerprint),priorityOrder:['TRIGGER_1_STOP','TRIGGER_3_TARGET2','TRIGGER_2_TARGET1','BUY_TRIGGER'],
  pendingAction,approvalCandidates,approvalBatchId,fallbackActions,
  multiStockPolicy:{enabled:true,maximumApprovalCandidatesPerDispatch:MAX_NEW_BUYS_PER_DISPATCH,exactBatchApprovalAllowed:true,blanketFutureApprovalAllowed:false,oneWinnerDoesNotBlockOtherQualifiedStocks:true,rule:'The user may approve every exact ticker in the current approval batch with one explicit approval. That approval applies only to the listed batch ID and expires with the candidates. Each broker order still requires its own fingerprint claim, live guard recheck, sizing calculation and broker reconciliation. A tournament winner gets first priority, not exclusive ownership of the portfolio. Never force the portfolio to its maximum.'},
  queuedActions:permittedCandidates.filter(x=>!x.isActionable).map(x=>({ticker:x.ticker,trigger:x.trigger,fingerprint:x.fingerprint,isNew:x.isNew,isFresh:x.isFresh})),
  noActionInstruction:'If claudeShouldRun is false, stop immediately. Do not call Robinhood, fetch the full signal, research markets, or produce a long report.',
  actionInstruction:'Atomically claim each candidate fingerprint in private execution state before any broker action. Exit events always take priority and exclude new buys. For BUY_TRIGGER dispatches, present approvalCandidates together as one exact approval batch when practical. The user may approve the entire current batch in one explicit response, but that approval must be bound to approvalBatchId and may never authorize future or newly-added candidates. After approval, recheck each candidate independently immediately before submission. After each approved fill, recompute remaining cash, account floor, total deployed capital, planned stop risk, correlation, trade-frequency limits, protection capability and concurrent-position capacity before considering the next candidate. If a candidate fails before submission, skip it and continue to the next approved candidate in the same batch. Never force a trade or fill every available slot. Reconcile ambiguous or partial results by client order ID; never retry an uncertain submission as a new order.',
  consumerContract:{invokeOnlyWhen:'claudeShouldRun === true',atomicClaimKey:'candidate.fingerprint',maximumNewBuysPerDispatch:MAX_NEW_BUYS_PER_DISPATCH,approvalMode:'EXACT_CURRENT_BATCH',exactBatchApprovalAllowed:true,blanketFutureApprovalAllowed:false,multipleConcurrentStocksAllowed:true,fallbackRule:'Process already-qualified stock candidates in order. Failed candidates fall through. Successfully approved and filled candidates do not end scanning if remaining portfolio capacity exists.',duplicateRule:'One fingerprint may create at most one broker order. Persist the claim outside this public repository before submission.',retryRule:'After an ambiguous response, reconcile by client order ID and broker state. Never create a replacement order until the original is conclusively cancelled or rejected.',creditRule:'Use one Claude run for the ordered candidate sequence where practical. Do not invoke Claude for unchanged fingerprints, unhealthy/stale boards, expired entries, order-status polling, or no-action reports.'},
  stockApprovalNotification:{needed:approvalCandidates.length>0,batchId:approvalBatchId,tickers:approvalCandidates.map(x=>x.ticker),instruction:'Send one push alert for this exact current batch. The user can approve all listed tickers at once, but each candidate must still pass live guards before its individual broker order is submitted.'},
  stopPriorityRule:'A stop event outranks profit targets and buys. When any exit event exists, do not evaluate or submit a new buy.',
  wakeBridge:{status:'DISPATCH_PACKET_READY_FOR_NOTIFICATION_BRIDGE',note:'GitHub generates the event packet without an LLM. The monitor workflow emits a GitHub notification for exact stock approval batches; an authorized execution runtime still performs broker actions.'}
};

await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log(pendingAction?`New actionable dispatch: ${pendingAction.packet}; ${approvalCandidates.length} approval candidate(s), batch ${approvalBatchId||'NONE'}.`:'Dispatch idle or suppressed: no new safe brokerage action.');
