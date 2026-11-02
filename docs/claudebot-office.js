// ClaudeBot Agent Office: little agents act out what the bot is really doing,
// driven by the live signal + ledger JSON files. Purely visual; reads public data only.
(function () {
  const RAW = 'https://raw.githubusercontent.com/SableWolphen/teststock/main/docs/data/';
  async function getJSON(name) {
    for (const base of [RAW, 'data/']) {
      try { const r = await fetch(base + name + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) {}
    }
    return null;
  }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pct = v => v == null || isNaN(v) ? '–' : (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  const usd = v => v == null ? '–' : (v < 0 ? '-$' : '+$') + Math.abs(v).toFixed(2);
  const ago = t => { if (!t) return 'never'; const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };

  const root = document.getElementById('office');
  if (!root) return;

  // stations (percent coordinates of the floor)
  const ST = {
    scanner: { x: 14, y: 44, label: 'MARKET SCANNER', icon: '📡' },
    risk:    { x: 50, y: 38, label: 'RISK DESK', icon: '🛡️' },
    crypto:  { x: 85, y: 44, label: 'CRYPTO DESK', icon: '🪙' },
    options: { x: 20, y: 86, label: 'OPTIONS DESK', icon: '📈' },
    ledger:  { x: 54, y: 88, label: 'LEDGER VAULT', icon: '📒' },
    rh:      { x: 86, y: 86, label: 'ROBINHOOD LINK', icon: '🔌' },
    lounge:  { x: 50, y: 66, label: '', icon: '' },
  };
  const AG = {
    scout:   { name: 'SCOUT',   color: '#3ddc84', hat: 'antenna', home: 'scanner' },
    guard:   { name: 'GUARD',   color: '#ff5c6c', hat: 'helmet',  home: 'risk' },
    crypto:  { name: 'CRYPTO',  color: '#ff8a3d', hat: 'cap',     home: 'crypto' },
    options: { name: 'OPTIONS', color: '#a78bfa', hat: 'visor',   home: 'options' },
    ledger:  { name: 'LEDGER',  color: '#f5c451', hat: 'glasses', home: 'ledger' },
  };

  function sprite(a) {
    const hats = {
      antenna: '<line x1="20" y1="4" x2="20" y2="-4" stroke="#cfd6e3" stroke-width="2"/><circle cx="20" cy="-5" r="3" fill="#3ddc84" class="blinky"/>',
      helmet: '<path d="M8 12 Q20 -2 32 12 Z" fill="#cfd6e3"/>',
      cap: '<path d="M9 11 Q20 0 31 11 Z" fill="#1a1d24"/><rect x="28" y="9" width="9" height="3" rx="1.5" fill="#1a1d24"/>',
      visor: '<rect x="10" y="11" width="20" height="5" rx="2.5" fill="#0b0c0f" opacity=".85"/>',
      glasses: '<circle cx="15" cy="16" r="4" fill="none" stroke="#1a1d24" stroke-width="1.6"/><circle cx="25" cy="16" r="4" fill="none" stroke="#1a1d24" stroke-width="1.6"/>',
    };
    return `<svg viewBox="-2 -10 44 62" class="bot">
      <ellipse cx="20" cy="50" rx="13" ry="3.5" fill="#000" opacity=".35"/>
      <g class="legs"><rect class="l1" x="12" y="38" width="6" height="10" rx="3" fill="${a.color}" opacity=".8"/><rect class="l2" x="22" y="38" width="6" height="10" rx="3" fill="${a.color}" opacity=".8"/></g>
      <g class="body"><rect x="6" y="22" width="28" height="20" rx="9" fill="${a.color}"/>
      <rect x="14" y="27" width="12" height="8" rx="2" fill="#0b0c0f" opacity=".25"/>
      <circle cx="20" cy="15" r="11" fill="#eef1f6"/>
      <g class="eyes"><circle cx="15.5" cy="15.5" r="1.8" fill="#14161b"/><circle cx="24.5" cy="15.5" r="1.8" fill="#14161b"/></g>
      <path d="M16 20 Q20 23 24 20" stroke="#14161b" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      ${hats[a.hat] || ''}</g></svg>`;
  }

  // build scene
  root.innerHTML = `
    <div class="of-floor">
      ${Object.entries(ST).filter(([, s]) => s.label).map(([k, s]) => `
        <div class="of-station" id="st-${k}" style="left:${s.x}%;top:${s.y}%">
          <div class="of-desk"><span class="of-ico">${s.icon}</span><span class="of-light"></span></div>
          <div class="of-lbl">${s.label}</div>
        </div>`).join('')}
      ${Object.entries(AG).map(([k, a]) => `
        <div class="of-agent" id="ag-${k}" style="left:${ST[a.home].x}%;top:${ST[a.home].y - 15}%">
          <div class="of-bubble" id="bb-${k}"></div>
          ${sprite(a)}
          <div class="of-name" style="color:${a.color}">${a.name}</div>
        </div>`).join('')}
    </div>
    <div class="of-feed" id="of-feed"></div>`;

  const pos = {};
  for (const [k, a] of Object.entries(AG)) { const el0 = document.getElementById('ag-' + k); el0.classList.toggle('edge-r', ST[a.home].x > 72); el0.classList.toggle('edge-l', ST[a.home].x < 28); }
  for (const [k, a] of Object.entries(AG)) pos[k] = { x: ST[a.home].x, y: ST[a.home].y - 15 };

  async function walk(k, station, dx = 0, dy = -15) {
    const el = document.getElementById('ag-' + k);
    const s = ST[station];
    const to = { x: s.x + dx, y: s.y + dy };
    const d = Math.hypot(to.x - pos[k].x, (to.y - pos[k].y) * 0.6);
    const ms = Math.max(500, d * 70);
    el.classList.add('walking');
    el.classList.toggle('flip', to.x < pos[k].x);
    el.style.transition = `left ${ms}ms linear, top ${ms}ms linear`;
    el.style.left = to.x + '%'; el.style.top = to.y + '%';
    pos[k] = to;
    el.classList.toggle('edge-r', to.x > 72); el.classList.toggle('edge-l', to.x < 28);
    await sleep(ms);
    el.classList.remove('walking');
  }
  async function say(k, text, ms) {
    const b = document.getElementById('bb-' + k);
    b.innerHTML = esc(text);
    b.classList.add('on');
    await sleep(ms || Math.min(6500, 1800 + text.length * 45));
    b.classList.remove('on');
    await sleep(250);
  }
  function light(station, state) {
    const el = document.querySelector(`#st-${station} .of-light`);
    if (el) el.className = 'of-light ' + (state || '');
  }

  let data = {};
  async function refresh() {
    const [sig, led, oled] = await Promise.all([getJSON('claudebot-signal.json'), getJSON('claudebot-ledger.json'), getJSON('claudebot-options-ledger.json')]);
    data = { sig, led, oled };
    const feed = [];
    (led?.runs || []).forEach(r => feed.push({ t: r.t, who: 'CRYPTO', c: AG.crypto.color, txt: r.detail }));
    (oled?.runs || []).forEach(r => feed.push({ t: r.t, who: 'OPTIONS', c: AG.options.color, txt: r.detail }));
    feed.sort((a, b) => new Date(b.t) - new Date(a.t));
    document.getElementById('of-feed').innerHTML = feed.slice(0, 5).map(f => `<div><span style="color:${f.c}">${f.who}</span> <span class="of-t">${ago(f.t)}</span> ${esc(f.txt)}</div>`).join('') || '<div class="of-t">Waiting for the first hourly run…</div>';
    light('crypto', led?.open ? 'busy' : 'ok');
    light('options', oled?.open ? 'busy' : 'ok');
    light('risk', sig?.regime?.riskOff ? 'warn' : 'ok');
    light('scanner', sig ? 'ok' : 'warn');
    light('ledger', 'ok'); light('rh', 'ok');
  }

  // one "episode" = the agents acting out the latest real state
  async function episode() {
    await refresh();
    const { sig, led, oled } = data;
    const coins = sig?.coins || [];
    const best = sig?.bestCandidate;
    const top = coins[0];

    // 1. Scout scans and reports to Guard
    await say('scout', `Scanned ${coins.length || 8} coins ${ago(sig?.generatedAt)}.`, 2200);
    await walk('scout', 'risk', -11, -12);
    if (sig?.regime?.riskOff) await say('scout', 'Bitcoin is under its 200-hour average. Market looks risk-off.');
    else if (best) await say('scout', `${best} has a clean setup! RSI ${coins.find(c => c.symbol === best)?.rsi}.`);
    else if (top) await say('scout', `Closest is ${top.symbol}: ${(top.blockers || [])[0] || 'not quite there'}.`);
    // 2. Guard rules on crypto
    if (best && !sig?.regime?.riskOff) await say('guard', `${best} passes every check. Crypto, you're cleared, max $15, stop goes in first.`);
    else await say('guard', 'Robinhood charges ~1.9% to get in and out. No edge, no trade. Cash is a position.');
    walk('scout', 'scanner');

    // 3. Crypto desk
    await walk('crypto', 'rh', 0, -15);
    const lc = (led?.runs || []).slice(-1)[0];
    if (led?.open) await say('crypto', `Holding ${led.open.symbol} from ${led.open.entryPrice}. Stop ${led.open.stop}, target ${led.open.target}.`);
    else await say('crypto', lc ? `Last check ${ago(lc.t)}: ${lc.detail}` : 'Standing by in cash.');
    walk('crypto', 'crypto');

    // 4. Options desk
    await walk('options', 'risk', 11, -12);
    const lo = (oled?.runs || []).slice(-1)[0];
    if (oled?.open) {
      const p = oled.open;
      await say('options', `I'm short ${p.label} for ${p.credit} credit. Max loss $${p.maxLossUsd}.`);
      await say('guard', `I'll pull you out at 50% profit, at ${(p.credit * 2.5).toFixed(2)} to buy back, or if ${p.underlying} breaks ${p.shortStrike}.`);
    } else if (lo) {
      await say('options', `Last scan ${ago(lo.t)}: ${lo.detail}`);
      await say('guard', 'Good. One spread at a time, never more than ~$85 at risk.');
    } else {
      await say('options', 'Market hours only. I scan SPY, DIA, IWM, KRE and XLF from 9:00 to 1:30 Central.');
      await say('guard', 'And nothing new right before elections, Fed days, CPI or jobs reports.');
    }
    walk('options', 'options');

    // 5. Ledger sums it up
    await walk('ledger', 'lounge', 0, -8);
    const snaps = led?.snapshots || [];
    const idx = snaps.length ? snaps[snaps.length - 1].index : (led?.equityIndex || 100);
    const ot = oled?.trades || [];
    const opnl = ot.reduce((a, t) => a + t.pnlUsd, 0);
    await say('ledger', `Crypto ${pct(idx - 100)} since start. Options ${usd(opnl)} over ${ot.length} spread${ot.length === 1 ? '' : 's'}. Everything's in the books.`);
    await walk('ledger', 'ledger');

    // idle chatter
    const idle = [
      ['scout', 'Next price scan at :04 past the hour.'],
      ['guard', 'Rule #1: exits before entries.'],
      ['crypto', 'Spread on Robinhood crypto is brutal today…'],
      ['options', 'Theta is paid while we wait. ⏳'],
      ['ledger', 'No account numbers in here. Just prices and percents.'],
    ];
    const [who, line] = idle[Math.floor(Math.random() * idle.length)];
    await say(who, line, 2600);
    await sleep(1500);
  }

  // wander the idle agents a little while others talk
  setInterval(() => {
    for (const k of ['scout', 'ledger']) {
      const el = document.getElementById('ag-' + k);
      if (!el.classList.contains('walking') && Math.random() < 0.25) el.classList.toggle('flip');
    }
  }, 2000);

  (async function loop() {
    for (;;) { try { await episode(); } catch (e) { console.error(e); await sleep(5000); } }
  })();
})();
