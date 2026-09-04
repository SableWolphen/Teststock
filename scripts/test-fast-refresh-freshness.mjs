import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/fast-opportunity-refresh.yml', import.meta.url), 'utf8');

test('fast refresh regenerates all freshness-critical dependencies before signal validation', () => {
  const entryGate = workflow.indexOf('node scripts/validate-entry-gates.mjs');
  const crypto = workflow.indexOf('node scripts/generate-crypto-picks.mjs');
  const cryptoLedger = workflow.indexOf('node scripts/update-crypto-shadow-ledger.mjs');
  const cryptoAdmission = workflow.indexOf('node scripts/apply-crypto-profitability-admission.mjs');
  const signalBuild = workflow.indexOf('node scripts/build-agent-signal.mjs');
  const signalValidation = workflow.indexOf('node scripts/validate-signal.mjs docs/signal.json');

  for (const position of [entryGate, crypto, cryptoLedger, cryptoAdmission, signalBuild, signalValidation]) {
    assert.notEqual(position, -1);
  }
  assert.ok(entryGate < signalBuild);
  assert.ok(crypto < cryptoLedger);
  assert.ok(cryptoLedger < cryptoAdmission);
  assert.ok(cryptoAdmission < signalBuild);
  assert.ok(signalBuild < signalValidation);
});
