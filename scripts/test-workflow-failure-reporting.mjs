import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const workflow=fs.readFileSync('.github/workflows/live-intraday-runner.yml','utf8');
test('runner cannot turn an unavailable authoritative clock into a green closed-market skip',()=>{
 const step=workflow.split('      - name: Check regular US stock session')[1].split('      - name: Run concurrent trading')[0];
 assert.match(step,/else\s+echo "open=false"[^]*?::error::[^]*?exit 1/);
});
const health=fs.readFileSync('.github/workflows/trading-health.yml','utf8');
test('health runs after failed research and publishes only health from published generations',()=>{
 assert.doesNotMatch(health,/workflow_run.conclusion == 'success'/);
 assert.doesNotMatch(health,/node scripts\/update-trigger-board.mjs/);
 assert.match(health,/if: always\(\)\s+run: node scripts\/build-live-trading-health.mjs/);
 assert.match(health,/git add \\\s+docs\/data\/live-trading-health.json/);
});
