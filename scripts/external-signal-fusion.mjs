// Research-only evidence fusion. Never authorizes a broker order.
const finite = n => typeof n === 'number' && Number.isFinite(n);
export function fuseResearchSignals(items, { now = Date.now(), maxAgeMs = 15 * 60_000 } = {}) {
  if (!Array.isArray(items) || !finite(now) || !finite(maxAgeMs) || maxAgeMs <= 0) throw new TypeError('Invalid research inputs');
  const accepted = [], rejected = [];
  const seen = new Set();
  for (const item of items) {
    const key = item && typeof item.source === 'string' && typeof item.symbol === 'string' ? item.source + ':' + item.symbol + ':' + item.kind : '';
    const age = item && typeof item.observedAt === 'string' ? now - Date.parse(item.observedAt) : NaN;
    let reason = '';
    if (!key || !/^[A-Z][A-Z0-9.]{0,9}$/.test(item.symbol)) reason = 'INVALID_IDENTITY';
    else if (seen.has(key)) reason = 'DUPLICATE_SOURCE';
    else if (!finite(age) || age < 0 || age > maxAgeMs) reason = 'STALE_OR_FUTURE';
    else if (!finite(item.score) || item.score < -1 || item.score > 1) reason = 'INVALID_SCORE';
    else if (item.verified !== true) reason = 'UNVERIFIED';
    if (reason) { rejected.push({ source: item?.source, symbol: item?.symbol, reason }); continue; }
    seen.add(key);
    accepted.push({ source:item.source, symbol:item.symbol, kind:item.kind, score:item.score, observedAt:item.observedAt });
  }
  const grouped = new Map();
  for (const x of accepted) { const a=grouped.get(x.symbol)||[];a.push(x);grouped.set(x.symbol,a); }
  const rankings = [...grouped].map(([symbol,signals])=>({ symbol, researchScore: signals.reduce((a,s)=>a+s.score,0)/signals.length, sourceCount:new Set(signals.map(s=>s.source)).size, signals })).sort((a,b)=>b.researchScore-a.researchScore);
  return { mode:'RESEARCH_ONLY', orderAuthorization:false, rankings, rejected };
}
