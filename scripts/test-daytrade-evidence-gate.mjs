import test from 'node:test';
import assert from 'node:assert/strict';
import {daytradeEvidenceGate} from './daytrade-evidence-gate.mjs';
const valid={independentResolvedTrades:101,distinctTradingDays:22,afterCostProfitFactor:1.4,afterCostExpectancyUsd:.12,outOfSampleVerified:true,executablePricesVerified:true,brokerEntryExitVerified:true,protectiveExitVerified:true,accountRiskLimitsVerified:true};
test('missing evidence never qualifies',()=>{let r=daytradeEvidenceGate();assert.equal(r.eligible,false);assert.ok(r.failures.length>=5)});
test('losing strategy fails even with many wins',()=>{let r=daytradeEvidenceGate({...valid,afterCostProfitFactor:.88});assert.equal(r.eligible,false)});
test('positive strategy needs independent held-out and broker evidence',()=>{assert.equal(daytradeEvidenceGate({...valid,outOfSampleVerified:false}).eligible,false);assert.equal(daytradeEvidenceGate({...valid,brokerEntryExitVerified:false}).eligible,false)});
test('fully evidenced stocks can qualify for further checks, not broker order authority',()=>{let r=daytradeEvidenceGate(valid);assert.equal(r.eligible,true);assert.equal(r.scope,'QUALIFICATION_ONLY_NO_BROKER_AUTHORITY')});
test('options require their own stricter evidence',()=>{assert.equal(daytradeEvidenceGate({...valid,independentResolvedTrades:51,afterCostProfitFactor:1.29},{assetClass:'OPTION'}).eligible,false)});
