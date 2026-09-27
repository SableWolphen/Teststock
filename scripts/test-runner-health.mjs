import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRunnerHealth} from './runner-health.mjs';

const now=Date.parse('2026-09-27T18:00:00Z');
test('fresh private heartbeat proves the runner is active',()=>{
  const x=evaluateRunnerHealth({heartbeat:{state:'ACTIVE',updatedAt:'2026-09-27T17:58:00Z'},now});
  assert.equal(x.state,'ACTIVE');assert.equal(x.healthy,true);
});
test('recent failed workflow is unhealthy',()=>{
  const x=evaluateRunnerHealth({workflowRuns:[{id:1,status:'completed',conclusion:'failure',updated_at:'2026-09-27T17:59:00Z'}],now});
  assert.equal(x.state,'FAILURE');assert.equal(x.healthy,false);
});
test('recent successful session is healthy during the handoff gap',()=>{
  const x=evaluateRunnerHealth({workflowRuns:[{id:2,status:'completed',conclusion:'success',updated_at:'2026-09-27T17:10:00Z'}],now});
  assert.equal(x.state,'RECENTLY_COMPLETED');assert.equal(x.healthy,true);
});
test('old workflow evidence cannot report healthy',()=>{
  const x=evaluateRunnerHealth({workflowRuns:[{id:3,status:'completed',conclusion:'success',updated_at:'2026-09-27T15:00:00Z'}],now});
  assert.equal(x.state,'STALE');assert.equal(x.healthy,false);
});
