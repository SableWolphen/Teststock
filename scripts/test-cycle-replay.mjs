import test from 'node:test';
import assert from 'node:assert/strict';
import {replayCycle} from './run-cycle-replay.mjs';
test('complete fixture cycle reconciles partial entry, protection, exit and restart without granting authority',()=>{
 const report=replayCycle();assert.equal(report.passed,true);assert.equal(report.liveCycleVerified,false);assert.equal(report.brokerWrites,false);assert.equal(report.realMoneyEnabled,false);
 assert.deepEqual(report.steps.map(s=>s.stage),['REAL_ENTRY_GATE','SIMULATED_ENTRY_ACK','AMBIGUOUS_ACK','PARTIAL_FILL','SIMULATED_STOP_ACK','OUTAGE_STALE_SNAPSHOT','PENDING_STOP_CANCEL','WORKING_EXIT','FLAT_RECONCILIATION','RESTART_REPLAY']);
});
