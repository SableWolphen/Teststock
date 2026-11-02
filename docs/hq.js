// Teststock HQ: isometric office where ClaudeBot's agents act out the real system state.
// Reads only public JSON status files. No secrets, no account data.
import { projectPlan, DEFAULT_PLAN } from './freedom-model.mjs';

const RAW = 'https://raw.githubusercontent.com/SableWolphen/teststock/main/';
async function getJSON(path) {
  for (const base of [RAW, '']) {
    try { const r = await fetch(base + (base ? path : path.replace(/^docs\//, '')) + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) {}
  }
  return null;
}
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const ago = t => { if (!t) return 'never'; const m = Math.round((Date.now() - new Date(t)) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
const when = t => t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '–';
const pct = (v, d = 2) => v == null || isNaN(v) ? '–' : (v > 0 ? '+' : '') + v.toFixed(d) + '%';
const usd = v => v == null || isNaN(v) ? '–' : (v < 0 ? '-$' : '+$') + Math.abs(v).toFixed(2);
const money = v => v == null || !isFinite(v) ? '–' : (v < 0 ? '-$' : '$') + (Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1000 ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v).toFixed(2));
const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';

/* ============================== scene geometry ============================== */
const TW = 64, TH = 32, W = 25, DEPTH = 14, WH = 120;
let cam = { cx: 96, cy: 240, s: 1 };
const iso = (x, y, z = 0) => [(x - y) * TW / 2, (x + y) * TH / 2 - z];
const P = pts => pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
const poly = (pts, fill, parent, extra = {}) => el('polygon', { points: P(pts), fill, ...extra }, parent);
function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); const f = v => Math.max(0, Math.min(255, v + amt)); return '#' + ((1 << 24) + (f(n >> 16) << 16) + (f(n >> 8 & 255) << 8) + f(n & 255)).toString(16).slice(1); }

const ROOMS = {
  lobby:       { name: 'Lobby · Overview', short: 'Lobby', x0: 0, x1: 5, y0: 0, y1: 6, c: ['#7a5a3c', '#70533a'], icon: '🛋️' },
  research:    { name: 'Research Lab', short: 'Research', x0: 5, x1: 10, y0: 0, y1: 6, c: ['#3d5f63', '#38595d'], icon: '🔬' },
  diagnostics: { name: 'Diagnostics', short: 'Diagnostics', x0: 10, x1: 15, y0: 0, y1: 6, c: ['#33405a', '#2f3b54'], icon: '🩺' },
  freedom:     { name: 'Freedom Room', short: 'Freedom', x0: 15, x1: 20, y0: 0, y1: 6, c: ['#5b6b4a', '#556545'], icon: '🎯' },
  hall:        { name: 'Hallway', short: 'Hall', x0: 0, x1: 25, y0: 6, y1: 8, c: ['#4a4e58', '#454953'] },
  trading:     { name: 'Trading Floor', short: 'Trading', x0: 0, x1: 10, y0: 8, y1: 14, c: ['#3c4a72', '#364368'], icon: '📈' },
  risk:        { name: 'Risk Office', short: 'Risk', x0: 10, x1: 15, y0: 8, y1: 14, c: ['#5a3a44', '#53363f'], icon: '🛡️' },
  vault:       { name: 'Vault · Ledger', short: 'Vault', x0: 15, x1: 20, y0: 8, y1: 14, c: ['#5e5640', '#57503b'], icon: '📒' },
  strategy:    { name: 'Strategy Lab', short: 'Strategy', x0: 20, x1: 25, y0: 0, y1: 6, c: ['#4a3d66', '#44385e'], icon: '🧠' },
  breakroom:   { name: 'Break Room', short: 'Break', x0: 20, x1: 25, y0: 8, y1: 14, c: ['#6b4f3a', '#634935'], icon: '☕' },
};
const ROOM_IDS = ['lobby', 'research', 'diagnostics', 'freedom', 'strategy', 'trading', 'risk', 'vault', 'breakroom'];
const roomOf = (x, y) => Object.entries(ROOMS).find(([k, r]) => k !== 'hall' && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)?.[0] || 'hall';
const doorX = id => id === 'trading' ? 5 : (ROOMS[id].x0 + ROOMS[id].x1) / 2;
const isBack = id => ROOMS[id].y1 <= 6;

const svg = $('svg');
const scene = el('g', { class: 'scene', id: 'scene' }, svg);
const defs = el('defs', {}, svg);
defs.innerHTML = `
  <radialGradient id="glow"><stop offset="0" stop-color="#ffd27a" stop-opacity=".5"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
  <radialGradient id="sglow"><stop offset="0" stop-color="#7c9cff" stop-opacity=".4"/><stop offset="1" stop-color="#7c9cff" stop-opacity="0"/></radialGradient>
  <radialGradient id="ggl"><stop offset="0" stop-color="#3ddc84" stop-opacity=".35"/><stop offset="1" stop-color="#3ddc84" stop-opacity="0"/></radialGradient>`;
const L = { floor: el('g', {}, scene), decal: el('g', {}, scene), walls: el('g', {}, scene), glow: el('g', {}, scene), hit: el('g', {}, scene), objs: el('g', {}, scene), tags: el('g', {}, scene) };

// floors
for (const [id, r] of Object.entries(ROOMS)) {
  for (let x = r.x0; x < r.x1; x++) for (let y = r.y0; y < r.y1; y++)
    poly([iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], r.c[(x + y) % 2], L.floor, { stroke: 'rgba(0,0,0,.13)', 'stroke-width': .6 });
}
// hall runner + floor decals
poly([iso(.3, 6.75), iso(24.7, 6.75), iso(24.7, 7.25), iso(.3, 7.25)], 'rgba(255,255,255,.05)', L.decal);
for (const id of ROOM_IDS) {
  const r = ROOMS[id]; const p = iso(r.x0 + .35, r.y1 - .35);
  const t = el('text', { transform: `matrix(0.894,0.447,-0.894,0.447,${p[0]},${p[1]})`, fill: '#fff', opacity: .28, 'font-size': 12, 'font-weight': 800, 'letter-spacing': 2.5 }, L.decal);
  t.textContent = r.name.toUpperCase();
}
// back walls
poly([iso(0, 0), iso(0, DEPTH), iso(0, DEPTH, WH), iso(0, 0, WH)], '#3b3029', L.walls);
poly([iso(0, 0), iso(W, 0), iso(W, 0, WH), iso(0, 0, WH)], '#2c3448', L.walls);
for (let y = .5; y < 6; y += .5) { const a = iso(0, y, 4), b = iso(0, y, WH - 4); el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#2a221c', 'stroke-width': 1.6 }, L.walls); }
poly([iso(0, 0, WH), iso(0, DEPTH, WH), iso(-.25, DEPTH, WH), iso(-.25, -.25, WH)], '#4b4038', L.walls);
poly([iso(0, 0, WH), iso(W, 0, WH), iso(W, -.25, WH), iso(-.25, -.25, WH)], '#3b4660', L.walls);
// windows in freedom + diagnostics
for (const x0 of [15.6, 17.6, 22.6]) poly([iso(x0, 0, 30), iso(x0 + 1.4, 0, 30), iso(x0 + 1.4, 0, 98), iso(x0, 0, 98)], 'rgba(150,200,255,.2)', L.walls, { stroke: 'rgba(200,225,255,.4)' });

// wall panels with live content
function wallPanel(x0, x1, z0, z1, fill = '#0c1322') { return poly([iso(x0, 0, z0), iso(x1, 0, z0), iso(x1, 0, z1), iso(x0, 0, z1)], fill, L.walls, { stroke: '#2e3a58', 'stroke-width': 2 }); }
function wallText(x, z, size, fill, weight = 600) { const p = iso(x, 0, z); return el('text', { x: 0, y: 0, fill, 'font-size': size, 'font-weight': weight, transform: `matrix(1,0.5,0,1,${p[0].toFixed(1)},${p[1].toFixed(1)})` }, L.walls); }
// lobby status board
wallPanel(.6, 3.6, 50, 100);
const lobbyT = [wallText(.85, 88, 10, '#8fb0ff', 700), wallText(.85, 74, 15, '#fff', 800), wallText(.85, 62, 10, '#c9d2e6'), wallText(.85, 54, 9, '#8a91a0')];
lobbyT[0].textContent = 'TESTSTOCK HQ · STATUS';
// research whiteboard
wallPanel(5.5, 9.4, 46, 102, '#eef1f5');
const resT = [wallText(5.75, 90, 10, '#3a3f4b', 800), ...[0, 1, 2, 3].map(i => wallText(5.75, 78 - i * 9, 9.5, '#1d2230', 600))];
resT[0].textContent = 'STOCK WATCHLIST';
// diagnostics heartbeat monitor
wallPanel(20.5, 24.4, 46, 102, '#eef1f5');
const stratT = [wallText(20.75, 90, 10, '#3a3f4b', 800), ...[0, 1, 2, 3].map(i => wallText(20.75, 78 - i * 9, 9.5, '#1d2230', 600))];
stratT[0].textContent = 'DIP DESK · RSI(2) < 5';
wallPanel(10.6, 14.4, 52, 100);
const diagT = wallText(10.85, 90, 10, '#8fe3b0', 700); diagT.textContent = 'SYSTEM HEARTBEAT';
const heart = el('polyline', { fill: 'none', stroke: '#3ddc84', 'stroke-width': 2 }, L.walls);
const diagS = wallText(10.85, 58, 9, '#c9d2e6');
// trading floor ticker on left wall
const tickScr = poly([iso(.04, 8.6, 40), iso(.04, 13.4, 40), iso(.04, 13.4, 96), iso(.04, 8.6, 96)], '#0b1220', L.walls, { stroke: '#2d3a58', 'stroke-width': 2 });
const spark = el('polyline', { fill: 'none', stroke: '#3ddc84', 'stroke-width': 2.2 }, L.walls);
const tickP = iso(.04, 13.2, 84); const tickT = el('text', { x: 0, y: 0, fill: '#8fb0ff', 'font-size': 11, 'font-weight': 700, transform: `matrix(1,-0.5,0,1,${tickP[0].toFixed(1)},${tickP[1].toFixed(1)})` }, L.walls);

// depth-sorted objects
const objs = [];
function obj(depth) { const g = el('g', {}); objs.push({ g, depth }); return g; }
function sortObjs() { objs.sort((a, b) => a.depth - b.depth); for (const o of objs) L.objs.appendChild(o.g); }
function box(g, x, y, w, d, h, col, z0 = 0) {
  const t = z0 + h;
  poly([iso(x, y + d, z0), iso(x + w, y + d, z0), iso(x + w, y + d, t), iso(x, y + d, t)], shade(col, -26), g);
  poly([iso(x + w, y, z0), iso(x + w, y + d, z0), iso(x + w, y + d, t), iso(x + w, y, t)], shade(col, -46), g);
  poly([iso(x, y, t), iso(x + w, y, t), iso(x + w, y + d, t), iso(x, y + d, t)], col, g);
}
function glass(x0, y0, x1, y1, h) {
  // split into 1-tile panes for correct depth
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i < n; i++) {
    const ax = x0 + (x1 - x0) * i / n, ay = y0 + (y1 - y0) * i / n, bx = x0 + (x1 - x0) * (i + 1) / n, by = y0 + (y1 - y0) * (i + 1) / n;
    const g = obj((ax + bx) / 2 + (ay + by) / 2 + .02);
    poly([iso(ax, ay), iso(bx, by), iso(bx, by, h), iso(ax, ay, h)], 'rgba(160,205,255,.09)', g);
    const t1 = iso(ax, ay, h), t2 = iso(bx, by, h); el('line', { x1: t1[0], y1: t1[1], x2: t2[0], y2: t2[1], stroke: 'rgba(205,228,255,.5)', 'stroke-width': 1.4 }, g);
    const b1 = iso(ax, ay), b2 = iso(bx, by); el('line', { x1: b1[0], y1: b1[1], x2: b2[0], y2: b2[1], stroke: 'rgba(205,228,255,.25)', 'stroke-width': 2 }, g);
    if (i === 0) { const p = iso(ax, ay); el('line', { x1: p[0], y1: p[1], x2: t1[0], y2: t1[1], stroke: 'rgba(205,228,255,.45)', 'stroke-width': 1.6 }, g); }
    if (i === n - 1) { const p = iso(bx, by); el('line', { x1: p[0], y1: p[1], x2: t2[0], y2: t2[1], stroke: 'rgba(205,228,255,.45)', 'stroke-width': 1.6 }, g); }
  }
}
// partitions between back rooms and along the hall, with door gaps
for (const x of [5, 10, 15, 20]) glass(x, 0, x, 6, 66);
for (const x of [10, 15, 20]) glass(x, 8, x, 14, 30);
function wallWithDoors(y, h, doors) {
  let x = 0; for (const dx of [...doors, 99].sort((a, b) => a - b)) { const e = Math.min(dx - .8, W); if (e > x + .05) glass(x, y, e, y, h); x = dx + .8; if (x >= W) break; }
}
wallWithDoors(6, 66, ['lobby', 'research', 'diagnostics', 'freedom', 'strategy'].map(doorX));
wallWithDoors(8, 26, ['trading', 'risk', 'vault', 'breakroom'].map(doorX));

// furniture
const glows = [];
function plant(x, y, s = 1) { const g = obj(x + y + .6); box(g, x, y, .5, .5, 14 * s, '#d9dbe0'); const c = iso(x + .25, y + .25, 14 * s);
  for (const [dx, dy, r, col] of [[0, -26, 15, '#3e8f5a'], [-10, -16, 12, '#357d4e'], [11, -15, 12, '#479c63'], [0, -38, 10, '#55ad70'], [-5, -30, 9, '#2f6f45']]) el('ellipse', { cx: c[0] + dx * s, cy: c[1] + dy * s, rx: r * s, ry: r * s * .8, fill: col }, g); }
function lamp(x, y) { const g = obj(x + y + .2); const a = iso(x, y), b = iso(x, y, 74); el('ellipse', { cx: a[0], cy: a[1], rx: 9, ry: 4.5, fill: '#2a2d35' }, g);
  el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#2a2d35', 'stroke-width': 3 }, g);
  el('path', { d: `M${b[0] - 14},${b[1] + 8} L${b[0] - 8},${b[1] - 8} L${b[0] + 8},${b[1] - 8} L${b[0] + 14},${b[1] + 8} Z`, fill: '#f6e7c4' }, g);
  glows.push(el('ellipse', { cx: a[0], cy: a[1], rx: 120, ry: 60, fill: 'url(#glow)', class: 'glowf' }, L.glow)); }
function desk(x, y, col = '#5b4a3c', scr = '#5b7cff', w = 1.6) { const g = obj(x + y + w + .1); box(g, x, y, w, .9, 22, col);
  box(g, x + w / 2 - .25, y + .3, .5, .1, 24, '#1d2230', 22); poly([iso(x + w / 2 - .22, y + .4, 26), iso(x + w / 2 + .22, y + .4, 26), iso(x + w / 2 + .22, y + .4, 44), iso(x + w / 2 - .22, y + .4, 44)], scr, g, { opacity: .92 });
  const c = iso(x + w / 2, y + .9); glows.push(el('ellipse', { cx: c[0], cy: c[1] + 8, rx: 60, ry: 28, fill: 'url(#sglow)', class: 'glowf' }, L.glow));
  const ch = obj(x + y + w / 2 + 1.6); box(ch, x + w / 2 - .22, y + 1.15, .44, .4, 12, '#2b3040'); box(ch, x + w / 2 - .22, y + 1.45, .44, .1, 26, '#2b3040'); return g; }
function shelf(x, y, w = .6, d = 2.4) { const g = obj(x + y + w + d); box(g, x, y, w, d, 70, '#4b3a2c'); const cols = ['#c25b4a', '#4a7ac2', '#d9b04c', '#5aa772', '#8a5ac2', '#c2874a'];
  const n = Math.floor(d / .36); for (let r = 0; r < 3; r++) for (let i = 0; i < n; i++) { const yy = y + .1 + i * .36, z = 10 + r * 20; poly([iso(x + w, yy, z), iso(x + w, yy + .26, z), iso(x + w, yy + .26, z + 15), iso(x + w, yy, z + 15)], cols[(i + r) % 6], g); } }
function couch(x, y, col = '#3c4a6b') { const g = obj(x + y + 2.9); box(g, x, y, 2.2, .9, 12, col); box(g, x, y, 2.2, .25, 26, shade(col, -8)); box(g, x, y, .25, .9, 20, shade(col, -8)); box(g, x + 1.95, y, .25, .9, 20, shade(col, -8)); }
function rack(x, y, label) { const g = obj(x + y + 1.4); box(g, x, y, .8, .8, 78, '#1b1f29'); for (let r = 0; r < 6; r++) { const p = iso(x + .15, y + .8, 12 + r * 10);
  ['', ' b', ' c'].forEach((k, i) => el('circle', { cx: p[0] + i * 7, cy: p[1] + i * 3.5, r: 2, fill: i === 2 ? '#ff8a3d' : '#3ddc84', class: 'led' + k }, g)); }
  if (label) { const t = iso(x + .4, y + .4, 84); const tx = el('text', { x: t[0], y: t[1], fill: '#8fe3b0', 'font-size': 9, 'font-weight': 700, 'text-anchor': 'middle' }, g); tx.textContent = label; } }
function safe(x, y) { const g = obj(x + y + 2); box(g, x, y, 1.1, 1, 40, '#6f6a5c'); const c = iso(x + .55, y + 1, 20); el('circle', { cx: c[0], cy: c[1], r: 9, fill: '#3a372f', stroke: '#d4c497', 'stroke-width': 2.4 }, g); el('line', { x1: c[0], y1: c[1], x2: c[0] + 6, y2: c[1] - 4, stroke: '#d4c497', 'stroke-width': 2 }, g); }
function cabinet(x, y) { const g = obj(x + y + 1.2); box(g, x, y, .6, .6, 34, '#57606f'); for (const z of [8, 20]) { const p = iso(x + .3, y + .6, z); el('rect', { x: p[0] - 5, y: p[1] - 1, width: 10, height: 2, fill: '#c8ccd6' }, g); } }
function rtable(x, y) { const g = obj(x + y + .3); const c = iso(x, y, 22), b = iso(x, y); el('line', { x1: b[0], y1: b[1], x2: c[0], y2: c[1], stroke: '#3a2f27', 'stroke-width': 5 }, g);
  el('ellipse', { cx: c[0], cy: c[1] + 4, rx: 56, ry: 28, fill: '#4d3b2c' }, g); el('ellipse', { cx: c[0], cy: c[1], rx: 56, ry: 28, fill: '#6b5440' }, g);
  const pz = el('g', {}, g); for (let i = 0; i < 3; i++) el('rect', { x: c[0] - 18 + i * 12, y: c[1] - 6 + (i % 2) * 6, width: 14, height: 9, rx: 1.5, fill: '#eef1f5', transform: `rotate(-12 ${c[0]} ${c[1]})` }, pz); }
function stool(x, y, col = '#2b3040') { const g = obj(x + y + .4); box(g, x - .2, y - .2, .4, .4, 14, col); }
function coffee(x, y) { const g = obj(x + y + 1.7); box(g, x, y, 1.1, .7, 26, '#3a2f27'); box(g, x + .2, y + .15, .45, .35, 18, '#22262f', 26); }
function cooler(x, y) { const g = obj(x + y + .8); box(g, x, y, .45, .45, 30, '#dfe3ea'); const c = iso(x + .22, y + .22, 44); el('ellipse', { cx: c[0], cy: c[1], rx: 9, ry: 12, fill: 'rgba(120,180,255,.75)' }, g); }
function reception(x, y) { const g = obj(x + y + 3.4); box(g, x, y, 2.6, .8, 30, '#a07a52'); box(g, x, y, 2.6, .12, 36, '#c49a6c', 0);
  const p = iso(x + 1.3, y + .8, 16); const t = el('text', { x: p[0], y: p[1], fill: '#fff6e6', 'font-size': 10, 'font-weight': 800, 'text-anchor': 'middle', 'letter-spacing': 2 }, g); t.textContent = 'TESTSTOCK'; }

// lobby
reception(1.1, 1.4); couch(.5, 4.4, '#4b5a7d'); desk(3.1, 2.9, '#3a2f27', '#ff8a3d'); { const p = iso(3.9, 2.9, 62); const t = el('text', { x: p[0], y: p[1], fill: '#ffb27a', 'font-size': 9, 'font-weight': 800, 'text-anchor': 'middle', 'letter-spacing': 1.5 }, L.walls); t.textContent = 'CEO'; } lamp(.6, 3.6); plant(4.3, .35, 1.1); cooler(3.6, .4);
// research
desk(5.6, 1.2, '#4e5d62', '#3ddc84'); desk(7.9, 1.2, '#4e5d62', '#3ccfcf'); shelf(9.2, 2.8, .6, 2.6); plant(5.35, 5.2, .85);
// diagnostics
rack(10.3, .35, 'GITHUB'); rack(11.25, .35); rack(12.2, .35, 'MONITOR'); desk(12.9, 2.6, '#3e4558', '#3ddc84'); plant(14.3, 5.2, .85);
// freedom
rtable(17.4, 2.9); stool(16.5, 2.6); stool(18.3, 3.2); stool(17.3, 3.9); plant(19.35, .4, 1.15); lamp(19.3, 5.2);
// hall
plant(.35, 6.3, .8); plant(24.3, 6.3, .8);
// trading
desk(1.6, 9.2, '#5b4a3c', '#ff8a3d', 1.8); desk(4.6, 9.2, '#5b4a3c', '#a78bfa', 1.8); rack(8.6, 8.5, 'ROBINHOOD'); plant(.4, 13.2, .95); plant(9.3, 13.2, .95); coffee(6.6, 12.9);
poly([iso(1.4, 11.6), iso(7.6, 11.6), iso(7.6, 13.4), iso(1.4, 13.4)], '#2a3557', L.decal, { opacity: .7 });
// risk
desk(11.4, 9.2, '#5a3a44', '#ff6b7a'); cabinet(14.2, 8.6); plant(14.3, 13.2, .9); lamp(10.6, 13.3);
// strategy lab
desk(21.0, 1.4, '#4a3d66', '#38bdf8', 1.8); desk(23.0, 3.2, '#4a3d66', '#a78bfa'); shelf(20.3, 3.0, .6, 2.6); plant(24.4, .4, 1.1);
// break room
couch(20.6, 12.6, '#8a5a44'); coffee(23.7, 8.6); cooler(22.9, 8.6);
{ const g = obj(21.0 + 9.0 + 1.6); box(g, 21.0, 9.4, 1.6, .9, 18, '#2f7a5b'); const a = iso(21.8, 9.4, 18), b = iso(21.8, 10.3, 18), c = iso(21.8, 10.3, 26), d = iso(21.8, 9.4, 26); poly([a, b, c, d], 'rgba(255,255,255,.55)', g); }
{ const g = obj(24.2 + 11.0 + 1.4); box(g, 24.2, 10.6, .7, .7, 58, '#3b2b6b'); poly([iso(24.2, 11.3, 34), iso(24.9, 11.3, 34), iso(24.9, 11.3, 52), iso(24.2, 11.3, 52)], '#ff5cc8', g, { class: 'led' }); }
plant(24.4, 13.3, .9); lamp(20.4, 11.0);
// vault
safe(18.3, 8.6); cabinet(15.6, 8.55); cabinet(16.3, 8.55); shelf(19.3, 10.6, .6, 2.6); lamp(15.7, 13.3);

// clickable room hit areas
const hits = {};
for (const id of ROOM_IDS) { const r = ROOMS[id]; hits[id] = poly([iso(r.x0, r.y0), iso(r.x1, r.y0), iso(r.x1, r.y1), iso(r.x0, r.y1)], 'transparent', L.hit, { class: 'roomhit' }); hits[id].addEventListener('click', () => { if (!moved) location.hash = id; }); }

/* ============================== characters ============================== */
const AG = {
  claude:  { name: 'Claude',  role: 'CEO · reads every report, sets pay', room: 'lobby', home: [3.9, 4.6], color: '#ff8a3d', kind: 'ceo', boss: null, title: 'CEO' },
  atlas:   { name: 'Atlas',   role: 'COO · runs operations', room: 'lobby', home: [1.6, 3.3], color: '#e9edf3', kind: 'chief', boss: 'claude', title: 'COO' },
  scout:   { name: 'Scout',   role: 'Crypto scanner · 8 coins hourly', room: 'research', home: [6.4, 3.0], color: '#3ddc84', kind: 'robot' , boss: 'analyst', title: 'Crypto scanner' },
  analyst: { name: 'Analyst', role: 'Stock research · watchlist & regime', room: 'research', home: [8.7, 3.0], color: '#3ccfcf', kind: 'cat' , boss: 'claude', title: 'Head of Research' },
  medic:   { name: 'Medic',   role: 'Diagnostics · data freshness & runners', room: 'diagnostics', home: [13.6, 4.2], color: '#ff6b7a', kind: 'medic' , boss: 'atlas', title: 'Diagnostics' },
  planner: { name: 'Planner', role: 'Financial-freedom planning', room: 'freedom', home: [16.3, 4.4], color: '#c58b5a', kind: 'bear' , boss: 'atlas', title: 'Planning' },
  options: { name: 'Options', role: 'Options trader · put credit spreads', room: 'trading', home: [5.5, 11.1], color: '#a78bfa', kind: 'penguin' , boss: 'guard', title: 'Options desk' },
  guard:   { name: 'Guard',   role: 'Risk officer · approves or blocks', room: 'risk', home: [12.2, 11.4], color: '#ff5c6c', kind: 'astro' , boss: 'claude', title: 'Chief Risk Officer' },
  ledger:  { name: 'Ledger',  role: 'Bookkeeper · every fill & P&L', room: 'vault', home: [17.3, 11.2], color: '#f5c451', kind: 'owl' , boss: 'atlas', title: 'Bookkeeper' },
  quinn:   { name: 'Quinn',   role: 'Strategist · runs the live Dip desk', room: 'strategy', home: [21.9, 3.0], color: '#38bdf8', kind: 'bunny', boss: 'analyst', title: 'Strategist' },
  sim:     { name: 'Sim',     role: 'Paper Lab · 5 options variants, no real money', room: 'research', home: [6.1, 4.7], color: '#a3e635', kind: 'robot' , boss: 'analyst', title: 'Paper Lab' },
  echo:    { name: 'Echo',    role: 'Paper Lab · crypto with no filters, no real money', room: 'research', home: [8.6, 4.8], color: '#f472b6', kind: 'cat' , boss: 'analyst', title: 'Paper Lab' },
};
function charSVG(kind, c) {
  const leg = shade(c, -34);
  const legs = `<rect x="-9" y="-12" width="7" height="11" rx="3.5" fill="${leg}"/><rect x="2" y="-12" width="7" height="11" rx="3.5" fill="${leg}"/>`;
  const eyes = (y = 0, col = '#13161c') => `<g class="blink"><circle cx="-5.5" cy="${-35 + y}" r="2.5" fill="${col}"/><circle cx="5.5" cy="${-35 + y}" r="2.5" fill="${col}"/></g>`;
  const B = {
    ceo: `${legs.replace(new RegExp(leg, 'g'), '#5a4636')}<rect x="-13" y="-30" width="26" height="22" rx="9" fill="#2b2f3a"/><path d="M-5,-30 L0,-14 L5,-30 Z" fill="#f4f5f8"/><path d="M-2,-28 L0,-16 L2,-28 Z" fill="${c}"/><circle cx="0" cy="-37" r="13.5" fill="#f3efe9"/><rect x="-10.5" y="-43" width="21" height="13" rx="6.5" fill="#1a1f2a"/><circle cx="-5" cy="-36.5" r="2.4" fill="${c}" class="blink"/><circle cx="5" cy="-36.5" r="2.4" fill="${c}" class="blink"/><path d="M-9,-50 L-9,-57 L-4.5,-53 L0,-59 L4.5,-53 L9,-57 L9,-50 Z" fill="#f5c451"/>`,
    chief: `${legs.replace(new RegExp(leg, 'g'), '#9aa3b5')}<rect x="-13" y="-30" width="26" height="22" rx="9" fill="#eef1f6"/><path d="M-6,-27 L0,-23 L6,-27 L6,-19 L0,-23 L-6,-19 Z" fill="#ff5c6c"/><circle cx="0" cy="-37" r="13.5" fill="#eef1f6"/><rect x="-10.5" y="-43" width="21" height="13" rx="6.5" fill="#1a1f2a"/><circle cx="-5" cy="-36.5" r="2.4" fill="#7cc4ff" class="blink"/><circle cx="5" cy="-36.5" r="2.4" fill="#7cc4ff" class="blink"/><rect x="-7" y="-55" width="14" height="5" rx="2" fill="#2a2f3c"/><rect x="-4.5" y="-61" width="9" height="7" rx="2" fill="#2a2f3c"/>`,
    robot: `${legs}<rect x="-13" y="-30" width="26" height="22" rx="9" fill="${c}"/><rect x="-6" y="-24" width="12" height="8" rx="2" fill="#0e1117" opacity=".3"/><circle cx="0" cy="-37" r="13" fill="#eef1f6"/><rect x="-10" y="-42" width="20" height="12" rx="6" fill="#1a1f2a"/><circle cx="-5" cy="-36" r="2.4" fill="#5df2a0" class="blink"/><circle cx="5" cy="-36" r="2.4" fill="#5df2a0" class="blink"/><line x1="0" y1="-50" x2="0" y2="-58" stroke="#cfd5df" stroke-width="2"/><circle cx="0" cy="-59" r="3" fill="${c}" class="led"/>`,
    cat: `${legs}<rect x="-12" y="-29" width="24" height="21" rx="9" fill="${c}"/><path d="M-12,-42 L-10,-55 L-3,-46 Z" fill="${c}"/><path d="M12,-42 L10,-55 L3,-46 Z" fill="${c}"/><circle cx="0" cy="-37" r="13" fill="${c}"/><ellipse cx="0" cy="-32" rx="8" ry="5.5" fill="#e8fbfb"/>${eyes(-1)}<circle cx="-5.5" cy="-36" r="5" fill="none" stroke="#13161c" stroke-width="1.5"/><circle cx="5.5" cy="-36" r="5" fill="none" stroke="#13161c" stroke-width="1.5"/><path d="M-2,-30 L2,-30 L0,-28 Z" fill="#ff8aa8"/><rect x="-7" y="-22" width="14" height="10" rx="1.5" fill="#f5f6f9"/>`,
    medic: `${legs}<rect x="-13" y="-30" width="26" height="22" rx="9" fill="#f3f5f9"/><rect x="-2.5" y="-27" width="5" height="14" fill="${c}"/><rect x="-7" y="-22.5" width="14" height="5" fill="${c}"/><circle cx="0" cy="-37" r="13" fill="#f3f5f9"/><rect x="-10" y="-42" width="20" height="12" rx="6" fill="#1a1f2a"/><circle cx="-5" cy="-36" r="2.4" fill="#ff8a96" class="blink"/><circle cx="5" cy="-36" r="2.4" fill="#ff8a96" class="blink"/><path d="M-13,-44 Q0,-58 13,-44" stroke="${c}" stroke-width="3" fill="none"/>`,
    bear: `${legs}<ellipse cx="0" cy="-21" rx="14" ry="14" fill="${c}"/><ellipse cx="0" cy="-19" rx="8" ry="8" fill="#f0d9bf"/><circle cx="-10" cy="-47" r="5" fill="${c}"/><circle cx="10" cy="-47" r="5" fill="${c}"/><circle cx="0" cy="-37" r="13" fill="${c}"/><ellipse cx="0" cy="-32" rx="6.5" ry="5" fill="#f0d9bf"/>${eyes(-1)}<circle cx="0" cy="-33" r="2" fill="#13161c"/><rect x="8" y="-30" width="10" height="13" rx="1.5" fill="#fff" transform="rotate(12 13 -24)"/><line x1="10" y1="-26" x2="16" y2="-25" stroke="#7c78ff" stroke-width="1.2"/>`,
    fox: `${legs}<rect x="-12" y="-29" width="24" height="21" rx="9" fill="${c}"/><ellipse cx="0" cy="-20" rx="7" ry="8" fill="#fde9d6"/><path d="M-13,-41 L-9,-57 L-2,-45 Z" fill="${c}"/><path d="M13,-41 L9,-57 L2,-45 Z" fill="${c}"/><circle cx="0" cy="-37" r="13" fill="${c}"/><ellipse cx="0" cy="-32" rx="8" ry="6" fill="#fde9d6"/>${eyes(0)}<circle cx="0" cy="-30" r="2" fill="#13161c"/><path d="M14,-14 Q27,-20 20,-33" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
    penguin: `${legs.replace(new RegExp(leg, 'g'), '#f5a524')}<ellipse cx="0" cy="-22" rx="14" ry="15" fill="#1d2230"/><ellipse cx="0" cy="-20" rx="9" ry="11" fill="#f4f5f8"/><circle cx="0" cy="-38" r="12" fill="#1d2230"/><ellipse cx="0" cy="-36" rx="8" ry="7" fill="#f4f5f8"/>${eyes(-1)}<path d="M-3,-31 L3,-31 L0,-27 Z" fill="#f5a524"/><rect x="-12" y="-27" width="24" height="5" rx="2.5" fill="${c}"/>`,
    astro: `${legs}<rect x="-13" y="-30" width="26" height="22" rx="9" fill="#e9edf3"/><rect x="-4" y="-25" width="8" height="6" rx="1.5" fill="${c}"/><circle cx="0" cy="-38" r="14" fill="#f3f5f9"/><rect x="-10" y="-44" width="20" height="13" rx="6.5" fill="${c}" opacity=".88"/><circle cx="-4" cy="-39" r="2.2" fill="#fff" opacity=".8"/>`,
    bunny: `${legs}<ellipse cx="0" cy="-21" rx="13" ry="14" fill="${c}"/><ellipse cx="0" cy="-18" rx="7" ry="8" fill="#eaf8ff"/><ellipse cx="-6" cy="-56" rx="4" ry="11" fill="${c}"/><ellipse cx="6" cy="-56" rx="4" ry="11" fill="${c}"/><ellipse cx="-6" cy="-56" rx="2" ry="7" fill="#ffd1e8"/><ellipse cx="6" cy="-56" rx="2" ry="7" fill="#ffd1e8"/><circle cx="0" cy="-37" r="12.5" fill="${c}"/><ellipse cx="0" cy="-32" rx="7" ry="5" fill="#eaf8ff"/>${eyes(-1)}<circle cx="0" cy="-32" r="1.8" fill="#ff8aa8"/><rect x="9" y="-31" width="10" height="13" rx="1.5" fill="#fff" transform="rotate(10 14 -24)"/><polyline points="10,-22 13,-26 15,-24 18,-29" stroke="#3ddc84" stroke-width="1.4" fill="none" transform="rotate(10 14 -24)"/>`,
    owl: `${legs}<ellipse cx="0" cy="-24" rx="14" ry="16" fill="${c}"/><ellipse cx="0" cy="-20" rx="8" ry="9" fill="#fff4d6"/><circle cx="0" cy="-38" r="12" fill="${c}"/><path d="M-11,-46 L-7,-53 L-4,-46 Z" fill="${shade(c, -40)}"/><path d="M11,-46 L7,-53 L4,-46 Z" fill="${shade(c, -40)}"/><circle cx="-5.5" cy="-38" r="5" fill="#fff"/><circle cx="5.5" cy="-38" r="5" fill="#fff"/><circle cx="-5.5" cy="-38" r="5" fill="none" stroke="#2a2d35" stroke-width="1.6"/><circle cx="5.5" cy="-38" r="5" fill="none" stroke="#2a2d35" stroke-width="1.6"/><g class="blink"><circle cx="-5.5" cy="-38" r="2" fill="#13161c"/><circle cx="5.5" cy="-38" r="2" fill="#13161c"/></g><path d="M-2,-33 L2,-33 L0,-30 Z" fill="#e0782c"/>`,
  };
  return `<ellipse cx="0" cy="0" rx="15" ry="5" fill="#000" opacity=".35"/><g class="bodyg">${B[kind]}</g>`;
}
const agents = {};
for (const [k, a] of Object.entries(AG)) {
  const o = { g: el('g', { class: 'agent idle' }), depth: 0 }; objs.push(o);
  o.g.innerHTML = charSVG(a.kind, a.color);
  const tag = el('g', { class: 'agtag' }, L.tags); const rect = el('rect', { rx: 9, ry: 9, height: 19 }, tag); const dot = el('circle', { r: 3.4, fill: '#8a91a0' }, tag); const tx = el('text', {}, tag); tx.textContent = a.name;
  const fo = el('foreignObject', { width: 230, height: 120 }, L.tags); fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="bubwrap"><div class="bub"></div></div>`;
  const ag = agents[k] = { k, ...a, o, rect, dot, tx, tag, fo, bub: fo.querySelector('.bub'), x: a.home[0], y: a.home[1], flip: false, path: [], speed: rnd(2.1, 2.7), busy: 0, state: 'idle', doing: '', resolve: null };
  o.g.addEventListener('click', e => { e.stopPropagation(); focusAgent(k); });
}
function place(a) {
  const [X, Y] = iso(a.x, a.y); a.o.g.setAttribute('transform', `translate(${X.toFixed(1)},${Y.toFixed(1)}) scale(${a.flip ? -1 : 1},1)`); a.o.depth = a.x + a.y + .45;
  const w = (a.name.length * 6.6) + 26; a.rect.setAttribute('width', w); a.rect.setAttribute('x', X - w / 2); a.rect.setAttribute('y', Y - 90);
  a.dot.setAttribute('cx', X - w / 2 + 10); a.dot.setAttribute('cy', Y - 80.5); a.tx.setAttribute('x', X - w / 2 + 18); a.tx.setAttribute('y', Y - 76.5);
  a.fo.setAttribute('x', X - 115); a.fo.setAttribute('y', Y - 212);
  const k = 1 / Math.max(1, cam.s * .75), t = `translate(${X.toFixed(1)},${(Y - 72).toFixed(1)}) scale(${k.toFixed(3)}) translate(${(-X).toFixed(1)},${(-(Y - 72)).toFixed(1)})`;
  a.fo.setAttribute('transform', t); a.tag.setAttribute('transform', t);
}
Object.values(agents).forEach(place); sortObjs();

/* ============================== movement ============================== */
let paused = false;
function route(a, tx, ty) {
  const from = roomOf(a.x, a.y), to = roomOf(tx, ty);
  if (from === to) return [[tx, ty]];
  const pts = []; const goingRight = tx > a.x; const lane = goingRight ? 6.62 + rnd(-.06, .06) : 7.38 + rnd(-.06, .06);
  if (from !== 'hall') { const dx = doorX(from) + rnd(-.3, .3); const inside = isBack(from) ? 5.4 : 8.6; pts.push([dx, inside], [dx, lane]); }
  else pts.push([a.x, lane]);
  if (to !== 'hall') { const dx = doorX(to) + rnd(-.3, .3); const inside = isBack(to) ? 5.4 : 8.6; pts.push([dx, lane], [dx, inside]); }
  pts.push([tx, ty]); return pts;
}
function walkTo(a, tx, ty, label) {
  a.path = route(a, tx, ty); a.state = 'walk'; a.doing = label || ('Walking to ' + ROOMS[roomOf(tx, ty)].short);
  a.o.g.setAttribute('class', 'agent walking');
  return new Promise(res => { a.resolve = res; });
}
const goHome = a => walkTo(a, a.home[0] + rnd(-.25, .25), a.home[1] + rnd(-.2, .2), 'Back to ' + ROOMS[a.room].short);
let last = performance.now();
function tick(t) {
  const dt = Math.min(.05, (t - last) / 1000); last = t; let movedAny = false;
  if (!paused) for (const a of Object.values(agents)) {
    if (!a.path.length) continue;
    const [tx, ty] = a.path[0]; const dx = tx - a.x, dy = ty - a.y; const d = Math.hypot(dx, dy); const step = a.speed * dt;
    const sx = iso(tx, ty)[0] - iso(a.x, a.y)[0]; if (Math.abs(sx) > .5) a.flip = sx < 0;
    if (d <= step) { a.x = tx; a.y = ty; a.path.shift(); if (!a.path.length) { a.state = 'idle'; a.o.g.setAttribute('class', 'agent idle'); const r = a.resolve; a.resolve = null; r && r(); } }
    else { a.x += dx / d * step; a.y += dy / d * step; }
    place(a); movedAny = true;
  }
  if (movedAny) sortObjs();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
async function say(a, html, ms) {
  while (paused) await sleep(300);
  a.bub.innerHTML = html; a.bub.classList.add('on'); const prev = a.state; a.state = 'talk';
  await sleep(ms || Math.min(7000, 2000 + html.replace(/<[^>]+>/g, '').length * 42));
  a.bub.classList.remove('on'); if (a.state === 'talk') a.state = prev === 'talk' ? 'idle' : prev; await sleep(250);
}
async function waitFree(a) { while (a.busy || paused) await sleep(250); }
// visit: a walks over to b, they talk, a goes home
async function visit(a, b, lines) {
  await waitFree(a); a.busy++;
  try {
    await walkTo(a, b.x + (b.x > 10 ? -.9 : .9), b.y + .35, 'Visiting ' + b.name);
    a.flip = iso(b.x, b.y)[0] < iso(a.x, a.y)[0]; place(a);
    const bFree = !b.busy && b.state !== 'walk';
    if (bFree) { b.busy++; b.flip = !a.flip; place(b); }
    for (const [who, text] of lines) { if (who === 'b' && !bFree) continue; await say(who === 'a' ? a : b, text); }
    if (bFree) b.busy--;
    await sleep(400); await goHome(a);
  } finally { a.busy--; }
}
async function wander(a, pts) { await waitFree(a); a.busy++; try { const [x, y] = pick(pts); await walkTo(a, x, y, 'Working'); a.doing = 'Working'; await sleep(rnd(1500, 3500)); } finally { a.busy--; } }

/* ============================== data ============================== */
const D = {};
async function refresh() {
  const [sig, led, oled, health, latest, ocfg, ccfg, obt, pled, audit, dled, dbt, dcfg, dtp, dtbt, bled] = await Promise.all([
    getJSON('docs/data/claudebot-signal.json'), getJSON('docs/data/claudebot-ledger.json'), getJSON('docs/data/claudebot-options-ledger.json'),
    getJSON('docs/data/live-trading-health.json'), getJSON('docs/data/latest-50.json'), getJSON('claudebot/options_config.json'), getJSON('claudebot/config.json'),
    getJSON('docs/data/claudebot-options-robustness.json'), getJSON('docs/data/claudebot-paper-ledger.json'), getJSON('docs/data/claudebot-audit.json'), getJSON('docs/data/claudebot-dip-ledger.json'), getJSON('docs/data/claudebot-dip-backtest.json'), getJSON('claudebot/dip_config.json'), getJSON('docs/data/claudebot-daytrade-paper.json'), getJSON('docs/data/claudebot-daytrade-backtest.json'), getJSON('docs/data/claudebot-optbuy-ledger.json')]);
  Object.assign(D, { sig, led, oled, health, latest, ocfg, ccfg, obt, pled, audit, dled, dbt, dcfg, dtp, dtbt, bled });
  renderAll();
}
function botHealth() {
  const sigAge = D.sig ? (Date.now() - new Date(D.sig.generatedAt)) / 6e4 : Infinity;
  const runs = [...(D.led?.runs || []), ...(D.oled?.runs || [])].sort((a, b) => new Date(b.t) - new Date(a.t));
  const runAge = runs[0] ? (Date.now() - new Date(runs[0].t)) / 6e4 : Infinity;
  const errs = runs.filter(r => r.action === 'error' && (Date.now() - new Date(r.t)) < 864e5).length;
  const issues = [];
  if (sigAge > 150) issues.push(`price scan ${Math.round(sigAge)}m old`);
  if (runAge > 130) issues.push(`trader last ran ${isFinite(runAge) ? Math.round(runAge) + 'm' : 'never'} ago`);
  if (errs) issues.push(`${errs} error${errs > 1 ? 's' : ''} in 24h`);
  return { ok: !issues.length, status: issues.length ? 'CHECK' : 'HEALTHY', issues, sigAge, runAge };
}
function tradingToday() {
  const ev = blackoutToday(); const ct = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const wk = ct.getDay() > 0 && ct.getDay() < 6, mins = ct.getHours() * 60 + ct.getMinutes();
  if (ev) return ['PAUSED', 'options: ' + ev, 'warn'];
  if (!wk) return ['WEEKEND', 'options closed · crypto 24/7', ''];
  if (mins < 540) return ['PRE-OPEN', 'options entries from 9:00 CT', ''];
  if (mins <= 810) return ['OPEN', 'options entries until 1:30 CT', 'up'];
  return ['CLOSED', 'options entries done today', ''];
}
const cryptoIdx = () => { const s = D.led?.snapshots || []; return s.length ? s[s.length - 1].index : (D.led?.equityIndex ?? 100); };
const livePos = () => [D.led?.open?.symbol, D.oled?.mode === 'live' ? D.oled?.open?.label : null, ...((D.dled?.positions ?? (D.dled?.open ? [D.dled.open] : [])).map(x => x.symbol)), D.bled?.open?.label].filter(Boolean);
const paperSpread = () => D.oled?.mode !== 'live' && D.oled?.open ? D.oled.open.label : null;
const optPnl = () => (D.oled?.mode === 'live' ? (D.oled?.trades || []) : []).reduce((a, t) => a + t.pnlUsd, 0) + (D.bled?.trades || []).reduce((a, t) => a + t.pnlUsd, 0);
const dipPnl = () => (D.dled?.trades || []).reduce((a, t) => a + t.pnlUsd, 0);
const todayCT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const blackoutToday = () => D.ocfg?.risk?.noNewEntryDates?.[todayCT()];
function freedomPlan() { let saved = {}; try { saved = JSON.parse(localStorage.getItem('hq-freedom') || '{}'); } catch (e) {} try { return projectPlan({ ...DEFAULT_PLAN, ...saved }); } catch (e) { return projectPlan(DEFAULT_PLAN); } }

/* ============================== 🎮 office payroll (game) ============================== */
// Just for fun: agents earn made-up "HQ credits" based on how well they did their real jobs.
// No real money is paid. Credits are not dollars.
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const ageMin = t => t ? (Date.now() - new Date(t)) / 6e4 : Infinity;
const freshScore = (age, good, bad) => age <= good ? 100 : age >= bad ? 20 : Math.round(100 - (age - good) / (bad - good) * 80);
function weekStart(offsetWeeks = 0) { const ct = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })); const d = new Date(ct); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * offsetWeeks); return d; }
function companyResult(offsetWeeks = 0) {
  const a = weekStart(offsetWeeks), b = weekStart(offsetWeeks - 1); const inWk = t => { const x = new Date(new Date(t).toLocaleString('en-US', { timeZone: 'America/Chicago' })); return x >= a && x < b; };
  const acct = D.ocfg?.backtest?.startingAccountUsd || 113;
  const liveOpt = [...(D.oled?.mode === 'live' ? (D.oled?.trades || []) : []), ...(D.bled?.trades || [])];
  const opt = liveOpt.filter(t => inWk(t.exitedAt)).reduce((s, t) => s + t.pnlUsd, 0);
  const cry = (D.led?.trades || []).filter(t => inWk(t.exitedAt)).reduce((s, t) => s + (t.accountImpactPct || 0) / 100 * acct, 0);
  const dip = (D.dled?.trades || []).filter(t => inWk(t.exitedAt)).reduce((s, t) => s + t.pnlUsd, 0);
  const n = liveOpt.filter(t => inWk(t.exitedAt)).length + (D.led?.trades || []).filter(t => inWk(t.exitedAt)).length + (D.dled?.trades || []).filter(t => inWk(t.exitedAt)).length;
  const usdv = Math.round((opt + cry + dip) * 100) / 100;
  const verdict = usdv > 0.004 ? 'profit' : usdv < -0.004 ? 'loss' : 'flat';
  return { usd: usdv, opt, cry, trades: n, verdict, mult: verdict === 'profit' ? 1 : verdict === 'flat' ? .5 : 0, from: a };
}
function payroll() {
  const h = D.health, f = h?.freshness || {}, mx = h?.freshnessMaximumAgeMinutes || {};
  const keys = Object.keys(f).filter(k => mx[k] != null), freshOk = keys.length ? keys.filter(k => f[k] <= mx[k]).length / keys.length : .5;
  const runs = [...(D.led?.runs || []), ...(D.oled?.runs || [])];
  const runs24 = (D.led?.runs || []).filter(r => ageMin(r.t) < 1440).length;
  const errors24 = runs.filter(r => r.action === 'error' && ageMin(r.t) < 1440).length;
  const cIdx = cryptoIdx() - 100, oP = optPnl();
  const ct = D.led?.trades || [], ot = D.oled?.trades || [];
  const losses = [...ct.filter(t => t.returnPct < 0), ...ot.filter(t => t.pnlUsd < 0)].length;
  const lastRunAge = Math.min(...[...runs.map(r => ageMin(r.t)), Infinity]);
  const rows = {
    scout:   { base: 1000, score: freshScore(ageMin(D.sig?.generatedAt), 75, 360), why: `Price scan is ${Math.round(ageMin(D.sig?.generatedAt))}m old (fresh within 75m)` },
    analyst: { base: 1000, score: clamp(freshScore(ageMin(D.latest?.asOf), 90, 1440) - ((D.latest?.cards || []).length ? 0 : 15)), why: `Watchlist updated ${ago(D.latest?.asOf)} · ${(D.latest?.cards || []).length} picks` },
    medic:   { base: 1000, score: botHealth().ok ? 100 : clamp(100 - botHealth().issues.length * 25), why: botHealth().ok ? 'ClaudeBot pipelines healthy' : 'Issues: ' + botHealth().issues.join(', ') },
    options: { base: 1100, score: clamp(85 + oP * .8), why: `${ot.length} spreads closed · ${usd(oP)} realized${blackoutToday() ? ' · respecting today\'s event pause' : ''}` },
    guard:   { base: 1100, score: clamp(100 - losses * 8 - errors24 * 10), why: `${losses} losing trade${losses === 1 ? '' : 's'} so far · ${errors24} errors in 24h` },
    ledger:  { base: 950,  score: clamp(freshScore(lastRunAge, 75, 360) - errors24 * 10), why: `Books updated ${isFinite(lastRunAge) ? Math.round(lastRunAge) + 'm' : 'never'} ago · ${runs24} crypto checks logged in 24h` },
    planner: { base: 950,  score: clamp(70 + (cIdx + oP >= 0 ? 15 : -10) + (freedomPlan().contribution > 0 ? 15 : 0)), why: `Plan ${freedomPlan().contribution > 0 ? 'includes' : 'has no'} monthly contributions · results ${cIdx + oP >= 0 ? 'not negative' : 'negative'}` },
  };
  const pAge = ageMin(D.pled?.updatedAt), pTr = Object.values(D.pled?.strategies || {}).reduce((n, x) => n + (x.trades?.length || 0), 0);
  { const dt = D.dled?.trades || [], dp = dipPnl(); rows.quinn = { base: 1100, score: clamp(85 + dp * 4 - (D.dled?.open && !(D.dcfg?.symbols || []).includes(D.dled.open.symbol) ? 40 : 0)), why: D.dled?.open ? `Holding ${D.dled.open.symbol} from ${D.dled.open.entryPrice} · dip desk ${usd(dp)}` : `${dt.length} dip trades · ${usd(dp)} · waiting for a dip in an uptrend` }; }
  const started = !!D.pled?.updatedAt;
  rows.sim = { base: 900, score: started ? clamp(freshScore(pAge, 75, 360)) : 70, why: started ? `Paper Lab updated ${ago(D.pled.updatedAt)} · ${pTr} paper trades closed` : 'New hire: first Paper Lab run at :14' };
  rows.echo = { base: 900, score: started ? clamp(freshScore(pAge, 75, 360) - (D.pled?.strategies?.cryraw ? 0 : 20)) : 70, why: started ? `Crypto paper test ${D.pled?.strategies?.cryraw ? 'running' : 'missing'}` : 'New hire: first crypto paper test at :14' };
  const team = Object.values(rows).reduce((a, r) => a + r.score, 0) / Object.keys(rows).length;
  rows.atlas = { base: 1500, score: Math.round(team), why: `Team average · ${errors24 ? errors24 + ' errors today' : 'no errors today'}` };
  // the CEO is paid like everyone else: on the company's result and the managers' audits
  const au = D.audit; const fails = (au?.reports || []).flatMap(r => r.checks).filter(c => c.status === 'fail').length;
  rows.claude = { base: 2000, score: clamp(Math.round(team) - fails * 15), why: `Team average ${Math.round(team)}${fails ? ` · ${fails} failed audit checks` : ' · audits clean'}` };
  // manager accountability: a manager loses 10 points per failed check on their team
  for (const r of au?.reports || []) { const f = r.checks.filter(c => c.status === 'fail').length; if (rows[r.manager] && f) { rows[r.manager].score -= 10 * f; rows[r.manager].why += ` · ${f} team check${f > 1 ? 's' : ''} failed`; } for (const c of r.checks) if (c.status === 'fail' && rows[c.agent]) { rows[c.agent].score -= 20; rows[c.agent].why += ` · failed: ${c.check}`; } }
  // company result decides how much of the paycheck is paid this week
  const wk = companyResult(0), last = companyResult(1);
  const pool0 = wk.verdict === 'profit' ? Math.round(wk.usd * 1000) : 0;   // 1,000 credits of bonus per $1 the company made
  // 🏆 $1K milestone (board, 2026-11-02): when trading profits take the $117 start to $1,000, a one-time 100,000-credit bonus
  const life = optPnl() + dipPnl(), goal = 1000 - 117, hit = life >= goal;
  const pool = pool0 + (hit ? 100000 : 0);
  const tot = Object.values(rows).reduce((a, r) => a + Math.max(0, r.score), 0) || 1;
  for (const [k, r] of Object.entries(rows)) { r.score = Math.round(clamp(r.score)); r.bonus = Math.round(pool * r.score / tot); r.earned = Math.round(r.base * r.score / 100); r.pay = Math.round(r.earned * wk.mult) + r.bonus; r.docked = r.earned - Math.round(r.earned * wk.mult); r.grade = r.score >= 90 ? 'A' : r.score >= 80 ? 'B' : r.score >= 70 ? 'C' : r.score >= 60 ? 'D' : 'F'; }
  return { rows, pool, life, goal, hit, wk, last, total: Object.values(rows).reduce((a, r) => a + r.pay, 0), team: Math.round(team) };
}
const credits = n => '🪙 ' + Math.round(n).toLocaleString();
function nextPayday() { const d = new Date(); const day = d.getDay(); const add = (5 - day + 7) % 7; const p = new Date(d); p.setDate(d.getDate() + add); return add === 0 ? 'today (Friday)' : p.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); }

