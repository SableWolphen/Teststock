import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/fast-opportunity-refresh.yml', import.meta.url), 'utf8');

test('fast refresh regenerates stock freshness-critical dependencies before signal validation', () => {
  const entryGate = workflow.indexOf('node scripts/validate-entry-gates.mjs');
  const optionsPolicy = workflow.indexOf('node scripts/apply-options-policy.mjs');
  const optionsValidation = workflow.indexOf('node scripts/validate-options-policy.mjs');
  const signalBuild = workflow.indexOf('node scripts/build-agent-signal.mjs');
  const signalValidation = workflow.indexOf('node scripts/validate-signal.mjs docs/signal.json');

  for (const position of [entryGate, optionsPolicy, optionsValidation, signalBuild, signalValidation]) {
    assert.notEqual(position, -1);
  }
  assert.ok(entryGate < signalBuild);
  assert.ok(optionsPolicy < signalBuild);
  assert.ok(optionsValidation < signalBuild);
  assert.ok(signalBuild < signalValidation);
  assert.equal(workflow.includes('node scripts/generate-crypto-picks.mjs'), false);
  assert.equal(workflow.includes('node scripts/update-crypto-shadow-ledger.mjs'), false);
});