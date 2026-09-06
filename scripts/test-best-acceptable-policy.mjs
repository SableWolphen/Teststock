import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
test('A and B candidates coexist while B sizing stays capped', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'teststock-ab-'));
  await fs.mkdir(path.join(dir, 'docs/data'), {recursive:true});
  await fs.writeFile(path.join(dir, 'docs/signal.json'), JSON.stringify({stockPlan:{stockOrders:[],stockCandidateQueue:[{ticker:'B',queueRank:1},{ticker:'A',queueRank:2},{ticker:'SMALL',queueRank:3}]}}));
  await fs.writeFile(path.join(dir, 'docs/data/growth-plan-500.json'), JSON.stringify({qualifiedCandidateQueue:[{symbol:'A',entryTier:'A',entryTierSizeMultiplier:1},{symbol:'B',entryTier:'B',entryTierSizeMultiplier:.5},{symbol:'SMALL',entryTier:'B',entryTierSizeMultiplier:.1}]}));
  await exec(process.execPath, [fileURLToPath(new URL('./apply-best-acceptable-policy.mjs',import.meta.url))], {cwd:dir});
  const {stockPlan:p} = JSON.parse(await fs.readFile(path.join(dir,'docs/signal.json'),'utf8'));
  assert.deepEqual(p.stockCandidateQueue.map(x=>x.ticker), ['A','B','SMALL']);
  assert.deepEqual(p.stockCandidateQueue.map(x=>x.entryTierSizeMultiplier), [1,.25,.1]);
  assert.equal(p.bestAcceptableEntryPolicy.bTier.sizeMultiplier,.25);
  assert.match(p.bestAcceptableEntryPolicy.executionRule,/including after an A fill/);
  assert.ok(p.bestAcceptableEntryPolicy.neverRelax.includes('protective exit requirements'));
  assert.ok(p.bestAcceptableEntryPolicy.neverRelax.includes('daily/weekly loss brakes'));
});
