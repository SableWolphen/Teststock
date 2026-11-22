import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {measuredNumber,independentOutcomes} from './performance-evidence.mjs';

const scripts=path.dirname(fileURLToPath(import.meta.url));
async function fixture(t, files) {
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'teststock-evidence-'));
  t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  await fs.mkdir(path.join(cwd,'docs/data'),{recursive:true});
  for(const [file,value] of Object.entries(files)) await fs.writeFile(path.join(cwd,file),JSON.stringify(value));
  return {
    run(name,success=true) {const r=spawnSync(process.execPath,[path.join(scripts,name)],{cwd,encoding:'utf8'});assert.equal(r.status===0,success,r.stderr);},
    async write(file,value) {await fs.writeFile(path.join(cwd,file),JSON.stringify(value));},
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

test('independent samples require valid dates and collapse case variants conservatively',()=>{
  const row={symbol:'ABC',createdDate:'2026-09-01',realizedR:2};
  const rows=independentOutcomes([row,{...row,symbol:'abc',realizedR:-1},{...row,createdDate:'bad'},{...row,createdDate:'2026-02-30'},{...row,symbol:''}]);
  assert.equal(rows.length,1);assert.equal(rows[0].realizedR,-1);
});

test('stock suspension uses confirmed journal losses even when cached aggregates are positive',async t=>{
  const accepted=Array.from({length:200},(_,i)=>({status:'RESOLVED',decision:'ACCEPTED',symbol:`S${i}`,createdDate:`2026-09-${String(1+i%30).padStart(2,'0')}`,setupType:'TREND',runtimeRegime:'UPTREND',realizedR:2}));
  const journal=Array.from({length:18},(_,i)=>({assetClass:'STOCK',symbol:`R${i}`,setupType:'TREND',runtimeRegime:'UPTREND',reconciledFromRobinhood:true,outcome:i<12?'WIN':'LOSS',realizedR:i<12?2:-1,entryFilledAt:`2026-09-${String(i+1).padStart(2,'0')}T14:00:00Z`,finalExitAt:`2026-09-${String(i+1).padStart(2,'0')}T15:00:00Z`}));
  for(const [trades,state] of [[journal,'LIVE_SUSPENDED'],[journal.slice(0,12),'LIVE_ADMITTED']]) {
    const f=await fixture(t,{
      'docs/signal.json':{},'docs/data/shadow-trades.json':{trades:accepted},
      'docs/data/real-trade-journal.json':{trades},
      'docs/data/adaptive-performance.json':{buckets:{byRegimeSetup:[{key:'UPTREND|TREND',samples:100,averageRealizedR:99}]}},
      'docs/data/stock-tournament.json':{adaptiveLearning:{currentRegime:'UPTREND'},liveQueue:[{ticker:'ABC',setupType:'TREND',entryTier:'A',action:'AUTO_BUY_ELIGIBLE'}]}
    });
    f.run('apply-profitability-admission.mjs');
    const row=(await f.read('docs/data/stock-tournament.json')).liveQueue[0];
    assert.equal(row.profitabilityAdmission.state,state);
    assert.equal(row.profitabilityAdmission.real.samples,trades.length);
    if(state==='LIVE_ADMITTED') {
      const signal=await f.read('docs/signal.json');
      signal.autopilot={requiresPerOrderApproval:false};
      await f.write('docs/signal.json',signal);
      f.run('apply-chatgpt-unattended-execution-policy.mjs');
      f.run('apply-robinhood-executable-universe.mjs');
      f.run('validate-profitability-admission.mjs');
      const tournament=await f.read('docs/data/stock-tournament.json');
      tournament.liveQueue[0].profitabilityAdmission.shadow.samples=0;
      await f.write('docs/data/stock-tournament.json',tournament);
      f.run('validate-profitability-admission.mjs',false);
    }
  }
});

test('options, index options and crypto ignore summary-only real-fill claims',async t=>{
  const f=await fixture(t,Object.fromEntries(['options','index-options','crypto'].map(lane=>[`docs/data/${lane}-real-trade-journal.json`,{trades:[],summary:{resolvedTrades:999,winRatePct:100,averageRealizedR:99}}])));
  for(const lane of ['options','index-options','crypto']) {
    f.run(`apply-${lane}-profitability-admission.mjs`);
    const result=await f.read(`docs/data/${lane}-profitability-admission.json`);
    assert.equal(result.real.samples,0);assert.equal(result.real.averageRealizedR,null);assert.equal(result.state,'SHADOW_ONLY');
  }
});

test('negative real options suspend without requiring a passing shadow pool',async t=>{
  const trades=Array.from({length:3},(_,i)=>({assetClass:'OPTION',symbol:`ABC${i}`,entryFilledAt:`2026-09-0${i+1}T14:00:00Z`,finalExitAt:`2026-09-0${i+1}T15:00:00Z`,reconciledFromRobinhood:true,outcome:'LOSS',realizedR:-1}));
  const f=await fixture(t,{'docs/data/options-real-trade-journal.json':{trades}});
  f.run('apply-options-profitability-admission.mjs');
  const result=await f.read('docs/data/options-profitability-admission.json');
  assert.equal(result.state,'LIVE_SUSPENDED');assert.equal(result.executionAuthorized,false);
});

test('learning consensus reports the actual adaptive real-trade sample count',async t=>{
  const f=await fixture(t,{'docs/data/adaptive-performance.json':{resolvedRealStockTrades:1}});
  f.run('build-learning-consensus.mjs');
  const result=await f.read('docs/data/learning-consensus.json');
  assert.equal(result.evidence.realFills.resolvedTrades,1);
});

test('index admission does not round a failing profit factor up to its threshold',async t=>{
  const trades=Array.from({length:50},(_,i)=>({status:'RESOLVED',evidenceEligible:true,indexSymbol:i%2?'DJX':'XND',createdDate:`2026-09-${String(1+Math.floor(i/2)).padStart(2,'0')}`,realizedR:i%2?-1:1.299}));
  const f=await fixture(t,{'docs/data/index-options-shadow-trades.json':{trades}});
  f.run('apply-index-options-profitability-admission.mjs');
  const r=await f.read('docs/data/index-options-profitability-admission.json');
  assert.equal(r.shadow.samples,50);assert.ok(r.shadow.profitFactor<1.3);assert.equal(r.state,'SHADOW_ONLY');
});

test('reports expose incomplete closed trades and scorecards retain actual regime',async t=>{
  const base={assetClass:'STOCK',symbol:'ABC',runtimeRegime:'UPTREND',reconciledFromRobinhood:true,outcome:'LOSS',entryFilledAt:'2026-09-01T14:00:00Z',finalExitAt:'2026-09-01T15:00:00Z',realizedR:-1,realizedPnlDollars:null,adverseEntrySlippagePct:null};
  const f=await fixture(t,{'docs/data/real-trade-journal.json':{trades:[base,{...base,symbol:'DEF',outcome:'UNKNOWN',realizedR:null}]}});
  f.run('build-adaptive-performance.mjs');
  const r=await f.read('docs/data/adaptive-performance.json');
  assert.equal(r.dataQuality.closedStockJournalRows,2);assert.equal(r.dataQuality.closedRowsMissingRealizedR,1);assert.equal(r.dataQuality.closedRowsMissingDollarPnl,2);
  f.run('build-real-fill-scorecard.mjs');
  const score=await f.read('docs/data/real-fill-scorecard.json');
  assert.equal(score.resolvedTrades,1);assert.equal(score.scorecards.regime[0].regime,'UPTREND');assert.equal(score.scorecards.regime[0].averageEntrySlippagePct,null);
});
