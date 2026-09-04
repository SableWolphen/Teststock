import fs from 'node:fs/promises';

const indexPath='docs/index.html';
const cryptoPath='docs/crypto.html';

let html=await fs.readFile(indexPath,'utf8');

html=html.replace(
  "let signal,board,stocks,crypto,learning,audit,corr,validation,congress,rhCross;",
  "let signal,board,stocks,crypto,learning,audit,corr,validation,congress;"
);

html=html.replace(
  /function robinhoodCrossCheckLine\(lead\)\{.*?\}\nfunction renderCrypto\(\)/s,
  `function runtimeBrokerLine(lead){if(!lead)return '';let auditAge=age(audit?.lastClaudeRun),fresh=auditAge!=null&&auditAge<=15,verified=fresh&&audit?.brokerVerified===true;if(verified)return \`<div class="whyline">Robinhood runtime verification · \\${auditAge}m ago: broker state was freshly verified by Claude through Robinhood Trading MCP. Every order still requires a new immediate pre-submit recheck.</div>\`;return '<div class="whyline"><b>Robinhood runtime check:</b> REQUIRED NOW — Claude re-fetches live price, tradability, buying power, positions, open orders, spread and duplicate state through Robinhood Trading MCP immediately before any order. No cached broker snapshot is accepted as current.</div>'}\nfunction renderCrypto()`
);

html=html.replace(
  "$('cryptoPill').textContent=c?`${safe(c.grade)} · BUY SETUP`:`NO TRADE`;$('cryptoPill').className='pill '+(c?'ok':'warn');",
  "$('cryptoPill').textContent=c?`${safe(c.grade)} · RESEARCH QUALIFIED`:`NO TRADE`;$('cryptoPill').className='pill '+(c?'warn':'warn');"
);
html=html.replace(
  "let reason=c?'Qualified for final Robinhood checks.':(misses.join(' · ')||'One or more hard gates did not pass.');",
  "let reason=c?'Research qualified. A fresh Robinhood MCP verification is still mandatory immediately before execution.':(misses.join(' · ')||'One or more hard gates did not pass.');"
);
html=html.replace(
  "<b>${c?'Ready for broker verification':'Why it is waiting'}:</b>",
  "<b>${c?'Waiting for live broker verification':'Why it is waiting'}:</b>"
);
html=html.replaceAll('robinhoodCrossCheckLine(lead)','runtimeBrokerLine(lead)');
html=html.replace(
  "[signal,board,stocks,crypto,learning,audit,corr,validation,congress,rhCross]=await Promise.all([get('docs/signal.json'),get('docs/data/trigger-board.json'),get('docs/data/stock-tournament.json'),get('docs/data/crypto-tournament.json'),get('docs/data/adaptive-performance.json'),get('docs/data/claude-execution-audit.json'),get('docs/data/portfolio-correlation.json'),get('docs/data/entry-gate-validation.json'),get('docs/data/congressional-intelligence.json'),get('docs/data/crypto-robinhood-cross-check.json')]);",
  "[signal,board,stocks,crypto,learning,audit,corr,validation,congress]=await Promise.all([get('docs/signal.json'),get('docs/data/trigger-board.json'),get('docs/data/stock-tournament.json'),get('docs/data/crypto-tournament.json'),get('docs/data/adaptive-performance.json'),get('docs/data/claude-execution-audit.json'),get('docs/data/portfolio-correlation.json'),get('docs/data/entry-gate-validation.json'),get('docs/data/congressional-intelligence.json')]);"
);

if(html.includes('crypto-robinhood-cross-check.json')||html.includes('Robinhood live cross-check: STALE')){
  throw new Error('legacy crypto broker snapshot reference remains in dashboard');
}
await fs.writeFile(indexPath,html);

let crypto=await fs.readFile(cryptoPath,'utf8');
crypto=crypto.replace(
  /<div class="warn"><b>Execution note:<\/b>.*?<\/div>/s,
  '<div class="warn"><b>Execution note:</b> Qualified crypto is automatic through Claude and the official Robinhood Trading MCP. A fresh live broker recheck is required immediately before every order; cached broker snapshots are never treated as current.</div>'
);
crypto=crypto.replace('if(!Number.isFinite(age)||age>150)return\'STALE\';','if(!Number.isFinite(age)||age>25)return\'REFRESH REQUIRED\';');
crypto=crypto.replace("Crypto data is unavailable or stale. Do nothing.","Crypto data is unavailable or outside the freshness window. Refresh before any action.");
await fs.writeFile(cryptoPath,crypto);

console.log('Dashboard freshness normalized: no legacy Robinhood snapshot dependency; runtime MCP verification is authoritative.');
