import fs from 'node:fs/promises';

const BOARD='docs/data/trigger-board.json';
const OUT='docs/data/execution-dispatch.json';
const read=async(f,x)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const board=await read(BOARD,null);
const previous=await read(OUT,null);
const nowIso=new Date().toISOString();

const priority={TRIGGER_1_STOP:100,TRIGGER_3_TARGET2:80,TRIGGER_2_TARGET1:70,BUY_TRIGGER:50};
const actionMap={
  TRIGGER_1_STOP:'VERIFY_POSITION_AND_SELL_STOP',
  TRIGGER_3_TARGET2:'VERIFY_POSITION_AND_EXECUTE_TARGET2_OR_RUNNER',
  TRIGGER_2_TARGET1:'VERIFY_POSITION_AND_EXECUTE_TARGET1',
  BUY_TRIGGER:'VERIFY_LIVE_GUARDS_AND_BUY_IF_STILL_ELIGIBLE'
};

const boardHealthy=board?.monitorHealth==='OK';
const candidates=(board?.events||[])
  .filter(e=>priority[e.trigger])
  .map(e=>({...e,priority:priority[e.trigger],requestedAction:actionMap[e.trigger]}))
  .sort((a,b)=>b.priority-a.priority||String(a.ticker).localeCompare(String(b.ticker)));

const selected=boardHealthy?(candidates[0]||null):null;
const fingerprint=selected?`${selected.id}|${selected.trigger}|${selected.stateChangedAt}`:null;
const prevFingerprint=previous?.pendingAction?.fingerprint||null;
const isNew=Boolean(selected&&fingerprint!==prevFingerprint);

const pendingAction=selected?{
  fingerprint,
  isNew,
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
  monitorHealth:board?.monitorHealth||'UNAVAILABLE',
  claudeShouldRun:Boolean(pendingAction),
  claudeShouldPollMarket:false,
  priorityOrder:['TRIGGER_1_STOP','TRIGGER_3_TARGET2','TRIGGER_2_TARGET1','BUY_TRIGGER'],
  pendingAction,
  queuedActions:boardHealthy?candidates.slice(1).map(x=>({ticker:x.ticker,trigger:x.trigger,priority:x.priority,stateChangedAt:x.stateChangedAt})):[],
  noActionInstruction:'If claudeShouldRun is false, stop immediately. Do not call Robinhood, fetch the full signal, research markets, or produce a long report.',
  actionInstruction:'If claudeShouldRun is true, use only this trigger as the wake reason. Then fetch the fresh Teststock signal and live Robinhood state, verify every applicable safety guard, execute only the requested brokerage action when permitted, verify the resulting order/fill/position state, update the private real-trade journal, and arm/update the public non-sensitive execution watchlist only after confirmed fills.',
  stopPriorityRule:'A stop event outranks profit targets and buys. Never delay a stop event to process a lower-priority action first.',
  wakeBridge:{
    status:'DISPATCH_PACKET_READY_NO_DIRECT_CLAUDE_WEBHOOK',
    note:'GitHub generates the event packet without an LLM. This repository still cannot directly invoke the Claude/Robinhood runtime. An authorized execution runtime must fetch this packet or be triggered externally.'
  }
};

await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log(pendingAction?`Dispatch ready: ${pendingAction.packet}`:'Dispatch idle: no brokerage action needed.');
