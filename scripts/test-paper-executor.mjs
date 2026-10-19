import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePaperDispatch } from './paper-executor.mjs';
const dispatch = {manualExecutionOnly:true,executorCapability:{mode:'MANUAL_ONLY_FAIL_CLOSED'},optionEntryAllowed:false,equityEntryAllowed:false};
const broker = {unleveragedCash:62,positions:[],orders:[]};
test('never sends live orders even with valid snapshots',()=>{
 const r=evaluatePaperDispatch(dispatch,broker);
 assert.equal(r.mode,'PAPER_ONLY'); assert.equal(r.decision,'NO_ACTION');
 assert.deepEqual(r.reasons,['LIVE_EXECUTION_DISABLED']);
});
test('unprotected broker positions block',()=>{
 const r=evaluatePaperDispatch(dispatch,{...broker,positions:[{symbol:'TEST',protectiveOrderVerified:false}]});
 assert.ok(r.reasons.includes('UNPROTECTED_POSITION'));
});
test('ambiguous order blocks',()=>{
 const r=evaluatePaperDispatch(dispatch,{...broker,orders:[{status:'unknown'}]});
 assert.ok(r.reasons.includes('AMBIGUOUS_ORDER'));
});
test('missing account data fails closed',()=>{
 assert.equal(evaluatePaperDispatch(dispatch,{}).decision,'NO_ACTION');
});
test('unexpected entry permission fails closed',()=>{
 const r=evaluatePaperDispatch({...dispatch,optionEntryAllowed:true},broker);
 assert.ok(r.reasons.includes('UNEXPECTED_ENTRY_AUTHORIZATION'));
});
