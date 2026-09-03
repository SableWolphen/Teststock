import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCryptoMonitorCandidates,evaluateCryptoMonitorCandidate} from './crypto-monitor-candidates.mjs';

const policy={enabled:true,maxOrderUsd:5,maxConcurrentPositions:1,maxNewPositionsPerUtcDay:1,maxHoldingHours:8,maxStopLossesPerUtcDay:2,requiredGrades:['A','A+'],requiresBrokerResidentStop:true};
const sol={ticker:'SOL/USD',grade:'A+',entry:100,stop:95,target1:110,target2:125,robinhoodTradable:true};

test('qualified champion remains monitored outside its entry zone',()=>{
  const [candidate]=buildCryptoMonitorCandidates({tournament:{generatedAt:'2026-09-03T12:00:00Z',qualifiedChampion:sol,fallbacks:[]}});
  assert.equal(candidate.ticker,'SOL/USD');
  assert.equal(candidate.maximumEntry,102);
  assert.equal(evaluateCryptoMonitorCandidate({candidate,price:99,sourceFresh:true,admissionState:'SHADOW_ONLY',seedPolicy:policy}).status,'WAIT_ENTRY');
});

test('entering the zone creates a bounded crypto seed trigger',()=>{
  const [candidate]=buildCryptoMonitorCandidates({tournament:{qualifiedChampion:sol}});
  const state=evaluateCryptoMonitorCandidate({candidate,price:100.5,sourceFresh:true,admissionState:'SHADOW_ONLY',seedPolicy:policy});
  assert.equal(state.status,'CRYPTO_SEED_LANE_BUY_TRIGGER');
  assert.equal(state.seedLane.maxOrderUsd,5);
  assert.equal(state.seedLane.requiresBrokerResidentStop,true);
});

test('unqualified rows cannot enter the monitoring pool',()=>{
  const rows=buildCryptoMonitorCandidates({cryptoOrders:[{ticker:'DOGE/USD',setupGrade:'A',minimumEntry:1,maximumEntry:1.02,stop:.9,target1:1.1,target2:1.2}],tournament:{qualifiedChampion:null,fallbacks:[]}});
  assert.deepEqual(rows,[]);
});

test('stale generation and an existing crypto position fail closed',()=>{
  const [candidate]=buildCryptoMonitorCandidates({tournament:{qualifiedChampion:sol}});
  assert.equal(evaluateCryptoMonitorCandidate({candidate,price:100.5,sourceFresh:false,admissionState:'SHADOW_ONLY',seedPolicy:policy}).status,'REFRESHING_SIGNAL');
  assert.equal(evaluateCryptoMonitorCandidate({candidate,price:100.5,sourceFresh:true,admissionState:'SHADOW_ONLY',seedPolicy:policy,activeCryptoPositions:1}).status,'CRYPTO_POSITION_LIMIT_REACHED');
});

test('the crypto seed maximum cannot exceed five dollars',()=>{
  const [candidate]=buildCryptoMonitorCandidates({tournament:{qualifiedChampion:sol}});
  const state=evaluateCryptoMonitorCandidate({candidate,price:100.5,sourceFresh:true,admissionState:'SHADOW_ONLY',seedPolicy:{...policy,maxOrderUsd:50,maxConcurrentPositions:5,maxNewPositionsPerUtcDay:5}});
  assert.equal(state.seedLane.maxOrderUsd,5);
  assert.equal(state.seedLane.maxConcurrentPositions,1);
  assert.equal(state.seedLane.maxNewPositionsPerUtcDay,1);
});
