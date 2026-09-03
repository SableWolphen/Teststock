import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateNyseSession,newYorkClock} from './nyse-session.mjs';

const regular={date:'2026-09-03',open:'09:30',close:'16:00'};
test('permits entry before the cutoff',()=>assert.equal(evaluateNyseSession({now:new Date('2026-09-03T18:00:00Z'),calendarSession:regular}).entryAllowed,true));
test('blocks entry inside final 30 minutes',()=>assert.equal(evaluateNyseSession({now:new Date('2026-09-03T19:31:00Z'),calendarSession:regular}).entryAllowed,false));
test('forces exit inside final 15 minutes',()=>assert.equal(evaluateNyseSession({now:new Date('2026-09-03T19:46:00Z'),calendarSession:regular}).forcedExitDue,true));
test('keeps forcing exit after the session',()=>assert.equal(evaluateNyseSession({now:new Date('2026-09-03T21:00:00Z'),calendarSession:regular}).forcedExitDue,true));
test('reconciles an unexpectedly open same-day position before the next session',()=>assert.equal(evaluateNyseSession({now:new Date('2026-09-03T12:00:00Z'),calendarSession:regular}).forcedExitDue,true));
test('fails closed on a weekend or holiday without a calendar session',()=>{const x=evaluateNyseSession({now:new Date('2026-09-05T16:00:00Z')});assert.equal(x.entryAllowed,false);assert.equal(x.forcedExitDue,true);});
test('honors an authoritative early close',()=>{const x=evaluateNyseSession({now:new Date('2026-11-27T17:46:00Z'),calendarSession:{date:'2026-11-27',open:'09:30',close:'13:00'}});assert.equal(x.entryAllowed,false);assert.equal(x.forcedExitDue,true);});
test('New York conversion is DST-safe on both sides of transition',()=>{assert.deepEqual(newYorkClock(new Date('2026-03-06T15:00:00Z')),{dateKey:'2026-03-06',minuteOfDay:600});assert.deepEqual(newYorkClock(new Date('2026-03-09T14:00:00Z')),{dateKey:'2026-03-09',minuteOfDay:600});});
