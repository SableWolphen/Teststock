import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticExecutionPolicy} from './automatic-execution-policy.mjs';
test('automatic only never creates unverified risk',()=>{const r=automaticExecutionPolicy();assert.equal(r.mode,'AUTOMATIC_ONLY');assert.equal(r.manualHandoff,false);assert.equal(r.allowNewRisk,false)});
test('exit routing does not authorize a new entry',()=>{const r=automaticExecutionPolicy({isExit:true});assert.equal(r.allowNewRisk,false);assert.equal(r.action,'ATTEMPT_VERIFIED_RISK_REDUCING_EXIT')});
test('broker permission alone does not permit an entry',()=>{const r=automaticExecutionPolicy({attestation:{broker:{agenticAllowed:true}}});assert.equal(r.allowNewRisk,false)});

test('fresh affirmative runtime flags cannot bypass the canonical deployment lock',()=>{
 const now=Date.now();
 const capability={verifiedAt:new Date(now).toISOString(),liveOrderSubmission:true,liveEquityEntrySubmission:true,liveEquityExitSubmission:true};
 const attestation={broker:{agenticAllowed:true},scheduler:{healthy:true,exitEscalationVerified:true},reconciliation:{positions:true,orders:true,fills:true}};
 assert.equal(automaticExecutionPolicy({capability,attestation,now}).allowNewRisk,false);
});
