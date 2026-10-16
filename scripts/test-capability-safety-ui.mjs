import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dispatch=fs.readFileSync('scripts/build-execution-dispatch.mjs','utf8');
const ui=fs.readFileSync('src/App.jsx','utf8');

test('entry authorization requires a recent execution capability attestation',()=>{
  assert.match(dispatch,/capabilityFresh=Number\.isFinite\(capabilityVerifiedAtMs\)/);
  assert.match(dispatch,/now\.getTime\(\)-capabilityVerifiedAtMs<=60\*60\*1000/);
  assert.match(dispatch,/executorOptionEntryAllowed=capabilityFresh&&/);
  assert.match(dispatch,/executorEquityEntryAllowed=capabilityFresh&&/);
});

test('options require independently verified same-session exit capability',()=>{
  assert.match(dispatch,/liveOptionExitSubmission===true&&executorCapability\.liveOptionExitVerifiedThisSession===true/);
  assert.match(ui,/liveOptionExitVerifiedThisSession === true/);
  assert.match(ui,/MANUAL_ONLY_BLOCKED/);
});

test('options buy request is not generated while execution is blocked',()=>{
  assert.match(ui,/if\(!liveOptionsReady\)\{setOptionNotice\('MANUAL_ONLY_BLOCKED:/);
});
