import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const code = fs.readFileSync('docs/hq.js', 'utf8');
const daily = JSON.parse(fs.readFileSync('docs/data/claudebot-daily-profit.json', 'utf8'));
const tournament = JSON.parse(fs.readFileSync('docs/data/claudebot-tournament-scorecard.json', 'utf8'));
const spread = JSON.parse(fs.readFileSync('docs/data/claudebot-options-ledger.json', 'utf8'));

test('dashboard JavaScript parses', () => {
  execFileSync(process.execPath, ['--check', 'docs/hq.js']);
});

test('historical PAPER option fills never become real just because the desk mode changes', () => {
  assert.match(code, /filter\(t => t\.mode === 'live'\)/);
  assert.doesNotMatch(code, /D\.oled\?\.mode === 'live' \? \(D\.oled\?\.trades/);
  assert.ok(spread.trades.some(t => t.mode === 'paper'));
  assert.equal(spread.trades.filter(t => t.mode === 'live').length, 0);
  assert.match(code, /x\.mode === 'paper' \? 'PAPER \/ simulation'/);
  assert.match(code, /t\.mode === 'paper' \? 'PAPER'/);
});

test('public HQ explicitly segregates broker P&L, ledger estimates and paper figures', () => {
  for (const label of [
    'REAL broker P&L', 'UNVERIFIED',
    'Ledger-only gains (NOT broker confirmed)',
    'Simulated paper P&L (not actual cash)',
    'LIVE-TAGGED / unverified',
    'Published strategy journals; NOT independently broker-confirmed fills',
  ]) assert.ok(code.includes(label), label);
  assert.doesNotMatch(code, /Every fill, from Robinhood-confirmed prices/);
  assert.doesNotMatch(code, /The company made \$\{usd\(p\.wk\.usd\)\}/);
});

test('public research is never marked as broker profit or auto-approved live', () => {
  assert.equal(daily.actualBroker.profitableDayVerified, false);
  assert.equal(daily.actualBroker.dailyRealizedStatus, 'UNVERIFIED');
  assert.equal(daily.actualBroker.dailyUnrealizedStatus, 'UNVERIFIED');
  assert.equal(daily.scope, 'PUBLIC_RESEARCH_ONLY_NOT_BROKER_ACCOUNT_PERFORMANCE');
  assert.equal(tournament.brokerVerified, false);
  assert.equal(tournament.autoPromote, false);
  assert.equal(tournament.mode, 'PAPER_ONLY');
  assert.equal(tournament.decision, 'NO_NEW_LIVE_STRATEGIES');
  assert.ok(tournament.etfLeaderboard.every(row => row.liveEligible === false));
});
