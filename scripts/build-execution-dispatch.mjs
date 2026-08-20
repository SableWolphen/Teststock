import fs from 'node:fs/promises';

const BOARD='docs/data/trigger-board.json';
const OUT='docs/data/execution-dispatch.json';
const read=async(f,x)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const board=await read(BOARD,null);
const previous=await read(OUT,null);
const now=new Date();
const nowIso=now.toISOString();
const MAX_BOARD_AGE_MS=15*60*1000;
const MAX_ENTRY_AGE_MS=10*60*1000;

const priority={TRIGGER_1_STOP:100,TRIGGER_3_TARGET2:80,TRIGGER_2_TARGET1:70,BUY_TRIGGER:50};
const actionMap={
  TRIGGER_1_STOP:'VERIFY_POSITION_AND_SELL_STOP',
  TRIGGER_3_TARGET2:'VERIFY_POSITION_AND_EXECUTE_TARGET2_OR_RUNNER',
  TRIGGER_2_TARGET1:'VERIFY_POSITION_AND_EXECUTE_TARGET1',
  BUY_TRIGGER:'VERIFY_LIVE_GUARDS_AND_BUY_IF_STILL_ELIGIBLE'
};

const ageMs=value=>{
  const timestamp=Date.parse(value||'');
  return Number.isFinite(timestamp)?Math.max(0,now.getTime()-timestamp):Infinity;
};
const boardAgeMs=ageMs(board?.publishedAt);
const boardHealthy=board?.monitorHealth==='OK'&&boardAgeMs<=MAX_BOARD_AGE_MS;
const candidates=(board?.events||[])
  .filter(e=>priority[e.trigger])
  .map(e=>({...e,priority:priority[e.trigger],requestedAction:actionMap[e.trigger]}))
  .sort((a,b)=>b.priority-a.priority||String(a.ticker).localeCompare(String(b.ticker)));

const selected=boardHealthy?(candidates[0]||null):null;
const fingerprint=selected?`${selected.id}|${selected.trigger}|${selected.stateChangedAt}`:null;
const prevFingerprint=previous?.pendingAction?.fingerprint||null;
const isNew=Boolean(selected&&fingerprint!==prevFingerprint);
const triggerAgeMs=selected?ageMs(selected.stateChangedAt):null;
const isEntryFresh=selected?.trigger!=='BUY_TRIGGER'||triggerAgeMs<=MAX_ENTRY_AGE_MS;
const isActionable=Boolean(selected&&isNew&&isEntryFresh);

const pendingAction=selected?{
  fingerprint,
  isNew,
  isActionable,
  triggerAgeMs,
  expiresAt:selected.trigger==='BUY_TRIGGER'
    ?new Date(Date.parse(selected.stateChangedAt)+MAX_ENTRY_AGE_MS).toISOString()
    :null,
  priority:selected.priority,
  assetClass:selected.assetClass,
  ticker:selected.ticker,
  trigger:selected.trigger,
  requestedAction:selected.requestedAction,
  observedPrice:selected.observedPrice,
  triggerStateChangedAt:selected.stateChangedAt,
  reason:selected.reason,
  packet:`${selected.ticker} | ${selected.trigger} | observed ${selected.observedPrice ?? 'UNKNOWN'} | ${selected.requestedAction}`
}:null;

const out={
  schemaVersion:1,
  source:'TESTSTOCK_EVENT_DISPATCH',
  generatedAt:nowIso,
  boardPublishedAt:board?.publishedAt||null,
  boardAgeMs:Number.isFinite(boardAgeMs)?boardAgeMs:null,
  maximumBoardAgeMs:MAX_BOARD_AGE_MS,
  monitorHealth:board?.monitorHealth||'UNAVAILABLE',
  dispatchHealth:boardHealthy?'OK':'FAIL_CLOSED_STALE_OR_UNHEALTHY_BOARD',
  claudeShouldRun:isActionable,
  executionNeeded:Boolean(pendingAction),
  claudeShouldPollMarket:false,
  priorityOrder:['TRIGGER_1_STOP','TRIGGER_3_TARGET2','TRIGGER_2_TARGET1','BUY_TRIGGER'],
  pendingAction,
  queuedActions:boardHealthy?candidates.slice(1).map(x=>({ticker:x.ticker,trigger:x.trigger,priority:x.priority,stateChangedAt:x.stateChangedAt})):[],
  noActionInstruction:'If claudeShouldRun is false, stop immediately. Do not call Robinhood, fetch the full signal, research markets, or produce a long report.',
  actionInstruction:'If claudeShouldRun is true, atomically claim pendingAction.fingerprint in private execution state before any broker action. If it was already claimed, submitted, filled, rejected, or cancelled, stop without submitting another order. Fetch only the fresh Teststock signal and minimal live Robinhood account, position, open-order and quote state. Reject expired entries or entries outside their saved price range. Execute only the requested action when every guard passes. Reconcile ambiguous or partial results by client order ID; never retry an uncertain submission as a new order. Verify the final order/fill/position state, update the private real-trade journal, and arm/update the public non-sensitive execution watchlist only after confirmed fills.',
  consumerContract:{
    invokeOnlyWhen:'claudeShouldRun === true AND pendingAction.isActionable === true',
    atomicClaimKey:'pendingAction.fingerprint',
    duplicateRule:'One fingerprint may create at most one broker order. Persist the claim outside this public repository before submission.',
    retryRule:'After an ambiguous response, reconcile by client order ID and broker state. Never create a replacement order until the original is conclusively cancelled or rejected.',
    creditRule:'Do not invoke Claude for unchanged fingerprints, unhealthy/stale boards, expired entries, order-status polling, or no-action reports.'
  },
  stopPriorityRule:'A stop event outranks profit targets and buys. Never delay a stop event to process a lower-priority action first.',
  wakeBridge:{
    status:'DISPATCH_PACKET_READY_NO_DIRECT_CLAUDE_WEBHOOK',
    note:'GitHub generates the event packet without an LLM. This repository still cannot directly invoke the Claude/Robinhood runtime. An authorized execution runtime must fetch this packet or be triggered externally.'
  }
};

await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log(isActionable?`New actionable dispatch: ${pendingAction.packet}`:pendingAction?'Dispatch suppressed: duplicate, stale, or unhealthy.':'Dispatch idle: no brokerage action needed.');
