import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./apply-decision-intelligence.mjs', import.meta.url), 'utf8');

test('decision intelligence preserves upstream seed-lane eligibility', () => {
  assert.match(source, /const eligibleForSeedLane=row\.seedLane\?\.eligible===true;/);
  assert.match(source, /const eligibleForDayTradeSeedLane=row\.dayTradeSeedLane\?\.eligible===true;/);
  assert.doesNotMatch(source, /seedDecisionPass/);
});
