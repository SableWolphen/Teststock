import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOptionEntry, evaluateStockEntry, evaluateExitOrder, evaluateAccountBrakes, daysToExpiration, DEFAULT_LIMITS } from './account-risk-gate.mjs';

// 2026-10-29 10:30 New York (EDT) — inside the entry window.
const NOW = Date.parse('2026-10-29T14:30:00Z');

const smallAccount = (over = {}) => ({ accountValue: 64, dayStartValue: 64, peakValue: 76, cash: 64, openRisk: 0, entriesToday: 0, losingExitsToday: 0, underlyingsTradedToday: [], ...over });
const bigAccount = (over = {}) => ({ accountValue: 10000, dayStartValue: 10000, peakValue: 10000, cash: 10000, openRisk: 0, entriesToday: 0, losingExitsToday: 0, underlyingsTradedToday: [], ...over });
const goodContract = (over = {}) => ({ underlying: 'SPY', kind: 'LONG_CALL', bid: 1.95, ask: 2.0, expirationDate: '2026-11-27', openInterest: 2000, volume: 800, ...over });

test('replay 2026-10-29: F 12C expiring next day is blocked', () => {
  const r = evaluateOptionEntry({ account: smallAccount(), contract: { underlying: 'F', kind: 'LONG_CALL', bid: 0.28, ask: 0.3, expirationDate: '2026-10-30', openInterest: 5000, volume: 3000 }, now: NOW });
  assert.equal(r.allowed, false);
  assert.ok(r.reasons.includes('EXPIRES_TOO_SOON'));
  assert.ok(r.reasons.includes('CONTRACT_TOO_LARGE_FOR_ACCOUNT')); // $30 premium vs $9.60 budget
  assert.equal(r.maxContracts, 0);
});

test('replay 2026-10-29: SOFI 18C at $0.30 is too large for a $64 account', () => {
  const r = evaluateOptionEntry({ account: smallAccount(), contract: { underlying: 'SOFI', kind: 'LONG_CALL', bid: 0.28, ask: 0.3, expirationDate: '2026-11-06', openInterest: 4000, volume: 900 }, now: NOW });
  assert.equal(r.allowed, false);
  assert.deepEqual(r.reasons, ['CONTRACT_TOO_LARGE_FOR_ACCOUNT']);
});

test('replay 2026-10-29: AAL 13.5C at $0.14 is a lottery ticket', () => {
  const r = evaluateOptionEntry({ account: smallAccount({ accountValue: 31, cash: 31, entriesToday: 1, losingExitsToday: 2, underlyingsTradedToday: ['F', 'SOFI'] }), contract: { underlying: 'AAL', kind: 'LONG_CALL', bid: 0.12, ask: 0.14, expirationDate: '2026-11-06', openInterest: 3000, volume: 500 }, now: NOW });
  assert.equal(r.allowed, false);
  for (const code of ['LOTTERY_PREMIUM', 'SPREAD_TOO_WIDE', 'DAILY_LOSS_LIMIT', 'LOSING_STREAK_PAUSE']) assert.ok(r.reasons.includes(code), code);
});

test('a liquid 29-DTE contract on a funded account is allowed and sized by % of account', () => {
  const r = evaluateOptionEntry({ account: bigAccount(), contract: goodContract(), now: NOW });
  assert.equal(r.allowed, true, r.reasons.join());
  assert.equal(r.maxContracts, 7); // 15% of $10,000 = $1,500 / $200
});

test('open risk room shrinks contract count', () => {
  const r = evaluateOptionEntry({ account: bigAccount({ openRisk: 2600 }), contract: goodContract(), now: NOW });
  assert.equal(r.allowed, true);
  assert.equal(r.maxContracts, 2); // (3000 - 2600) / 200
  const full = evaluateOptionEntry({ account: bigAccount({ openRisk: 2900 }), contract: goodContract(), now: NOW });
  assert.equal(full.allowed, false);
  assert.ok(full.reasons.includes('TOTAL_OPEN_RISK_LIMIT'));
});

