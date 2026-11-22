import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {measuredNumber} from './performance-evidence.mjs';

const scripts=path.dirname(fileURLToPath(import.meta.url));
async function fixture(t, files) {
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'teststock-evidence-'));
  t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  await fs.mkdir(path.join(cwd,'docs/data'),{recursive:true});
  for(const [file,value] of Object.entries(files)) await fs.writeFile(path.join(cwd,file),JSON.stringify(value));
  return {
    run(name) {const r=spawnSync(process.execPath,[path.join(scripts,name)],{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr);},
    async read(file) {return JSON.parse(await fs.readFile(path.join(cwd,file),'utf8'));}
  };
}

test('unknown numeric measurements never become zero',()=>{
  for(const x of [null,undefined,'','  ',true,false,[],{},NaN,Infinity,'bad']) assert.equal(measuredNumber(x),false);
  for(const x of [0,-1,1.5,'0','-1.5']) assert.equal(measuredNumber(x),true);
});

test('admission excludes rejected research, unconfirmed fills and missing R',async t=>{
  const shadow=Array.from({length:200},(_,i)=>({status:'RESOLVED',decision:'REJECTED',symbol:`S${i}`,createdDate:`2026-08-${String(1+i%28).padStart(2,'0')}`,setupType:'TREND',runtimeRegime:'UPTREND',realizedR:2}));
  const real=shadow.map((x,i)=>({...x,assetClass:'STOCK',outcome:'WIN',reconciledFromRobinhood:false,entryFilledAt:`${x.createdDate}T15:00:00Z`,symbol:`R${i}`}));
  const f=await fixture(t,{
    'docs/signal.json':{},
    'docs/data/stock-tournament.json':{adaptiveLearning:{currentRegime:'UPTREND'},liveQueue:[{ticker:'ABC',setupType:'TREND',entryTier:'A',action:'AUTO_BUY_ELIGIBLE'}]},
    'docs/data/shadow-trades.json':{trades:shadow},
    'docs/data/real-trade-journal.json':{trades:real}
  });
  f.run('apply-profitability-admission.mjs');
  let row=(await f.read('docs/data/stock-tournament.json')).liveQueue[0];
  assert.equal(row.profitabilityAdmission.state,'SHADOW_ONLY');
  assert.equal(row.profitabilityAdmission.shadow.samples,0);
  // Genuine accepted outcomes still support evidence-based reduced probation.
  const accepted=shadow.map(x=>({...x,decision:'ACCEPTED'}));
  const g=await fixture(t,{
    'docs/signal.json':{},
    'docs/data/stock-tournament.json':{adaptiveLearning:{currentRegime:'UPTREND'},liveQueue:[{ticker:'ABC',setupType:'TREND',entryTier:'A',action:'AUTO_BUY_ELIGIBLE'}]},
    'docs/data/shadow-trades.json':{trades:[...accepted,...accepted.map(x=>({...x,symbol:`NULL${x.symbol}`,realizedR:null}))]}
  });
  g.run('apply-profitability-admission.mjs');
  row=(await g.read('docs/data/stock-tournament.json')).liveQueue[0];
  assert.equal(row.profitabilityAdmission.state,'MICRO_PROBATION');
  assert.equal(row.profitabilityAdmission.shadow.samples,200);
  assert.equal(row.adaptiveSizeMultiplier,.25);
  const h=await fixture(t,{
    'docs/signal.json':{},
    'docs/data/stock-tournament.json':{adaptiveLearning:{currentRegime:'UPTREND'},liveQueue:[{ticker:'ABC',setupType:'TREND',action:'AUTO_BUY_ELIGIBLE'}]},
    'docs/data/shadow-trades.json':{trades:accepted.map(x=>({...x,realizedR:.05}))}
  });
  h.run('apply-profitability-admission.mjs');
  row=(await h.read('docs/data/stock-tournament.json')).liveQueue[0];
  assert.equal(row.profitabilityAdmission.state,'SHADOW_ONLY','generator must meet the validator minimum of 0.10R');
});

test('adaptive performance preserves unknown dollar P&L and execution measurements',async t=>{
  const base={assetClass:'STOCK',reconciledFromRobinhood:true,outcome:'LOSS',realizedR:-1,realizedPnlDollars:null,adverseEntrySlippagePct:null};
  const f=await fixture(t,{'docs/data/real-trade-journal.json':{trades:[base,{...base,realizedR:null},{...base,reconciledFromRobinhood:false},{...base,realizedR:2,outcome:'WIN',realizedPnlDollars:5}]}});
  f.run('build-adaptive-performance.mjs');
  const r=await f.read('docs/data/adaptive-performance.json');
  assert.equal(r.resolvedRealStockTrades,2);
  assert.equal(r.overall.averageRealizedR,.5);
  assert.equal(r.overall.realizedPnlDollars,null);
  assert.equal(r.overall.knownRealizedPnlDollars,5);
  assert.equal(r.overall.realizedPnlSamples,1);
  assert.equal(r.overall.missingRealizedPnlSamples,1);
  assert.equal(r.executionQuality.confirmedEntrySlippageSamples,0);
  assert.equal(r.executionQuality.averageAdverseEntrySlippagePct,null);
  assert.ok(r.recentTrades.some(x=>x.realizedPnlDollars===null));
});
