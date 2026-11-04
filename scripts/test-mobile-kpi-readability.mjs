import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('docs/hq.css', 'utf8');
const script = fs.readFileSync('docs/hq.js', 'utf8');
const html = fs.readFileSync('docs/index.html', 'utf8');

test('financial KPI labels, values, and descriptions are not visually clipped', () => {
  for (const cls of ['l', 'v', 's']) {
    const rule = css.match(new RegExp('\\.kpi \\.' + cls + '\\{([^}]*)\\}'));
    assert.ok(rule, 'missing KPI '+cls+' style');
    assert.match(rule[1], /white-space:\s*normal/);
    assert.match(rule[1], /overflow-wrap:\s*anywhere/);
    assert.doesNotMatch(rule[1], /text-overflow:\s*ellipsis|overflow:\s*hidden/);
  }
});

test('phone layout uses full-width KPI cards and readable P&L amounts', () => {
  const media = css.match(/@media \(max-width:600px\)\{([\s\S]*?)\n\}/);
  assert.ok(media, 'phone-specific KPI breakpoint');
  assert.match(media[1], /\.kpis\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(media[1], /\.kpi \.v\{font-size:clamp\(/);
});

test('real, ledger estimates and paper profit labels remain distinct', () => {
  assert.ok(script.includes('REAL broker P&L'));
  assert.ok(script.includes('Ledger-only gains (NOT broker confirmed)'));
  assert.ok(script.includes('Simulated paper P&L (not actual cash)'));
  assert.match(html, /hq\.css\?v=/);
});