/* ============================== agent routines ============================== */
const R = agents;
async function checkin(m) {
  const r = (D.audit?.reports || []).find(x => x.manager === m.k); const team = Object.keys(agents).filter(k => agents[k].boss === m.k);
  const k = pick(team), a = agents[k]; const cs = (r?.checks || []).filter(c => c.agent === k); const c = cs.length ? (cs.find(x => x.status !== 'pass') || pick(cs)) : null;
  await visit(m, a, c ? [['a', `Check-in: <b>${esc(c.check)}</b>?`], ['b', c.status === 'pass' ? `✓ ${esc(c.detail)}.` : `${c.status === 'warn' ? 'Heads up' : 'Problem'}: ${esc(c.detail)}.`]]
                       : [['a', `${a.name}, status report?`], ['b', 'Working on it. Audit runs at :14.']]);
  if (Math.random() < .7) {
    const ceo = agents.claude, st = r?.status || 'pending';
    await visit(m, ceo, [['a', `${esc(m.title)} report: ${r ? `${r.passed}/${r.total} checks passed` : 'first audit pending'}.`],
      ['b', st === 'pass' ? 'Good work. Keep it tight.' : st === 'warn' ? `Get that warning cleared: ${esc((r.checks.find(x => x.status === 'warn') || {}).check || '')}.` : st === 'fail' ? 'Failures go straight to the owner. Fix it now.' : 'Report back after the next run.']]);
  }
}
const routines = {
  async claude(a) {
    await wander(a, [[3.9, 4.6], [4.4, 4.4], [3.5, 4.8]]);
    const p = payroll(), w = p.wk; await waitFree(a);
    if (Math.random() < .5) await say(a, w.verdict === 'profit' ? `We made ${usd(w.usd)} this week. Full paychecks plus bonus. 🎉` : w.verdict === 'loss' ? `We lost ${usd(w.usd)} this week. No paychecks until we're back in profit.` : `Flat week so far: half pay. Protect capital, then earn.`, 3600);
    else if (Math.random() < .5) { const room = pick(['research', 'trading', 'risk', 'vault', 'diagnostics']); const r = ROOMS[room]; await waitFree(a); a.busy++; try { await walkTo(a, (r.x0 + r.x1) / 2 + rnd(-.8, .8), (r.y0 + r.y1) / 2 + rnd(-.5, .5), 'Spot-checking ' + r.short); await say(a, pick(['Show me the numbers.', 'Are we following the rules?', 'What did we learn today?', 'Every trade has a reason, right?']), 2400); await goHome(a); } finally { a.busy--; } }
    else if (D.ocfg?.promotion?.active) await say(a, `I approved Sim's <b>${esc(D.ocfg.promotion.strategyName)}</b> research for live trading. It auto-reverts if it loses.`, 3800);
    else { const lb = (D.pled?.leaderboard || []).filter(r => r.desk === 'options').sort((x, y) => y.trades - x.trades)[0]; await say(a, lb && lb.trades ? `Watching the Paper Lab: ${esc(lb.name)} has ${lb.trades}/20 trades toward approval.` : (D.audit ? `Audit: ${esc(D.audit.ceo.summary)}.` : 'Waiting on the first management audit.'), 3800); }
  },
  async atlas(a) {
    if (Math.random() < .5) return checkin(a);
    const h = D.health, room = pick(['research', 'diagnostics', 'freedom', 'trading', 'risk', 'vault']);
    const lines = {
      research: [['a', `Analyst, what's the market mood?`], ['b', `${esc(D.latest?.regime?.label || 'Unclear')}: ${esc(D.latest?.regime?.detail || 'no regime yet')}.`]],
      diagnostics: [['a', 'Medic, are we healthy?'], ['b', botHealth().ok ? `ClaudeBot is <b>healthy</b>. The old Teststock engine is ${esc((h?.status || '?').toLowerCase())}, but it's locked and we don't use it.` : `ClaudeBot needs a look: ${esc(botHealth().issues.join(', '))}.`]],
      freedom: [['a', 'Planner, how far to $10k a month?'], ['b', `At ${freedomPlan().annualReturn}%/yr we'd need ${money(freedomPlan().requiredCapital)}. We're ${freedomPlan().progress.toFixed(2)}% there.`]],
      trading: [['a', 'Desk, anything open?'], ['b', livePos().length ? `Yes: ${esc(livePos().join(' and '))}.` : (paperSpread() ? `Real money: all cash. Paper only: ${esc(paperSpread())}.` : 'All cash. Nothing passes the checks yet.')]],
      risk: [['a', 'Guard, are new trades allowed today?'], ['b', blackoutToday() ? `No new spreads today: ${esc(blackoutToday())}.` : (D.sig?.regime?.riskOff ? 'Crypto is risk-off. Options only if every check passes.' : 'Allowed, if every check passes.')]],
      vault: [['a', 'Ledger, how are the books?'], ['b', `Crypto ${pct(cryptoIdx() - 100)}, options ${usd(optPnl())} over ${(D.oled?.trades || []).length} spreads.`]],
    }[room];
    const target = { research: R.analyst, diagnostics: R.medic, freedom: R.planner, trading: R.options, risk: R.guard, vault: R.ledger }[room];
    await visit(a, target, lines);
    await sleep(rnd(2000, 5000));
    await waitFree(a); await say(a, `ClaudeBot <b>${botHealth().status.toLowerCase()}</b> · trading today: ${tradingToday()[0].toLowerCase()} · market ${esc(D.latest?.regime?.label || '–')}.`, 3200);
  },
  async scout(a) {
    const s = D.sig, top = s?.coins?.[0];
    await wander(a, [[6.4, 2.4], [6.9, 3.2]]);
    await waitFree(a); await say(a, `Scanned ${s?.coins?.length || 8} coins ${ago(s?.generatedAt)}.`, 2500);
    if (Math.random() < .6) await visit(a, R.guard, [
      ['a', s?.regime?.riskOff ? 'Bitcoin is under its 200-hour average. Risk-off.' : s?.bestCandidate ? `${esc(s.bestCandidate)} has a clean setup!` : `Closest: ${esc(top?.symbol)} (${esc((top?.blockers || [])[0] || 'not ready')}).`],
      ['b', s?.bestCandidate && !s?.regime?.riskOff ? `Approved for at most $15, and the stop goes in first.` : 'With ~1.9% round-trip costs, there\'s no edge. Stay in cash.']]);
    else await visit(a, R.options, [['a', 'Fresh signal is up on the wall.'], ['b', 'Thanks. I only move if Guard clears it.']]);
  },
  async analyst(a) {
    if (Math.random() < .45) return checkin(a);
    const cards = D.latest?.cards || [];
    await wander(a, [[8.7, 2.5], [9.0, 3.4], [7.6, 4.4]]);
    await waitFree(a); await say(a, cards.length ? `Watching ${esc(cards.map(c => c.symbol).slice(0, 3).join(', '))}. Top score ${cards[0].score}.` : 'Watchlist is empty today.', 3000);
    if (Math.random() < .5) await visit(a, R.atlas, [['a', `Regime is <b>${esc(D.latest?.regime?.label || '?')}</b>; the call is ${esc(D.latest?.action || 'WAIT')}.`], ['b', 'Noted. No forced trades.']]);
    else await visit(a, R.options, [['a', `${esc(D.latest?.regime?.bias || 'Mixed')} bias on SPY and QQQ.`], ['b', 'My spreads need the ticker above its 20-day average anyway.']]);
  },
  async medic(a) {
    const h = D.health; const f = h?.freshness || {}, mx = h?.freshnessMaximumAgeMinutes || {};
    const stale = Object.keys(f).filter(k => mx[k] != null && f[k] > mx[k]);
    await wander(a, [[11.0, 1.9], [12.0, 1.9], [13.4, 4.4]]);
    await waitFree(a); await say(a, botHealth().ok ? `ClaudeBot checks out ✓${stale.length ? ` (old engine has ${stale.length} stale feeds, not ours)` : ''}.` : `ClaudeBot issue: ${esc(botHealth().issues[0])}.`, 3000);
    if (Math.random() < .55) await visit(a, R.options, [['a', 'Checking the Robinhood link…'], ['b', 'Broker state gets verified live on every run.']]);
    else await visit(a, R.atlas, [['a', botHealth().ok ? 'ClaudeBot pipelines are all healthy.' : `ClaudeBot issue: ${esc(botHealth().issues[0])}.`], ['b', 'Keep watching it.']]);
  },
  async planner(a) {
    const p = freedomPlan();
    await wander(a, [[16.4, 2.4], [18.4, 4.3], [16.2, 4.4]]);
    await waitFree(a); await say(a, `Goal ${money(p.monthlyIncome)}/mo needs ${money(p.requiredCapital)} at a ${p.withdrawalRate}% withdrawal rate.`, 3400);
    if (Math.random() < .6) await visit(a, R.ledger, [['a', 'What did trading add this week?'], ['b', `Realized options ${usd(optPnl())}; crypto ${pct(cryptoIdx() - 100)}.`], ['a', 'Small steps. Contributions matter more than returns right now.']]);
    else await visit(a, R.atlas, [['a', `Scenario at 7%/yr: ${money(p.scenarios.find(s => s.annualReturn === 7)?.value)} in ${p.months} months.`], ['b', 'Keep the plan honest.']]);
  },
  async options(a) {
    await wander(a, [[5.5, 10.9], [6.2, 11.6]]);
    const lo = (D.oled?.runs || []).slice(-1)[0], p = D.oled?.open;
    await waitFree(a); await say(a, p ? `Short ${esc(p.label)} for ${p.credit}. Max loss $${p.maxLossUsd}.` : (lo ? `Last scan ${ago(lo.t)}: ${esc(lo.detail)}` : 'Scanning SPY, DIA, KRE, IWM and XLF from 9:00 to 1:30 CT.'), 3800);
    await visit(a, R.guard, p ? [['a', `How's ${esc(p.underlying)} looking?`], ['b', `Take-profit order rests at ${(p.credit * .35).toFixed(2)}. I'll pull us out at ${(p.credit * 2.5).toFixed(2)} or under ${p.shortStrike}.`]]
      : [['a', 'Can I sell a spread today?'], ['b', blackoutToday() ? `Not today: ${esc(blackoutToday())}.` : 'Only within a penny of mid, with max loss under ~$85.']]);
  },
  async guard(a) {
    if (Math.random() < .5) return checkin(a);
    await waitFree(a); a.busy++;
    try { await walkTo(a, rnd(3, 17), rnd(6.75, 7.25), 'Patrolling the hall'); await say(a, pick(['Exits before entries. Always.', 'One spread at a time.', 'No averaging down.', 'Cash is a position.', blackoutToday() ? 'Event day: no new spreads.' : 'Every order gets a fresh broker check.']), 2400); await goHome(a); }
    finally { a.busy--; }
    await sleep(rnd(3000, 7000));
  },
  async quinn(a) {
    await wander(a, [[21.9, 2.8], [23.8, 4.6], [21.2, 4.6]]);
    const o = D.dled?.open, lr = (D.dled?.runs || []).slice(-1)[0]; await waitFree(a);
    await say(a, o ? `Holding $${o.usd} of ${esc(o.symbol)} from ${o.entryPrice}. Out on the bounce or a 5% stop.` : (lr ? `Dip desk: ${esc(lr.detail)}` : 'Dip desk is live: I buy SPY, QQQ, DIA or IWM after a sharp dip in an uptrend.'), 3600);
    if (Math.random() < .5) await visit(a, R.guard, [['a', 'Dip desk check: $25 per trade, one at a time, 5% stop.'], ['b', 'Approved. Stay inside those limits.']]);
    else await visit(a, R.analyst, [['a', D.dbt ? `Backtest held up: ${D.dbt.combosWithPositiveTest} settings profitable on unseen 2025–26 data.` : 'Researching the next strategy.'], ['b', "Good. Keep the evidence coming. Rising markets flatter dip-buying."]]);
  },
  async sim(a) {
    const b = D.pled?.leaderboard?.filter(r => r.desk === 'options') || [], m = D.pled?.strategies?.mirror;
    await wander(a, [[6.1, 4.5], [6.8, 4.9]]);
    await waitFree(a);
    const best = b[0];
    await say(a, best && best.trades ? `Paper leader: <b>${esc(best.name)}</b> ${usd(best.pnlUsd)} over ${best.trades} spreads.` : `Running ${b.length || 5} paper strategies. No closed paper spreads yet.`, 3200);
    if (Math.random() < .6) await visit(a, R.options, [['a', m?.open ? `My paper copy of you holds ${esc(m.open.label)}.` : `Paper says: ${esc((m?.runs || []).slice(-1)[0]?.detail || 'waiting for the next scan')}.`], ['b', 'Good. Compare our fills when we both close.']]);
    else await visit(a, R.guard, [['a', `"No event pause" trades through events on paper.`], ['b', "That one removes a safety rule, so it needs the board, not just the CEO."]]);
  },
  async echo(a) {
    const c = D.pled?.strategies?.cryraw;
    await wander(a, [[8.6, 4.6], [7.9, 4.9]]);
    await waitFree(a);
    await say(a, c?.open ? `Paper position: ${esc(c.open.symbol)} from ${c.open.entry}.` : `Paper crypto: ${esc((c?.runs || []).slice(-1)[0]?.detail || 'no setup yet')}.`, 3200);
    if (Math.random() < .6) await visit(a, R.options, [['a', c?.summary?.trades ? `Ignoring the filters would be ${usd(c.summary.pnlUsd)} on $15 positions.` : "I'm testing what happens if we ignore the risk-off filter."], ['b', "Prove it over 20 trades. The CEO can approve parameter tweaks, but removing filters needs the board."]]);
  },
  async ledger(a) {
    await wander(a, [[17.3, 10.6], [16.4, 9.8], [18.0, 11.6]]);
    const roll = Math.random();
    if (roll < .4) {
      const k = pick(Object.keys(R).filter(x => x !== 'ledger')), r = payroll().rows[k];
      const w = payroll().wk;
      await visit(a, R[k], [['a', w.verdict === 'loss' ? `Sorry, ${R[k].name}: the company lost money, so your paycheck is <b>🪙 0</b>.` : `Paycheck for you, ${R[k].name}: <b>${credits(r.pay)}</b> (score ${r.score}, ${w.verdict === 'flat' ? 'half pay this week' : 'full pay + bonus'}).`], ['b', w.verdict === 'loss' ? "Understood. Let's earn it back the right way." : r.score >= 85 ? 'Thanks! 🎉' : "Thanks. I'll do better next week."]]);
    } else if (roll < .7) await visit(a, R.options, [['a', 'Any fills to record?'], ['b', (D.led?.trades?.length || 0) + (D.oled?.trades?.length || 0) ? 'Already in your books.' : 'Not yet. Waiting for a clean setup.']]);
    else { await waitFree(a); const p = payroll(); await say(a, `Payroll this week: <b>${credits(p.total)}</b> (${p.wk.verdict === 'profit' ? 'full pay + bonus' : p.wk.verdict === 'flat' ? 'half pay, flat week' : 'docked, company lost money'}). Game credits only.`, 3400); }
  },
};
let coffees = 0;
async function coffeeBreak(a) {
  await waitFree(a); a.busy++;
  try { await walkTo(a, rnd(21, 23.8), rnd(10.2, 12), 'Coffee break ☕'); a.doing = 'Coffee break ☕'; coffees++;
    await say(a, pick(['Coffee break ☕', 'Refueling. ☕', 'Anyone up for ping-pong? 🏓', 'Five-minute break, then back to it.', 'Best perk of the job: free coffee.']), 2600);
    await sleep(rnd(1500, 3500)); await goHome(a); } finally { a.busy--; }
}
async function runAgent(k) { const a = agents[k]; await sleep(rnd(500, 4000)); for (;;) { try { if (Math.random() < .1) await coffeeBreak(a); else await routines[k](a); } catch (e) { console.error(k, e); } await sleep(rnd(1500, 4500)); } }

