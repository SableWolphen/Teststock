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

test('phone layout pairs compact KPIs while keeping broker provenance full-width', () => {
  const media = css.match(/@media \(max-width:600px\)\{([\s\S]*?)\n\}/);
  assert.ok(media, 'phone-specific KPI breakpoint');
  assert.match(media[1], /\.kpis\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(media[1], /\.kpi \.v\{font-size:clamp\(/);
});

test('real, ledger estimates and paper profit labels remain distinct', () => {
  assert.ok(script.includes('REAL broker P&L'));
  assert.ok(script.includes('Ledger-only gains (NOT broker confirmed)'));
  assert.ok(script.includes('Simulated paper P&L (not actual cash)'));
  assert.match(html, /hq\.css\?v=/);
});

test('new mobile overflow guards and refreshed assets expose complete numbers', () => {
  assert.match(css, /\.kpi \.l,\.kpi \.v,\.kpi \.s\s*\{[^}]*overflow:visible;text-overflow:clip/);
  assert.match(css, /\.kpi \.v\{white-space:pre-line\}/);
  assert.match(css, /\.kpis\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(html, /hq\.css\?v=20261103-verification-explained123/);
  assert.match(html, /hq\.js\?v=[^"\s]+/);
  assert.ok(script.includes('Closed ${usd(ma.closed)}\\nOpen ${usd(ma.open)}'));
});

test('profitability room and evidence agents show separate paper and broker sources', () => {
  assert.match(html, /data-room="profitability"/);
  for (const name of ["edge", "friction", "proof"]) assert.match(script, new RegExp(name + ":\\s*\\{ name:"));
  assert.match(script, /profitability\(\)\s*\{/);
  assert.ok(script.includes("D.optionAdmission"));
  assert.ok(script.includes("D.tournament"));
  assert.ok(script.includes("D.privateBroker"));
  assert.ok(script.includes("No guaranteed profit and no automatic strategy promotion"));
  assert.ok(script.includes("No independently qualified ETF strategy"));
});

test('broker not-connected state explains that GitHub Pages has no authenticated backend', () => {
  assert.ok(script.includes('This public GitHub Pages site has no authenticated Robinhood backend'));
  assert.ok(html.includes('Dashboard online'));
});
