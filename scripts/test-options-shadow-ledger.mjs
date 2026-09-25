import assert from 'node:assert/strict';
import test from 'node:test';
import {openNewShadowTrades,resolveOptionShadowTrade,summarizeShadowTrades,TARGET_MULTIPLIER,STOP_MULTIPLIER} from './options-shadow-engine.mjs';

const standardCandidate={underlying:'ABC',contract:'ABC260101C00100000',expiry:'2026-01-01',dte:45,dteBucket:'STANDARD',ask:2,underlyingScore:80,score:90};
const zeroDteCandidate={underlying:'XYZ',contract:'XYZ260101C00050000',expiry:'2026-01-01',dte:0,dteBucket:'0DTE',ask:1,score:95};

test('only STANDARD-DTE candidates ever open a shadow trade',()=>{
  const trades=openNewShadowTrades({candidates:[zeroDteCandidate,standardCandidate],existingTrades:[],todayIso:'2026-09-25',nowIso:'2026-09-25T10:00:00Z'});
  assert.equal(trades.length,1);
  assert.equal(trades[0].underlying,'ABC');
  assert.equal(trades[0].entry,2);
  assert.equal(trades[0].stop,round(2*STOP_MULTIPLIER));
  assert.equal(trades[0].target,round(2*TARGET_MULTIPLIER));
  assert.equal(trades[0].status,'OPEN');
  assert.equal(trades[0].modelOnly,true);
});

test('at most one new shadow trade per UTC day',()=>{
  const existing=[{id:'2026-09-25-OTHER',createdDate:'2026-09-25',contract:'OTHER',status:'OPEN'}];
  const trades=openNewShadowTrades({candidates:[standardCandidate],existingTrades:existing,todayIso:'2026-09-25',nowIso:'2026-09-25T10:00:00Z',maxNewPerUtcDay:1});
  assert.deepEqual(trades,[]);
});

test('an already-tracked contract is never opened twice',()=>{
  const existing=[{id:'2026-09-24-ABC260101C00100000',createdDate:'2026-09-24',contract:'ABC260101C00100000',status:'RESOLVED'}];
  const trades=openNewShadowTrades({candidates:[standardCandidate],existingTrades:existing,todayIso:'2026-09-25',nowIso:'2026-09-25T10:00:00Z'});
  assert.deepEqual(trades,[]);
});

test('hitting target resolves a real win at the recorded targetR',()=>{
  const trade={status:'OPEN',entry:2,stop:1.2,target:3,targetR:2.25,expiry:'2026-12-01'};
  const resolved=resolveOptionShadowTrade(trade,{bid:2.9,ask:3.1},'2026-11-01T00:00:00Z');
  assert.equal(resolved.status,'RESOLVED');
  assert.equal(resolved.outcome,'WIN');
  assert.equal(resolved.realizedR,2.25);
});

test('hitting stop resolves a full loss',()=>{
  const trade={status:'OPEN',entry:2,stop:1.2,target:3,targetR:2.25,expiry:'2026-12-01'};
  const resolved=resolveOptionShadowTrade(trade,{bid:1.0,ask:1.3},'2026-11-01T00:00:00Z');
  assert.equal(resolved.status,'RESOLVED');
  assert.equal(resolved.outcome,'LOSS');
  assert.equal(resolved.realizedR,-1);
});

test('missing snapshot data before expiry stays open, never guesses',()=>{
  const trade={status:'OPEN',entry:2,stop:1.2,target:3,targetR:2.25,expiry:'2026-12-01'};
  const resolved=resolveOptionShadowTrade(trade,null,'2026-11-01T00:00:00Z');
  assert.equal(resolved.status,'OPEN');
});

test('missing snapshot data at/after expiry is marked UNKNOWN, never fabricated',()=>{
  const trade={status:'OPEN',entry:2,stop:1.2,target:3,targetR:2.25,expiry:'2026-01-01'};
  const resolved=resolveOptionShadowTrade(trade,null,'2026-01-05T00:00:00Z');
  assert.equal(resolved.status,'UNKNOWN');
  assert.equal(resolved.outcome,null);
});

test('a resolved trade is never re-resolved',()=>{
  const trade={status:'RESOLVED',outcome:'WIN',realizedR:2.25};
  const resolved=resolveOptionShadowTrade(trade,{bid:0.1,ask:0.2},'2026-11-01T00:00:00Z');
  assert.deepEqual(resolved,trade);
});

test('summary keeps the most adverse realized R per independent day+underlying key',()=>{
  const trades=[
    {status:'RESOLVED',createdDate:'2026-09-01',underlying:'ABC',realizedR:2},
    {status:'RESOLVED',createdDate:'2026-09-01',underlying:'ABC',realizedR:-1},
    {status:'RESOLVED',createdDate:'2026-09-02',underlying:'DEF',realizedR:1.5},
  ];
  const summary=summarizeShadowTrades(trades);
  assert.equal(summary.independentSamples,2);
  assert.equal(summary.resolvedCount,3);
  assert.equal(summary.winRatePct,50);
});

function round(n,d=4){return Number(Number(n||0).toFixed(d));}