/* ============================== camera ============================== */
const BW = 1400; const CX = 176, CY = 250;
function base() { const r = svg.getBoundingClientRect(); const ar = r.width > 0 ? r.height / r.width : .64; return { w: BW, h: BW * Math.max(.5, Math.min(1.3, ar)) }; }
const wide = () => innerWidth > 860;
const HOME = () => ({ cx: wide() ? CX : CX - 40, cy: CY, s: wide() ? 1 : 1.7 });
cam = HOME(); let moved = false;
function applyCam() { const B = base(); const w = B.w / cam.s, h = B.h / cam.s; if (typeof agents !== 'undefined') Object.values(agents).forEach(place); svg.setAttribute('viewBox', `${(cam.cx - w / 2).toFixed(1)} ${(cam.cy - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`); }
function animCam(to, ms = 650) { const from = { ...cam }; const t0 = performance.now();
  (function st(t) { const f = Math.min(1, (t - t0) / ms), e = f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; cam = { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, s: from.s + (to.s - from.s) * e }; applyCam(); if (f < 1) requestAnimationFrame(st); })(t0); }
function roomCam(id) { const r = ROOMS[id]; const [X, Y] = iso((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2); const span = (r.x1 - r.x0) + (r.y1 - r.y0); return { cx: X, cy: Y - 30, s: Math.min(wide() ? 1.75 : 2.2, 30 / span * (wide() ? .95 : 1.25)) }; }
applyCam(); addEventListener('resize', applyCam);
$('zin').onclick = () => animCam({ ...cam, s: Math.min(3.2, cam.s * 1.25) }, 250);
$('zout').onclick = () => animCam({ ...cam, s: Math.max(.6, cam.s / 1.25) }, 250);
$('zre').onclick = () => { location.hash = 'office'; };
$('zfs').onclick = () => { const s = $('stage'); document.fullscreenElement ? document.exitFullscreen() : s.requestFullscreen && s.requestFullscreen(); };
$('zpause').onclick = e => { paused = !paused; e.currentTarget.textContent = paused ? '▶' : '❚❚'; };
let drag = null;
svg.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, c: { ...cam } }; moved = false; });
svg.addEventListener('pointermove', e => { if (!drag) return; const r = svg.getBoundingClientRect(); const k = (BW / cam.s) / r.width; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 4) { moved = true; svg.classList.add('drag'); } if (moved) { cam.cx = drag.c.cx - dx * k; cam.cy = drag.c.cy - dy * k; applyCam(); } });
addEventListener('pointerup', () => { drag = null; svg.classList.remove('drag'); setTimeout(() => moved = false, 0); });
svg.addEventListener('wheel', e => { e.preventDefault(); cam.s = Math.max(.6, Math.min(3.2, cam.s * (e.deltaY < 0 ? 1.1 : .9))); applyCam(); }, { passive: false });
function focusAgent(k) { const a = agents[k]; if (location.hash.slice(1) !== a.room) location.hash = a.room; setTimeout(() => { const [X, Y] = iso(a.x, a.y); animCam({ cx: X, cy: Y - 50, s: 2.3 }); }, 60);
  document.querySelectorAll('.ag').forEach(x => x.classList.toggle('on', x.dataset.k === k)); }