test('daily loss and drawdown brakes scale with account size', () => {
  assert.ok(evaluateAccountBrakes(bigAccount({ accountValue: 9490 }), DEFAULT_LIMITS, NOW).reasons.includes('DAILY_LOSS_LIMIT'));
  assert.equal(evaluateAccountBrakes(bigAccount({ accountValue: 9600 }), DEFAULT_LIMITS, NOW).allowed, true);
  const dd = evaluateAccountBrakes(bigAccount({ peakValue: 14000 }), DEFAULT_LIMITS, NOW);
  assert.ok(dd.reasons.includes('DRAWDOWN_LIMIT'));
});

test('no same-day re-entry, entry caps, and the entry window', () => {
  assert.ok(evaluateOptionEntry({ account: bigAccount({ underlyingsTradedToday: ['spy'] }), contract: goodContract(), now: NOW }).reasons.includes('SAME_DAY_REENTRY'));
  assert.ok(evaluateOptionEntry({ account: bigAccount({ entriesToday: 2 }), contract: goodContract(), now: NOW }).reasons.includes('DAILY_ENTRY_LIMIT'));
  assert.ok(evaluateOptionEntry({ account: bigAccount(), contract: goodContract(), now: Date.parse('2026-10-29T13:35:00Z') }).reasons.includes('OUTSIDE_ENTRY_WINDOW'));
  assert.ok(evaluateOptionEntry({ account: bigAccount(), contract: goodContract(), now: Date.parse('2026-10-29T19:30:00Z') }).reasons.includes('OUTSIDE_ENTRY_WINDOW'));
});

test('missing inputs fail closed', () => {
  const r = evaluateOptionEntry({ account: {}, contract: {}, now: NOW });
  assert.equal(r.allowed, false);
  assert.ok(r.reasons.includes('ACCOUNT_VALUES_UNVERIFIED'));
  const r2 = evaluateOptionEntry({ account: bigAccount({ underlyingsTradedToday: undefined }), contract: goodContract(), now: NOW });
  assert.ok(r2.reasons.includes('TODAY_TRADES_UNVERIFIED'));
});

test('stock entries need a stop and are sized by 2% risk', () => {
  const r = evaluateStockEntry({ account: bigAccount(), order: { symbol: 'AAPL', entryPrice: 200, stopPrice: 194 }, now: NOW });
  assert.equal(r.allowed, true, r.reasons.join());
  assert.equal(r.maxShares, 12.5); // min(200/6=33.3, 2500/200=12.5)
  assert.ok(evaluateStockEntry({ account: bigAccount(), order: { symbol: 'AAPL', entryPrice: 200 }, now: NOW }).reasons.includes('STOP_REQUIRED_BELOW_ENTRY'));
  // Small accounts can still buy a fractional, defined-risk stock position.
  const small = evaluateStockEntry({ account: smallAccount({ accountValue: 25, dayStartValue: 25, peakValue: 25, cash: 25 }), order: { symbol: 'F', entryPrice: 12.5, stopPrice: 12 }, now: NOW });
  assert.equal(small.allowed, true, small.reasons.join());
  assert.equal(small.maxShares, 0.5); // min(0.5/0.5=1, 6.25/12.5=0.5)
});

test('option exits must be limit orders, never stop-market', () => {
  assert.equal(evaluateExitOrder({ assetClass: 'option', type: 'limit', limitPrice: 0.25, bid: 0.24 }).allowed, true);
  const sm = evaluateExitOrder({ assetClass: 'option', type: 'market', trigger: 'stop' });
  assert.equal(sm.allowed, false);
  assert.ok(sm.reasons.includes('NO_STOP_MARKET_ON_OPTIONS'));
  assert.equal(evaluateExitOrder({ assetClass: 'stock', type: 'market' }).allowed, true);
});

test('days to expiration uses the New York calendar day', () => {
  assert.equal(daysToExpiration('2026-10-30', NOW), 1);
  assert.equal(daysToExpiration('2026-11-06', NOW), 8);
  assert.ok(Number.isNaN(daysToExpiration('soon', NOW)));
});

test('daily loss cap shrinks to 5% of equity on small accounts', async () => {
  const { effectiveDailyLossLimitCents } = await import('./daily-loss-guard.mjs');
  assert.equal(effectiveDailyLossLimitCents(6400, 8000), 320); // $64 account -> $3.20, not $80
  assert.equal(effectiveDailyLossLimitCents(1000000, 8000), 8000); // fixed cap still binds on big accounts
  assert.equal(effectiveDailyLossLimitCents(undefined, 8000), 8000);
});
