import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionExitReview} from './session-exit-review.mjs';
const run=(time,close='16:00',patch={})=>{const now=Date.parse(time);return sessionExitReview({now,holdingCount:1,entryData:{verifiedAt:time,connected:true,calendarVerified:true,calendarSession:{date:time.slice(0,10),open:'09:30',close},...patch}});};
test('hourly last exit check precedes the session cutoff rather than waiting for an expired GFD stop',()=>{
 const r=run('2026-10-19T19:00:00Z');assert.equal(r.lastScheduledReviewNy,'15:00');assert.equal(r.exitReviewRequired,true);assert.equal(r.brokerWrites,false);assert.equal(r.unattendedExecutionVerified,false);
 assert.equal(run('2026-10-19T18:30:00Z').state,'SESSION_EXIT_REVIEW_UPCOMING');
 assert.equal(run('2026-10-19T18:29:00Z').exitReviewUpcoming,false);
 assert.equal(run('2026-10-19T20:00:00Z').state,'SESSION_CLOSED_WITH_HOLDINGS');
});
test('early close uses the authoritative calendar and winter daylight offset',()=>{
 const r=run('2026-11-27T17:00:00Z','13:00');assert.equal(r.lastScheduledReviewNy,'12:00');assert.equal(r.exitReviewRequired,true);
});
test('missing, invalid, mismatched and stale calendars escalate without making up a regular close',()=>{
 for(const patch of [{calendarSession:null},{calendarSession:{date:'2026-10-18',open:'09:30',close:'16:00'}},{calendarSession:{date:'2026-10-19',open:'09:30',close:'25:00'}},{verifiedAt:'2020-01-01'},{connected:false}]) {
  const r=run('2026-10-19T14:00:00Z','16:00',patch);assert.equal(r.state,'SESSION_EXIT_TIME_UNVERIFIED');assert.equal(r.exitReviewRequired,true);
 }
});