/* ============================== theme / clock ============================== */
let themePref = 'auto'; try { themePref = localStorage.getItem('hq-theme') || 'auto'; } catch (e) {}
function applyTheme() { const h = new Date().getHours(); const night = themePref === 'night' || (themePref === 'auto' && (h < 7 || h >= 18));
  scene.style.filter = night ? 'none' : 'brightness(1.32) saturate(.92)'; $('stage').classList.toggle('day', !night); glows.forEach(g => g.style.opacity = night ? 1 : .18);
  document.querySelectorAll('#theme button').forEach(b => b.classList.toggle('on', b.dataset.t === themePref)); }
document.querySelectorAll('#theme button').forEach(b => b.onclick = () => { themePref = b.dataset.t; try { localStorage.setItem('hq-theme', themePref); } catch (e) {} applyTheme(); });
applyTheme(); setInterval(applyTheme, 60000);
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }); }, 1000);
$('menu').onclick = () => $('nav').classList.toggle('open');
setTimeout(() => $('hint').style.opacity = 0, 9000);

/* ============================== rendering ============================== */
function renderWalls() {
  const h = D.health;
  const bh = botHealth(); lobbyT[1].textContent = 'CLAUDEBOT ' + bh.status; lobbyT[1].setAttribute('fill', bh.ok ? '#3ddc84' : '#f5c451');
  lobbyT[2].textContent = 'Trading today: ' + tradingToday()[0]; lobbyT[3].textContent = 'Market: ' + (D.latest?.regime?.label || '–') + ' · ' + (D.latest?.action || '');
  { const bt = D.dbt?.chosenOnTrain?.test, o = D.dled?.open, tr = D.dled?.trades || [];
    stratT[1].textContent = o ? `HOLDING ${o.symbol} @ ${o.entryPrice}` : 'WAITING FOR A DIP';
    stratT[2].textContent = `${tr.length} trades · ${usd(dipPnl())}`;
    stratT[3].textContent = bt ? `Backtest 25-26: ${bt.winRatePct}% wins` : '';
    stratT[4].textContent = bt ? `avg ${bt.avgTradePct}%/trade · PF ${bt.profitFactor}` : ''; }
  const cards = D.latest?.cards || [];
  for (let i = 0; i < 4; i++) resT[i + 1].textContent = cards[i] ? `${cards[i].symbol}  ${cards[i].direction === 'BEARISH' ? '▼' : cards[i].direction === 'BULLISH' ? '▲' : '•'}  ${cards[i].score}` : '';
  const pts = []; for (let i = 0; i <= 40; i++) { const t = i / 40; let z = 72; const ph = (i % 10); if (ph === 4) z = 86; if (ph === 5) z = 60; if (ph === 6) z = 78; pts.push(iso(10.85 + t * 3.3, 0, z)); }
  heart.setAttribute('points', P(pts)); heart.setAttribute('stroke', h?.runner?.healthy ? '#3ddc84' : '#f5c451');
  diagS.textContent = `runner ${h?.runner?.healthy ? 'healthy' : 'check'} · ${ago(h?.generatedAt)}`;
  const c = D.sig?.coins?.find(x => x.symbol === 'BTC') || D.sig?.coins?.[0];
  if (c?.closes48h) { const v = c.closes48h, mn = Math.min(...v), mx = Math.max(...v);
    spark.setAttribute('points', P(v.map((p, i) => iso(.04, 13.2 - i / (v.length - 1) * 4.4, 46 + (p - mn) / ((mx - mn) || 1) * 34)))); spark.setAttribute('stroke', c.trend === 'down' ? '#ff6b7a' : '#3ddc84');
    tickT.textContent = `${c.symbol} ${c.change24hPct > 0 ? '+' : ''}${c.change24hPct}% 24h`; }
}
function agentStatus(a) {
  if (a.state === 'talk') return ['talk', 'Talking'];
  if (a.state === 'walk') return ['walk', a.doing];
  const h = D.health;
  switch (a.k) {
    case 'claude': { const st = D.audit?.ceo?.status; return st === 'fail' ? ['bad', 'Audit failing'] : st === 'warn' ? ['warn', 'Reviewing reports'] : ['ok', 'Running the company']; }
    case 'atlas': return botHealth().ok ? ['ok', 'Running the office'] : ['warn', 'Checking an issue'];
    case 'scout': return D.sig && (Date.now() - new Date(D.sig.generatedAt)) < 75 * 6e4 ? ['work', 'Scanning'] : ['warn', 'Signal stale'];
    case 'analyst': return ['work', (D.latest?.regime?.label || 'Researching')];
    case 'medic': return botHealth().ok ? ['ok', 'ClaudeBot healthy'] : ['warn', 'ClaudeBot: check'];
    case 'planner': return ['work', 'Planning'];
    case 'crypto': return D.led?.open ? ['hold', 'Holding ' + D.led.open.symbol] : ['', 'Idle · cash'];
    case 'options': return D.bled?.open ? ['hold', 'Holding ' + D.bled.open.label] : D.oled?.open ? ['', 'Paper spread'] : blackoutToday() ? ['warn', 'Event pause'] : ['', 'Idle'];
    case 'guard': return D.sig?.regime?.riskOff ? ['warn', 'Risk-off'] : ['ok', 'Watching'];
    case 'ledger': return ['ok', 'Books balanced'];
    case 'quinn': return D.dled?.open ? ['hold', 'Holding ' + D.dled.open.symbol] : ['work', 'Watching for dips'];
    case 'sim': { const o = Object.values(D.pled?.strategies || {}).filter(x => x.desk === 'options' && x.open).length; return o ? ['hold', o + ' paper spreads'] : ['work', 'Paper testing']; }
    case 'echo': return D.pled?.strategies?.cryraw?.open ? ['hold', 'Paper ' + D.pled.strategies.cryraw.open.symbol] : ['work', 'Paper testing'];
  }
  return ['', ''];
}
const DOTC = { work: '#7c78ff', walk: '#3ccfcf', talk: '#ffffff', hold: '#ff8a3d', warn: '#f5c451', ok: '#3ddc84', bad: '#ff5c6c' };
function renderRoster() {
  const groups = [['CEO', ['claude']], ['Operations · Atlas', ['atlas', 'medic', 'ledger', 'planner']], ['Research · Analyst', ['analyst', 'quinn', 'scout', 'sim', 'echo']], ['Risk & Trading · Guard', ['guard', 'options']]];
  $('roster').innerHTML = groups.map(([g, ks]) => `<div class="grp">${g}<span>${ks.length}</span></div>` + ks.map(k => { const a = agents[k];
    return `<div class="ag" data-k="${k}"><div class="av"><svg viewBox="-24 -64 48 66">${charSVG(a.kind, a.color)}</svg></div><div class="mid"><div class="n">${a.name} <span style="color:var(--muted);font-weight:500;font-size:11.5px">${esc(a.title || '')}</span></div><div class="r">${a.boss ? 'Reports to ' + agents[a.boss].name + ' · ' : ''}${esc(a.role)}</div></div><span class="stt" id="st-${k}"></span></div>`; }).join('')).join('');
  document.querySelectorAll('.ag').forEach(x => x.onclick = () => focusAgent(x.dataset.k));
}
function updateStatuses() {
  for (const a of Object.values(agents)) { const [c, t] = agentStatus(a); const s = $('st-' + a.k); if (s) { s.className = 'stt ' + c; s.textContent = t; } a.dot.setAttribute('fill', DOTC[c] || '#8a91a0'); }
  const counts = {}; for (const a of Object.values(agents)) { const r = roomOf(a.x, a.y); counts[r] = (counts[r] || 0) + 1; }
  for (const id of ROOM_IDS) { const e = $('rc-' + id); if (e) e.querySelector('span').textContent = `${counts[id] || 0} agent${counts[id] === 1 ? '' : 's'} here`; }
}
setInterval(updateStatuses, 500);
function renderKpis() {
  const h = D.health, lp = livePos(), open = lp.length;
  const runs = [...(D.led?.runs || []), ...(D.oled?.runs || [])].sort((a, b) => new Date(b.t) - new Date(a.t));
  const k = [
    ['ClaudeBot health', botHealth().status, botHealth().ok ? 'scan ' + Math.round(botHealth().sigAge) + 'm · trader ' + Math.round(botHealth().runAge) + 'm ago' : botHealth().issues[0], botHealth().ok ? 'up' : 'warn'],
    ['Trading today', tradingToday()[0], tradingToday()[1] + (D.sig?.regime?.riskOff ? ' · crypto risk-off' : ''), tradingToday()[2]],
    ['Market', D.latest?.regime?.label || '–', 'call: ' + (D.latest?.action || '–'), /OFF/.test(D.latest?.regime?.label || '') ? 'down' : ''],
    ['Real positions', String(open), (lp.join(' · ') || 'all cash') + (paperSpread() ? ` · paper: ${paperSpread()}` : ''), open ? 'org' : ''],
    ['ClaudeBot', `${pct(cryptoIdx() - 100)} · ${usd(optPnl() + dipPnl())}`, 'crypto · options + dip since start', cls(cryptoIdx() - 100 + optPnl() + dipPnl())],
    ['Paper P&L (pretend $)', usd(paperTotals().pnl), `${paperTotals().n} closed paper trades · not real money`, cls(paperTotals().pnl)],
    ['Paper win rate', paperTotals().wp == null ? '–' : paperTotals().wp + '%', `${paperTotals().open} paper trades open · could lose up to $${Math.round(paperTotals().risk)}`, paperTotals().wp == null ? '' : paperTotals().wp >= 60 ? 'up' : paperTotals().wp < 45 ? 'down' : 'warn'],
    ['Management audit', D.audit ? `${D.audit.reports.reduce((a, r) => a + r.passed, 0)}/${D.audit.reports.reduce((a, r) => a + r.total, 0)} ✓` : '–', D.audit ? `${D.audit.ceo.status.toUpperCase()} · ${ago(D.audit.generatedAt)}` : 'first audit at :14', D.audit?.ceo?.status === 'pass' ? 'up' : D.audit?.ceo?.status === 'fail' ? 'down' : 'warn'],
  ];
  $('kpis').innerHTML = k.map(([l, v, s, c]) => `<div class="kpi"><div class="l">${l}</div><div class="v ${c}">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('');
}
function renderRoomCards() {
  $('roomcards').innerHTML = ROOM_IDS.map(id => `<div class="rc" id="rc-${id}" data-r="${id}"><b>${ROOMS[id].icon} ${ROOMS[id].short}</b><span>–</span></div>`).join('');
  document.querySelectorAll('.rc').forEach(c => c.onclick = () => { location.hash = c.dataset.r; });
}
let jmode = 'all';
function renderJournal() {
  const rows = []; (D.led?.runs || []).forEach(r => rows.push({ ...r, who: 'Crypto', c: '#ff8a3d', kind: 'crypto' })); (D.oled?.runs || []).forEach(r => rows.push({ ...r, who: 'Options', c: '#a78bfa', kind: 'options' }));
  (D.dled?.runs || []).forEach(r => rows.push({ ...r, who: 'Dip', c: '#38bdf8', kind: 'dip' }));
  Object.values(D.pled?.strategies || {}).forEach(st => (st.runs || []).forEach(r => rows.push({ ...r, detail: `[${st.name}] ${r.detail}`, who: 'Paper', c: '#a3e635', kind: 'paper' })));
  rows.sort((a, b) => new Date(b.t) - new Date(a.t));
  $('jsub').textContent = D.led?.startedAt ? `· ClaudeBot live since ${when(D.led.startedAt)}` : '';
  if (jmode === 'tasks') { $('jlist').innerHTML = [['ClaudeBot trader', 'every hour :14', 'Crypto + options agents check Robinhood and act'], ['ClaudeBot price scan', 'every hour :04', 'GitHub Action: prices, setups, backtest'], ['Teststock intelligence', 'in-session', 'GitHub runner: research, health, triggers']].map(r => `<div class="jr"><span class="t">${r[1]}</span><span class="w">${r[0]}</span><span>${r[2]}</span></div>`).join(''); return; }
  const f = rows.filter(r => jmode === 'all' ? r.kind !== 'paper' : r.kind === jmode).slice(0, 12);
  $('jlist').innerHTML = f.map(r => `<div class="jr"><span class="t">${when(r.t)}</span><span class="w" style="color:${r.c}">${r.who}</span><span>${esc(r.detail)}</span></div>`).join('') || '<div class="jr"><span class="t">–</span><span></span><span>Nothing logged yet.</span></div>';
}
document.querySelectorAll('#jseg button').forEach(b => b.onclick = () => { jmode = b.dataset.j; document.querySelectorAll('#jseg button').forEach(x => x.classList.toggle('on', x === b)); renderJournal(); });

/* ---------- room consoles ---------- */
const card = (title, body, cls = '') => `<div class="box ${cls}"><h3>${title}</h3>${body}</div>`;
const li = (txt, c = '') => `<li><span class="dot ${c}"></span><span>${txt}</span></li>`;
const CONSOLES = {
  office() {
    return `<div class="ch"><h2>🏢 Whole office</h2><span class="who">Thirteen agents in nine rooms, led by Claude (CEO) · click a room to open it</span></div>
    <div class="cgrid">${ROOM_IDS.map(id => card(`${ROOMS[id].icon} ${ROOMS[id].name}`, `<p>${esc(ROOM_BLURB[id])}</p><p><a href="#${id}" style="color:var(--accent);font-weight:600;text-decoration:none">Open room →</a></p>`)).join('')}
    ${card('How it works', '<p>GitHub scans prices and research every hour. The hourly ClaudeBot task checks Robinhood, follows the rules in its planners, places or skips trades, and publishes what it did. These agents act out that published state.</p>', 'span2')}</div>`;
  },
  lobby() {
    const h = D.health, r = D.latest?.regime;
    return `<div class="ch"><h2>🛋️ Lobby · Overview</h2><span class="who">Claude (CEO) and Atlas (COO)</span><a class="full" href="overview.html">Classic overview ↗</a></div>
    <div class="cgrid">
      ${card('ClaudeBot health', `<div class="big ${botHealth().ok ? 'up' : 'warn'}">${botHealth().status}</div><p>${botHealth().ok ? 'Price scan and hourly trader are running on schedule.' : esc(botHealth().issues.join(' · '))}</p><p>Trading today: <b>${tradingToday()[0]}</b> · ${esc(tradingToday()[1])}</p>`)}
      ${card('Market regime', `<div class="big ${/OFF/.test(r?.label || '') ? 'down' : 'up'}">${esc(r?.label || '–')}</div><p>${esc(r?.detail || '')}</p><p>Today's call: <b>${esc(D.latest?.action || '–')}</b></p>`)}
      ${card('ClaudeBot', `<div class="big ${cls(cryptoIdx() - 100)}">${pct(cryptoIdx() - 100)}</div><p>Crypto since start · options ${usd(optPnl())} realized</p><p>${livePos().length ? 'Open: ' + esc(livePos().join(' · ')) : 'All cash right now'}${paperSpread() ? ' · paper: ' + esc(paperSpread()) : ''}</p>`)}
      ${card('Legacy Teststock engine (not ClaudeBot)', `<p>The older stock engine reports <b>${esc(h?.status || '–')}</b> with new risk <b>${esc(h?.newRiskPermission || '–')}</b>. Its live trading is locked by design and ClaudeBot does not depend on it. Its reasons:</p><ul class="list">${(h?.reasons || []).map(x => li(esc(x), 'y')).join('') || li('Nothing blocking', 'g')}</ul>`, 'span2')}
      ${orgCard()}
      ${card('Up next', `<ul class="list">${li('Price scan: every hour at :04')}${li('ClaudeBot trade check: every hour at :14')}${li(blackoutToday() ? 'Options: no new spreads today (' + esc(blackoutToday()) + ')' : 'Options: entries 9:00–1:30 CT', blackoutToday() ? 'y' : 'g')}</ul>`)}
    </div>`;
  },
  research() {
    const cards = D.latest?.cards || [], r = D.latest?.regime, coins = D.sig?.coins || [];
    const dir = d => d === 'BULLISH' ? 'bull' : d === 'BEARISH' ? 'bear' : 'neu';
    return `<div class="ch"><h2>🔬 Research Lab</h2><span class="who">Analyst (stocks), Scout (crypto), and Sim &amp; Echo (Paper Lab)</span><a class="full" href="research.html">Full research report ↗</a></div>
    <div class="cgrid">
      ${card('Stock regime', `<div class="big ${/OFF/.test(r?.label || '') ? 'down' : 'up'}">${esc(r?.label || '–')}</div><p>${esc(r?.detail || '')} · bias ${esc(r?.bias || '–')} · gate ${esc(r?.tradeGate || '–')}</p>`)}
      ${card('Stock watchlist', cards.length ? `<div class="picks">${cards.map(c => `<div class="pick"><b>${esc(c.symbol)}</b><span class="tag ${dir(c.direction)}">${esc(c.direction || '')}</span><div class="mono" style="margin-top:4px">score ${c.score} · $${c.price}</div><div style="color:var(--muted);font-size:12px;margin-top:4px">${esc(c.label || '')} · ${esc(c.tag || '')}</div></div>`).join('')}</div>` : '<div class="empty">No stocks on watch right now.</div>', 'span2')}
      ${paperScoreCard()}
      ${paperCard()}
      ${dayCard()}
      ${card('Crypto scanner · 1h bars', `<div class="scroll"><table><thead><tr><th>Coin</th><th>Trend</th><th>RSI</th><th>24h</th><th>Status</th></tr></thead><tbody>${coins.map(c => `<tr><td><b>${c.symbol}</b></td><td class="${c.trend === 'up' ? 'up' : c.trend === 'down' ? 'down' : ''}">${c.trend}</td><td class="mono">${c.rsi}</td><td class="mono ${cls(c.change24hPct)}">${pct(c.change24hPct, 1)}</td><td style="white-space:normal">${c.setup ? '<b class="up">SETUP</b>' : esc((c.blockers || [])[0] || '')}</td></tr>`).join('')}</tbody></table></div><p>Signal ${ago(D.sig?.generatedAt)} · ${D.sig?.regime?.riskOff ? 'BTC risk-off' : 'BTC trend OK'}</p>`, 'span3')}
    </div>`;
  },
  diagnostics() {
    const h = D.health, f = h?.freshness || {}, mx = h?.freshnessMaximumAgeMinutes || {};
    const rows = Object.keys(f).map(k => { const v = f[k], m = mx[k] || 1, ok = v <= m; const fmt = x => x > 1440 ? (x / 1440).toFixed(1) + 'd' : x > 90 ? (x / 60).toFixed(1) + 'h' : Math.round(x) + 'm';
      return `<div class="fr"><span>${k.replace('AgeMinutes', '')}</span><div class="bar"><i style="width:${Math.min(100, v / m * 100)}%;background:${ok ? 'var(--up)' : 'var(--down)'}"></i></div><span class="mono ${ok ? 'up' : 'down'}">${fmt(v)}</span></div>`; }).join('');
    const sigAge = D.sig ? (Date.now() - new Date(D.sig.generatedAt)) / 6e4 : null; const runs = [...(D.led?.runs || []), ...(D.oled?.runs || [])].sort((a, b) => new Date(b.t) - new Date(a.t));
    return `<div class="ch"><h2>🩺 Diagnostics</h2><span class="who">Medic watches data, runners and breakers</span><a class="full" href="trading-health.html">Full health report ↗</a></div>
    <div class="cgrid">
      ${card('Legacy engine data freshness (age vs limit)', rows || '<div class="empty">No freshness data.</div>', 'span2')}
      ${card('Breakers & watchdogs', `<ul class="list">${li('Circuit breaker: <b>' + esc(h?.circuitBreaker || '–') + '</b>', h?.circuitBreaker === 'OK' ? 'g' : 'y')}${li('Data watchdog: <b>' + esc(h?.dataWatchdog || '–') + '</b>', h?.dataWatchdog === 'OK' ? 'g' : 'y')}${li('Drawdown risk: <b>' + esc(h?.drawdownRisk || '–') + '</b>', h?.drawdownRisk === 'NORMAL' ? 'g' : 'y')}${li('Broker link: <b>' + esc(h?.brokerMcp?.state || '–') + '</b>', 'y')}</ul>`)}
      ${card('Legacy engine runner', `<div class="big ${h?.runner?.healthy ? 'up' : 'warn'}">${h?.runner?.healthy ? 'HEALTHY' : esc(h?.runner?.state || '–')}</div><p>${esc(h?.runner?.schedule || '')} · last seen ${h?.runner ? Math.round(h.runner.ageMinutes) + 'm ago' : '–'}</p>${h?.runner?.runUrl ? `<p><a href="${esc(h.runner.runUrl)}" style="color:var(--accent)">Latest run ↗</a></p>` : ''}`)}
      ${card('ClaudeBot pipelines', `<ul class="list">${li('Price scan: ' + (sigAge == null ? '–' : Math.round(sigAge) + 'm old'), sigAge != null && sigAge < 75 ? 'g' : 'y')}${li('Trader: last run ' + (runs[0] ? ago(runs[0].t) : '–'), runs[0] && (Date.now() - new Date(runs[0].t)) < 2 * 36e5 ? 'g' : 'y')}${li('Options mode: <b>' + esc((D.oled?.mode || '–').toUpperCase()) + '</b>')}</ul>`)}
      ${card('Legacy engine blocking reasons', `<ul class="list">${(h?.reasons || []).map(x => li(esc(x), 'r')).join('') || li('None', 'g')}</ul>`)}
    </div>`;
  },
  freedom() {
    const p = freedomPlan();
    const inp = (k, l) => `<label>${l}<input name="${k}" type="number" step="any" value="${p[k]}"></label>`;
    return `<div class="ch"><h2>🎯 Freedom Room</h2><span class="who">Planner models the path to monthly income · planning math only, never used for trade sizing</span><a class="full" href="financial-freedom.html">Classic planner ↗</a></div>
    <div class="cgrid">${card('Your plan (saved in this browser only)', `<form class="plan" id="planf">${inp('capital', 'Starting capital $')}${inp('contribution', 'Monthly contribution $')}${inp('monthlyIncome', 'Goal: monthly income $')}<label>Timeline (months)<select name="months"><option ${p.months === 12 ? 'selected' : ''}>12</option><option ${p.months === 24 ? 'selected' : ''}>24</option></select></label>${inp('annualReturn', 'Annual return %')}${inp('withdrawalRate', 'Withdrawal rate %')}${inp('inflation', 'Inflation %')}</form><p id="planerr" class="down"></p>`, 'span3')}</div>
    <div class="cgrid" id="planout">${planOut(p)}</div>`;
  },
  trading() {
    const s = D.sig, lo = D.oled, cr = D.led;
    const t = [...(cr?.trades || []).map(x => ({ w: x.symbol, e: x.enteredAt, x: x.exitedAt, r: pct(x.returnPct), why: x.exitReason, c: x.returnPct })), ...(lo?.trades || []).map(x => ({ w: x.label, e: x.enteredAt, x: x.exitedAt, r: usd(x.pnlUsd), why: x.reason, c: x.pnlUsd }))].sort((a, b) => new Date(b.x) - new Date(a.x));
    return `<div class="ch"><h2>📈 Trading Floor</h2><span class="who">Crypto and Options trade the agent-enabled Robinhood account</span><a class="full" href="claudebot.html">ClaudeBot desk ↗</a></div>
    <div class="cgrid">
      ${card('Crypto desk', cr?.open ? `<div class="big org">${esc(cr.open.symbol)}</div><p>Entry ${cr.open.entryPrice} · stop ${cr.open.stop} · target ${cr.open.target} · ${cr.open.allocationPct}% of account</p>` : `<div class="big">CASH</div><p>${s?.regime?.riskOff ? 'Bitcoin risk-off.' : s?.bestCandidate ? 'Setup: ' + esc(s.bestCandidate) : 'No coin passes every check.'} Max $15 per buy; stop placed at fill.</p>`)}
      ${card('Options desk', lo?.open ? `<div class="big org">${esc(lo.open.label)}</div><p>Credit ${lo.open.credit} · max loss $${lo.open.maxLossUsd} · delta ${lo.open.shortDelta}</p>` : `<div class="big">NO SPREAD</div><p>${blackoutToday() ? 'Event pause: ' + esc(blackoutToday()) : 'Scans SPY, DIA, KRE, IWM, XLF 9:00–1:30 CT.'} Mode: <b>${esc((lo?.mode || '').toUpperCase())}</b></p>`)}
      ${card('Results since start', `<div class="big ${cls(cryptoIdx() - 100)}">${pct(cryptoIdx() - 100)}</div><p>crypto index · options ${usd(optPnl())} over ${(lo?.trades || []).length} spreads</p>`)}
      ${card('Recent trades', t.length ? `<div class="scroll"><table><thead><tr><th>What</th><th>Opened</th><th>Closed</th><th>Result</th><th>Why</th></tr></thead><tbody>${t.slice(0, 8).map(r => `<tr><td><b>${esc(r.w)}</b></td><td>${when(r.e)}</td><td>${when(r.x)}</td><td class="mono ${cls(r.c)}">${r.r}</td><td>${esc(r.why)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No closed trades yet. The bot only trades when every check passes.</div>', 'span3')}
    </div>`;
  },
  risk() {
    const o = D.ocfg, c = D.ccfg, up = Object.entries(o?.risk?.noNewEntryDates || {}).filter(([d]) => d >= todayCT()).slice(0, 6);
    const b = D.obt?.baseline, wf = D.obt?.walkForward || [], mc = D.obt?.monteCarlo;
    return `<div class="ch"><h2>🛡️ Risk Office</h2><span class="who">Guard enforces the rules before every order</span><a class="full" href="operations.html">Protection rules ↗</a></div>
    <div class="cgrid">
      ${card('Crypto limits', `<ul class="list">${li('Max $' + (c?.risk?.maxPositionUsd ?? '–') + ' per buy, one coin at a time')}${li('Stop order placed the moment it fills')}${li('Skips coins where the rule lost money after ' + (c?.costs?.roundTripPct ?? '–') + '% costs')}${li('No new buys after a ' + (c?.risk?.dailyLossLimitPct ?? '–') + '% 24h drop')}</ul>`)}
      ${card('Options limits', `<ul class="list">${li('One $1-wide put spread at a time, quantity 1')}${li('Short delta ≤ ' + (o?.entry?.maxShortDelta ?? '–') + ', ~' + (o?.entry?.targetDte ?? '–') + ' days to expiry')}${li('Take profit at ' + (o?.exit?.takeProfitPctOfCredit ?? '–') + '%, stop at ' + (o?.exit?.stopAtMultipleOfCredit ?? '–') + '× credit')}${li('Pause ' + (o?.risk?.cooldownDaysAfterLoss ?? '–') + ' days after a loss; stop below $' + (o?.risk?.pauseBelowAccountValueUsd ?? '–'))}${li('Fills within a penny of mid, or no trade')}</ul>`)}
      ${card('No-new-trade days', up.length ? `<ul class="list">${up.map(([d, why]) => li(`<b>${d}</b> · ${esc(why)}`, d === todayCT() ? 'y' : '')).join('')}</ul>` : '<div class="empty">None scheduled.</div>')}
      ${card('Strategy stress test (modeled 2023–26)', b ? `<ul class="list">${li(`${b.trades} trades · ${b.winRatePct}% wins · avg ${usd(b.avgPnl)}/trade · profit factor ${b.profitFactor}`, 'g')}${wf.map(w => li(`Walk-forward ${w.year}: ${usd(w.outOfSample?.avgPnl)}/trade on unseen data`, (w.outOfSample?.avgPnl || 0) > 0 ? 'g' : 'r')).join('')}${D.obt?.costStress ? li('Doubling slippage turns it negative, so fills are capped near mid', 'y') : ''}${mc ? li(`Monte Carlo from $113: ${mc.account113.pctStuckOrPaused}% chance of stalling; from $300: ${mc.account300.pctStuckOrPaused}%`, 'y') : ''}</ul>` : '<div class="empty">Stress test not available.</div>', 'span3')}
    </div>`;
  },
  vault() {
    const ct = D.led?.trades || [], ot = D.oled?.trades || [];
    const all = [...ct.map(t => ({ k: 'Crypto', w: t.symbol, x: t.exitedAt, r: pct(t.returnPct), a: pct(t.accountImpactPct), c: t.returnPct })), ...ot.map(t => ({ k: 'Options', w: t.label, x: t.exitedAt, r: usd(t.pnlUsd), a: `credit ${t.credit} → ${t.debit}`, c: t.pnlUsd }))].sort((a, b) => new Date(b.x) - new Date(a.x));
    const wins = all.filter(t => t.c > 0).length;
    return `<div class="ch"><h2>📒 Vault · Ledger</h2><span class="who">Every fill, from Robinhood-confirmed prices</span><a class="full" href="claudebot.html">Full trade log ↗</a></div>
    <div class="cgrid">
      ${card('Closed trades', `<div class="big">${all.length}</div><p>${wins} won · ${all.length - wins} lost</p>`)}
      ${card('Crypto since start', `<div class="big ${cls(cryptoIdx() - 100)}">${pct(cryptoIdx() - 100)}</div><p>equity index (start = 100)</p>`)}
      ${card('Options realized', `<div class="big ${cls(optPnl())}">${usd(optPnl())}</div><p>per-spread dollars after fees</p>`)}
      ${payrollCard()}
      ${card('Ledger', all.length ? `<div class="scroll"><table><thead><tr><th>Desk</th><th>Trade</th><th>Closed</th><th>Result</th><th>Detail</th></tr></thead><tbody>${all.map(t => `<tr><td>${t.k}</td><td><b>${esc(t.w)}</b></td><td>${when(t.x)}</td><td class="mono ${cls(t.c)}">${t.r}</td><td>${esc(t.a)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">The books are empty, so no trades have closed yet.</div>', 'span3')}
    </div>`;
  },
};
function dayCard() {
  const L = D.dtp, b = L?.leaderboard || [], H = D.dtbt, S = L?.strategies || {};
  const hist = H?.all ? (() => { const best = {}; H.all.forEach(r => { if ((r.train.trades || 0) >= 100 && (!best[r.strategy] || r.train.avgTradePct > best[r.strategy].train.avgTradePct)) best[r.strategy] = r; });
      return `<div class="scroll"><table><thead><tr><th>Strategy (history)</th><th>Settings</th><th>2023–24 avg/trade</th><th>2025–26 trades</th><th>Win %</th><th>Avg/trade</th><th>PF</th></tr></thead><tbody>${Object.values(best).map(r => `<tr><td><b>${esc(r.name)}</b></td><td class="mono">${esc(JSON.stringify(r.params).replace(/[{}"]/g, ''))}</td><td class="mono ${cls(r.train.avgTradePct)}">${pct(r.train.avgTradePct, 3)}</td><td class="mono">${r.test.trades ?? 0}</td><td class="mono">${r.test.winRatePct ?? '–'}</td><td class="mono ${cls(r.test.avgTradePct)}">${pct(r.test.avgTradePct, 3)}</td><td class="mono">${r.test.profitFactor ?? '–'}</td></tr>`).join('')}<tr><td><b>Baseline</b> (buy 9:35, sell 3:40)</td><td>–</td><td class="mono">${pct(H.baseline?.train?.avgTradePct, 3)}</td><td class="mono">${H.baseline?.test?.trades ?? 0}</td><td class="mono">${H.baseline?.test?.winRatePct ?? '–'}</td><td class="mono ${cls(H.baseline?.test?.avgTradePct)}">${pct(H.baseline?.test?.avgTradePct, 3)}</td><td class="mono">${H.baseline?.test?.profitFactor ?? '–'}</td></tr></tbody></table></div><p class="${H.verdict === 'edge' ? 'up' : 'warn'}"><b>Verdict:</b> ${esc(H.verdictText || '')}</p>`; })() : '<div class="empty">History test running.</div>';
  const live = b.length ? `<div class="scroll"><table><thead><tr><th>Paper strategy</th><th>Trades</th><th>Wins</th><th>P&amp;L ($25 each)</th><th>Avg</th><th>Last trade</th></tr></thead><tbody>${b.map(r => { const t = (S[r.id]?.trades || []).slice(-1)[0];
      return `<tr><td><b>${esc(r.name)}</b></td><td class="mono">${r.trades}</td><td class="mono">${r.wins}</td><td class="mono ${cls(r.pnlUsd)}">${usd(r.pnlUsd)}</td><td class="mono">${r.avgPct == null ? '–' : pct(r.avgPct, 2)}</td><td style="white-space:normal;color:var(--muted)">${t ? esc(`${t.day} ${t.symbol} ${t.retPct > 0 ? '+' : ''}${t.retPct}% (${t.reason})`) : '–'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">First paper day is recorded at the 2:44 PM CT check.</div>';
  return card('⚡ Day-trade desk · paper only', `<p style="margin:0 0 10px">The board asked for day trading. Before any real money, four classic day-trade strategies were tested on 5-minute bars from 2023 on (picked on 2023–24, checked on unseen 2025–26, 0.03% cost per side), and every trading day is now replayed on real prices with $25 pretend trades. Going live needs the board's approval and the evidence.</p>${hist}${live}<p>${L?.days?.length || 0} days replayed · updated ${L?.updatedAt ? ago(L.updatedAt) : 'never'}.</p>`, 'span3');
}
function paperRows() {
  const rows = [];
  const add = (desk, name, tr, open, risk) => {
    const n = tr.length, w = tr.filter(t => t.pnlUsd > 0).length, pnl = tr.reduce((a, t) => a + t.pnlUsd, 0);
    let eq = 0, peak = 0, dd = 0; tr.forEach(t => { eq += t.pnlUsd; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); });
    const worst = n ? Math.min(...tr.map(t => t.pnlUsd)) : null;
    rows.push({ desk, name, n, wp: n ? Math.round(100 * w / n) : null, pnl, worst, dd, open, risk });
  };
  if (D.oled && D.oled.mode !== 'live') add('Options', 'Put spreads (our live rules)', D.oled.trades || [], D.oled.open?.label, D.oled.open?.maxLossUsd);
  for (const [id, st] of Object.entries(D.pled?.strategies || {})) add('Paper Lab', st.name || id, st.trades || [], st.open ? (st.open.label || st.open.symbol) : null, st.open?.maxLossUsd ?? (st.open ? 15 : null));
  for (const [id, st] of Object.entries(D.dtp?.strategies || {})) add('Day trade', st.name || id, (st.trades || []).map(t => ({ pnlUsd: t.pnlUsd })), null, null);
  return rows;
}
function paperTotals() {
  const r = paperRows(), n = r.reduce((a, x) => a + x.n, 0), w = r.reduce((a, x) => a + (x.wp == null ? 0 : Math.round(x.wp * x.n / 100)), 0);
  return { n, wp: n ? Math.round(100 * w / n) : null, pnl: r.reduce((a, x) => a + x.pnl, 0), risk: r.reduce((a, x) => a + (x.open ? (x.risk || 0) : 0), 0), open: r.filter(x => x.open).length, strategies: r.length };
}
function paperScoreCard() {
  const rows = paperRows(), T = paperTotals();
  const body = rows.length ? `<div class="scroll"><table><thead><tr><th>Desk</th><th>Strategy</th><th>Trades</th><th>Win %</th><th>P&amp;L</th><th>Worst trade</th><th>Biggest drop</th><th>Open now · could lose</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.desk}</td><td><b>${esc(r.name)}</b></td><td class="mono">${r.n}</td><td class="mono ${r.wp == null ? '' : r.wp >= 60 ? 'up' : r.wp < 45 ? 'down' : ''}">${r.wp == null ? '–' : r.wp + '%'}</td><td class="mono ${cls(r.pnl)}">${usd(r.pnl)}</td><td class="mono ${r.worst < 0 ? 'down' : ''}">${r.worst == null ? '–' : usd(r.worst)}</td><td class="mono ${r.dd < 0 ? 'down' : ''}">${r.dd < 0 ? usd(r.dd) : '–'}</td><td>${r.open ? `${esc(r.open)} · <span class="down">up to ${usd(-(r.risk ?? 0))}</span>` : 'flat'}</td></tr>`).join('')}<tr style="border-top:2px solid var(--line)"><td><b>Total</b></td><td>${T.strategies} strategies</td><td class="mono"><b>${T.n}</b></td><td class="mono"><b>${T.wp == null ? '–' : T.wp + '%'}</b></td><td class="mono ${cls(T.pnl)}"><b>${usd(T.pnl)}</b></td><td></td><td></td><td>${T.open} open · <span class="down">up to ${usd(-T.risk)}</span></td></tr></tbody></table></div>` : '<div class="empty">Paper desks start recording with the next run.</div>';
  return card('📋 Paper scorecard · pretend money, real prices', `<p style="margin:0 0 10px">How each paper strategy would be doing if it were real: how often it's right, what it made, its worst single trade, its biggest drop from a high, and what its open trade could still lose. None of this is real money.</p>${body}`, 'span3');
}
function paperCard() {
  const L = D.pled, b = L?.leaderboard || [], S = L?.strategies || {};
  const body = b.length ? `<div class="scroll"><table><thead><tr><th>Paper strategy</th><th>Desk</th><th>Trades</th><th>Win %</th><th>P&amp;L</th><th>Profit factor</th><th>Now</th><th>What it tests</th></tr></thead><tbody>${b.map(r => { const st = S[r.id] || {};
      return `<tr><td><b>${esc(r.name)}</b>${r.promotionCandidate ? ' <span class="tag bull">PROMOTE?</span>' : ''}</td><td>${r.desk}</td><td class="mono">${r.trades}</td><td class="mono">${r.winRatePct ?? '–'}</td><td class="mono ${cls(r.pnlUsd)}">${usd(r.pnlUsd)}</td><td class="mono">${r.profitFactor ?? '–'}</td><td>${st.open ? '<span class="org">' + esc(st.open.label || st.open.symbol) + '</span>' : 'flat'}</td><td style="white-space:normal;color:var(--muted)">${esc(st.about || '')}</td></tr>`; }).join('')}</tbody></table></div>`
    : '<div class="empty">The Paper Lab starts with the next hourly run.</div>';
  return card('🧪 Paper Lab · runs alongside live trading, no real money', `<p style="margin:0 0 10px">Sim and Echo paper-trade different versions of the rules on the same live Robinhood quotes. Options P&amp;L is per spread; crypto uses $15 paper positions. <b>CEO auto-approval:</b> a variant that reaches 20+ paper trades with profit factor ≥ 1.3 and beats the live rules is promoted to live automatically, within hard limits, and rolled back automatically if it loses live. Variants that remove a safety rule still need the board.</p>${body}<p>Updated ${L?.updatedAt ? ago(L.updatedAt) : 'never'}.</p>`, 'span3');
}
function payrollCard() {
  const p = payroll(); const order = ['claude', 'atlas', 'analyst', 'guard', 'quinn', 'scout', 'sim', 'echo', 'medic', 'ledger', 'planner', 'options'];
  const gc = g => g === 'A' || g === 'B' ? 'up' : g === 'C' ? 'warn' : 'down';
  const v = { profit: ['up', `The company made ${usd(p.wk.usd)} this week: full pay plus a ${credits(p.pool)} profit-sharing bonus.`], flat: ['warn', `No money made or lost this week (${p.wk.trades} closed trades): <b>half pay</b>. Capital was protected but nothing was earned.`], loss: ['down', `The company lost ${usd(p.wk.usd)} this week: <b>no paychecks</b>. Everyone's pay is docked to zero until results turn positive.`] }[p.wk.verdict];
  const lastTxt = { profit: `Last week: profit ${usd(p.last.usd)} · full pay`, flat: 'Last week: flat · half pay', loss: `Last week: loss ${usd(p.last.usd)} · no pay` }[p.last.verdict];
  return card('🎮 Office payroll · just for fun', `<p style="margin:0 0 8px">Agents earn made-up <b>HQ credits</b>. Their score comes from doing their real jobs well, and from passing their boss's audit. <b>How much of it gets paid depends on the company's real result this week</b>: profit means full pay plus a bonus, flat means half pay, a loss means no paychecks. <b>No real money is paid, and credits are not dollars.</b></p>
    <p class="${v[0]}" style="font-weight:600">${v[1]}</p>
    <p>🏆 <b>$1K bonus:</b> when trading profits grow the $117 start to <b>$1,000</b>, everyone shares a one-time <b>🪙 100,000</b> bonus. Progress: <b class="${cls(p.life)}">${usd(p.life)}</b> of ${usd(p.goal)} (${Math.max(0, Math.min(100, p.life / p.goal * 100)).toFixed(1)}%)${p.hit ? ' · <b class="up">HIT!</b>' : ''}</p>
    <div class="scroll"><table><thead><tr><th>Agent</th><th>Boss</th><th>Score</th><th>Grade</th><th>Earned</th><th>Docked</th><th>Bonus</th><th>Paycheck</th><th>Why</th></tr></thead><tbody>${order.map(k => { const r = p.rows[k], a = agents[k];
      return `<tr><td><b style="color:${a.kind === 'chief' ? '#fff' : a.color}">${a.name}</b> <span style="color:var(--muted);font-size:11px">${esc(a.title || '')}</span></td><td>${a.boss ? agents[a.boss].name : '–'}</td><td class="mono">${r.score}</td><td class="mono ${gc(r.grade)}">${r.grade}</td><td class="mono">${credits(r.earned)}</td><td class="mono ${r.docked ? 'down' : ''}">${r.docked ? '−' + credits(r.docked).slice(3) : '0'}</td><td class="mono">${credits(r.bonus)}</td><td class="mono"><b>${credits(r.pay)}</b></td><td style="white-space:normal;color:var(--muted)">${esc(r.why)}</td></tr>`; }).join('')}</tbody></table></div>
    <p>Total paychecks <b>${credits(p.total)}</b> · team score <b>${p.team}</b> · ${lastTxt} · next payday ${nextPayday()}</p>`, 'span3');
}
function orgCard() {
  const au = D.audit; const by = Object.fromEntries((au?.reports || []).map(r => [r.manager, r]));
  const chip = st => `<span class="stt ${st === 'pass' ? 'ok' : st === 'warn' ? 'warn' : st === 'fail' ? 'bad' : ''}">${st ? st.toUpperCase() : '–'}</span>`;
  const mgrs = ['atlas', 'analyst', 'guard'];
  const team = m => [...new Set([...Object.keys(agents).filter(k => agents[k].boss === m), ...((by[m]?.checks || []).map(c => c.agent).filter(k => agents[k]))])];
  const col = m => { const r = by[m]; return `<div class="box" style="background:#1a1f29"><h3>${agents[m].name} · ${esc(agents[m].title)} ${chip(r?.status)}</h3>
      <ul class="list">${team(m).map(k => { const cs = (r?.checks || []).filter(c => c.agent === k); const worst = cs.some(c => c.status === 'fail') ? 'r' : cs.some(c => c.status === 'warn') ? 'y' : cs.length ? 'g' : '';
        return li(`<b>${agents[k].name}</b> <span style="color:var(--muted)">${esc(agents[k].title)}</span><br>${cs.map(c => `<span style="color:${c.status === 'pass' ? 'var(--up)' : c.status === 'warn' ? 'var(--warn)' : 'var(--down)'}">${c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗'}</span> ${esc(c.check)}: <span style="color:var(--muted)">${esc(c.detail)}</span>`).join('<br>') || '<span style="color:var(--muted)">no checks yet</span>'}`, worst); }).join('')}</ul></div>`; };
  return card(`🏛️ Org chart & management audit ${chip(au?.ceo?.status)}`, `<p style="margin:0 0 10px"><b>Claude (CEO)</b> ← three managers check their teams' real work every hour and report up. ${au ? `Latest audit ${ago(au.generatedAt)}: ${esc(au.ceo.summary)}.` : 'The first audit runs with the next hourly task.'}</p><div class="cgrid" style="margin-top:0">${mgrs.map(col).join('')}</div>`, 'span3');
}
function planOut(p) {
  const mx = Math.max(...p.scenarios.map(s => s.value), 1);
  return `${card('Capital needed', `<div class="big">${money(p.requiredCapital)}</div><p>to draw ${money(p.incomeAtDeadline)}/month in ${p.months} months at ${p.withdrawalRate}%</p><div class="bar"><i style="width:${Math.max(.5, p.progress)}%"></i></div><p>${p.progress.toFixed(3)}% of the way there today</p>`)}
      ${card('Projected in ' + p.months + ' months', `<div class="big">${money(p.projectedCapital)}</div><p>${money(p.deposits)} deposits + ${money(p.modeledGrowth)} modeled growth → ${money(p.monthlyCapacity)}/month income capacity</p>`)}
      ${card('To hit the goal on time', `<div class="big warn">${money(p.requiredContribution)}</div><p>per month in contributions at ${p.annualReturn}%/yr. Gap today: ${money(p.gap)}.</p>`)}
      ${card('Return scenarios', `<div class="sbars">${p.scenarios.map(s => `<div class="sbar"><span class="mono ${cls(s.annualReturn)}">${s.annualReturn > 0 ? '+' : ''}${s.annualReturn}%/yr</span><div class="bar"><i style="width:${Math.max(1, s.value / mx * 100)}%"></i></div><span class="mono">${money(s.value)}</span></div>`).join('')}</div>`, 'span2')}
      ${card('Milestones', `<ul class="list">${p.milestones.map(m => li(`${money(m.capital)} → ${money(m.monthlyIncome)}/mo ${m.achieved ? '· reached' : m.projected ? '· on track' : ''}`, m.achieved ? 'g' : m.projected ? 'y' : '')).join('')}</ul>`)}`;
}
CONSOLES.strategy = function () {
  const o = D.dled?.open, tr = D.dled?.trades || [], bt = D.dbt?.chosenOnTrain, c = D.dcfg;
  const wins = tr.filter(t => t.pnlUsd > 0).length;
  return `<div class="ch"><h2>🧠 Strategy Lab</h2><span class="who">Quinn the Strategist runs the live Dip desk</span></div>
  <div class="cgrid">
    ${card('Dip desk (LIVE)', o ? `<div class="big org">${esc(o.symbol)}</div><p>$${o.usd} bought at ${o.entryPrice} on ${when(o.enteredAt)}. Sells on the bounce (above its 5-day average), after 10 days, or at a ${c?.exit?.stopPct ?? 5}% stop.</p>` : `<div class="big">WAITING</div><p>Buys $${c?.risk?.positionUsd ?? 25} of SPY, QQQ, DIA or IWM in the last run before the close when RSI(2) &lt; ${c?.entry?.rsi2Below ?? 5} and it's above its 200-day average.</p>`)}
    ${card('Results', `<div class="big ${cls(dipPnl())}">${usd(dipPnl())}</div><p>${tr.length} trades · ${wins} won · ${tr.length - wins} lost</p>`)}
    ${card('Why we hired for this', bt ? `<ul class="list">${li(`Picked on 2023–24, then tested on unseen 2025–26: <b>${bt.test.trades} trades, ${bt.test.winRatePct}% wins, +${bt.test.avgTradePct}%/trade</b>, profit factor ${bt.test.profitFactor}`, 'g')}${li(`All ${D.dbt.combosWithPositiveTest} nearby settings were profitable out of sample`, 'g')}${li('Caveat: 2023–26 was mostly a rising market. A bear market will be harder; the 200-day filter keeps it out of downtrends.', 'y')}</ul>` : '<div class="empty">Backtest loading.</div>')}
    ${card('Dip trades', tr.length ? `<div class="scroll"><table><thead><tr><th>ETF</th><th>Bought</th><th>Sold</th><th>Entry</th><th>Exit</th><th>Result</th><th>Why</th></tr></thead><tbody>${tr.slice().reverse().map(t => `<tr><td><b>${t.symbol}</b></td><td>${when(t.enteredAt)}</td><td>${when(t.exitedAt)}</td><td class="mono">${t.entryPrice}</td><td class="mono">${t.exitPrice}</td><td class="mono ${cls(t.pnlUsd)}">${usd(t.pnlUsd)} (${pct(t.returnPct)})</td><td>${esc(t.reason)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No dip trades yet. Dips like this come a couple of times a month.</div>', 'span3')}
  </div>`;
};
CONSOLES.breakroom = function () {
  const p = payroll(); const mood = p.wk.verdict === 'profit' ? ['😄', 'Great: profitable week, full pay plus bonus'] : p.wk.verdict === 'flat' ? ['🙂', 'Okay: flat week, half pay'] : ['😟', 'Low: losing week, no paychecks'];
  return `<div class="ch"><h2>☕ Break Room</h2><span class="who">Where the team recharges</span></div>
  <div class="cgrid">
    ${card('Team morale', `<div class="big">${mood[0]}</div><p>${mood[1]}. Morale follows the company's results, just like pay.</p>`)}
    ${card('Coffee breaks', `<div class="big">${coffees}</div><p>since you opened this page</p>`)}
    ${card('House rules', `<ul class="list">${li('Breaks are short: trading checks never wait for coffee')}${li('No talking about positions you can\'t back with evidence')}${li('Ping-pong losers refill the coffee 🏓')}</ul>`)}
  </div>`;
};
const ROOM_BLURB = { lobby: 'ClaudeBot health, the org chart, management audit and market regime.', research: 'Stock watchlist, crypto scanner and the 🧪 Paper Lab.', diagnostics: 'Data freshness, runners, breakers and pipelines.', freedom: 'Your financial-freedom planner and milestones.', trading: 'What the crypto and options desks hold and did.', risk: 'Every limit, event pause and the strategy stress test.', vault: 'The trade ledger, results and the 🎮 agent payroll.', strategy: 'Quinn and the live Dip desk: research, evidence, trades.', breakroom: 'Coffee, ping-pong and team morale.' };
const TITLES = { office: ['Office', "What are ClaudeBot's agents doing right now?"], lobby: ['Lobby · Overview', 'The big picture'], research: ['Research Lab', 'What the agents are watching'], diagnostics: ['Diagnostics', 'Is everything healthy?'], freedom: ['Freedom Room', 'Planning the path to monthly income'], trading: ['Trading Floor', 'Positions and trades'], risk: ['Risk Office', 'The rules every order must pass'], vault: ['Vault · Ledger', 'Every trade on the record, plus the agent payroll game'], strategy: ['Strategy Lab', 'New ways to make money, tested before they trade'], breakroom: ['Break Room', 'Coffee, ping-pong and morale'] };
let current = 'office';
function renderConsole() {
  $('console').innerHTML = CONSOLES[current]();
  const f = $('planf'); if (f) f.addEventListener('input', () => {
    const v = {}; for (const e of f.elements) if (e.name) v[e.name] = Number(e.value);
    try { const p = projectPlan({ ...DEFAULT_PLAN, ...v }); localStorage.setItem('hq-freedom', JSON.stringify(v)); $('planerr').textContent = ''; $('planout').innerHTML = planOut(p); }
    catch (e) { $('planerr').textContent = e.message; }
  });
}
function route2() {
  const h = (location.hash || '#office').slice(1); current = CONSOLES[h] ? h : 'office';
  document.querySelectorAll('#nav a[data-room]').forEach(a => a.classList.toggle('on', a.dataset.room === current));
  document.querySelectorAll('.rc').forEach(c => c.classList.toggle('on', c.dataset.r === current));
  Object.entries(hits).forEach(([id, p]) => p.setAttribute('class', 'roomhit' + (id === current ? ' sel' : '')));
  const [t, s] = TITLES[current]; $('title').textContent = t; $('subtitle').textContent = s; document.title = (current === 'office' ? '' : t + ' · ') + 'Teststock HQ';
  animCam(current === 'office' ? HOME() : roomCam(current)); renderConsole(); $('nav').classList.remove('open');
}
addEventListener('hashchange', route2);
function renderAll() { renderWalls(); renderKpis(); renderJournal(); if (current === 'freedom') return; renderConsole(); }

renderRoster(); renderRoomCards();
await refresh(); route2(); updateStatuses();
Object.keys(agents).forEach(runAgent);
setInterval(refresh, 120000);
