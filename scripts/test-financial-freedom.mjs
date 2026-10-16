import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PLAN,projectPlan,summarizeJournal} from '../docs/freedom-model.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('income goal uses annual withdrawals, not monthly trading return',()=>{
 const p=projectPlan({...DEFAULT_PLAN,inflation:0});near(p.requiredCapital,3000000);
 near(p.monthlyCapacity,p.projectedCapital*.04/12);assert.ok(p.gap>2999000);assert.ok(p.requiredContribution>100000);
});
test('zero return contribution bridge and exact required contribution',()=>{
 const p=projectPlan({capital:100,contribution:50,annualReturn:0,inflation:0});near(p.projectedCapital,1300);near(p.modeledGrowth,0);
 near(projectPlan({...p,contribution:p.requiredContribution}).projectedCapital,p.requiredCapital);
});
test('annual return is effective, deposits arrive at month end, inflation moves the target',()=>{
 near(projectPlan({capital:100,annualReturn:12,months:12,contribution:0}).projectedCapital,112);
 const p=projectPlan({capital:100,annualReturn:0,inflation:10,months:24});near(p.requiredCapital,3630000);
 near(p.incomeAtDeadline,12100);assert.equal(p.zeroReturnRunwayMonths,0);
});
test('loss scenarios and withdrawal sensitivity do not create a false success',()=>{
 const p=projectPlan({capital:1000,contribution:0,annualReturn:-20,inflation:0,months:24});near(p.projectedCapital,640);
 near(projectPlan({withdrawalRate:3,inflation:0}).requiredCapital,4000000);
 near(projectPlan({withdrawalRate:5,inflation:0}).requiredCapital,2400000);
 assert.equal(p.scenarios[0].annualReturn,-20);assert.equal(p.milestones[0].achieved,true);
});
test('zero capital is valid; empty, nonfinite and out-of-range values are rejected',()=>{
 assert.equal(projectPlan({capital:0,contribution:0}).projectedCapital,0);
 for(const input of [{capital:NaN},{capital:''},{capital:-1},{annualReturn:Infinity},{withdrawalRate:0},{months:18},{annualReturn:21},{monthlyIncome:0}])assert.throws(()=>projectPlan(input));
});
test('reaching a target clamps progress and requires no added contribution',()=>{
 const p=projectPlan({capital:4000000,annualReturn:0,inflation:0});assert.equal(p.progress,100);assert.equal(p.gap,0);assert.equal(p.requiredContribution,0);
});
const row={journalId:'one',reconciledFromRobinhood:true,outcome:'WIN',finalExitAt:'2026-10-01',realizedPnlDollars:2};
test('missing P&L is unknown rather than zero; paper and duplicate trades are excluded',()=>{
 const s=summarizeJournal({lastReconciledAt:'2020-01-01',trades:[row,{...row,journalId:'two',realizedPnlDollars:null},{...row,journalId:'paper',reconciledFromRobinhood:false},{...row,journalId:'dup'},{...row,journalId:'dup'}]});
 assert.equal(s.confirmed,2);assert.equal(s.closed,2);assert.equal(s.dollarCoverage,1);assert.equal(s.knownPnl,2);assert.equal(s.totalPnl,null);assert.equal(s.stale,true);assert.equal(s.excludedDuplicateRows,2);
 assert.equal(summarizeJournal(null).available,false);
 assert.equal(summarizeJournal({trades:[]}).totalPnl,null);
 assert.equal(summarizeJournal({trades:[{...row,realizedPnlDollars:0}]}).totalPnl,0);
});
test('future reconciliation cannot appear fresh and unknown outcomes cannot count as performance',()=>{
 const s=summarizeJournal({lastReconciledAt:'2099-01-01',trades:[{...row,outcome:'UNKNOWN'}]},Date.parse('2026-10-16'));
 assert.equal(s.stale,true);assert.equal(s.closed,1);assert.equal(s.classified,0);assert.equal(s.totalPnl,null);
});

test('a known classified subset never hides unknown closed outcomes',()=>{
 const s=summarizeJournal({trades:[row,{...row,journalId:'unknown',outcome:'UNKNOWN'}]});
 assert.equal(s.closed,2);assert.equal(s.classified,1);assert.equal(s.knownPnl,2);assert.equal(s.totalPnl,null);
});
