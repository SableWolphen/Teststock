import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/fast-opportunity-refresh.yml', import.meta.url), 'utf8');

test('fast refresh reuses validated heavy research and rebuilds live signal/option policy', () => {
  const researchReuse = workflow.indexOf('test -s docs/data/entry-gate-validation.json');
  const optionsPolicy = workflow.indexOf('node scripts/apply-options-policy.mjs');
  const optionsValidation = workflow.indexOf('node scripts/validate-options-policy.mjs');
  const signalBuild = workflow.indexOf('node scripts/build-agent-signal.mjs');
  const signalValidation = workflow.indexOf('node scripts/validate-signal.mjs docs/signal.json');

  for (const position of [researchReuse, optionsPolicy, optionsValidation, signalBuild, signalValidation]) {
    assert.notEqual(position, -1);
  }
  assert.ok(researchReuse < signalBuild);
  assert.equal(workflow.includes('node scripts/validate-entry-gates.mjs'), false);
  assert.equal(workflow.includes('node scripts/scan-small-account-options.mjs'), false);
  assert.equal(workflow.includes('node scripts/update-options-shadow-ledger.mjs'), false);
  assert.ok(optionsPolicy < signalValidation);
  assert.ok(optionsValidation !== -1);
  assert.ok(signalBuild < signalValidation);
  assert.equal(workflow.includes('node scripts/generate-crypto-picks.mjs'), false);
  assert.equal(workflow.includes('node scripts/update-crypto-shadow-ledger.mjs'), false);
});