// Deterministic, event-driven option exit watch state.
// Invoke for every *broker-confirmed* option quote tick from a separate, authorized feed.
// This helper cannot place, cancel, or replace a Robinhood order.
import {planOptionProfitExit} from './option-fast-profit-exit.mjs';

export function advanceOptionExitWatch({previous=null,quote={},position={},session={},now=Date.now()}={}){
  const id=position.contractId;
  const validTime=Number.isFinite(now);
  const quoteTime=Date.parse(quote.observedAt||'');
  if(!id||typeof id!=='string'||!validTime||!Number.isFinite(quoteTime)){
    return {state:previous,packet:null,reason:'IDENTITY_OR_QUOTE_TIME_MISSING'};
  }
  if(previous?.contractId && previous.contractId!==id){
    return {state:previous,packet:null,reason:'CONTRACT_ID_MISMATCH'};
  }
  if(previous?.lastQuoteTime && quoteTime<=Date.parse(previous.lastQuoteTime)){
    return {state:previous,packet:null,reason:'OUT_OF_ORDER_OR_DUPLICATE_QUOTE'};
  }
  const planned=planOptionProfitExit({
    entryAsk:position.confirmedEntryAsk,
    bid:quote.bid,ask:quote.ask,
    highestConfirmedBid:previous?.highestConfirmedBid??null,
    quantity:position.confirmedOpenQuantity,
    quoteAgeMs:now-quoteTime,
    knownExitFeesUsd:position.knownExitFeesUsd??0,
    brokerPositionConfirmed:position.brokerConfirmed===true,
    openExitOrder:position.workingExitOrder===true,
    sessionOpen:session.open===true,
    sessionExitDeadline:session.exitDeadline===true,
    thesisInvalidated:position.thesisInvalidated===true
  });
  // Never advance trusted state on invalid or unreconciled data.
  if(planned.action==='RECONCILE_OR_WAIT'){
    return {state:previous,packet:null,reason:planned.blockers.join(',')};
  }
  const state={
    contractId:id, lastQuoteTime:quote.observedAt,
    highestConfirmedBid:planned.highestConfirmedBid,
    lastExitReviewFingerprint:previous?.lastExitReviewFingerprint??null
  };
  if(planned.action!=='EXIT_REVIEW_NOW')return {state,packet:null,reason:'MONITORING'};
  // One logical review per contract/reason. Further broker actions require
  // fresh reconciliation, not repeated submissions on every tick.
  const fingerprint=id+':'+planned.reason;
  if(fingerprint===state.lastExitReviewFingerprint)return {state,packet:null,reason:'EXIT_REVIEW_ALREADY_RAISED'};
  state.lastExitReviewFingerprint=fingerprint;
  return {state,packet:{...planned,contractId:id,fingerprint,brokerWriteAuthorized:false},reason:'EXIT_REVIEW_RAISED'};
}
