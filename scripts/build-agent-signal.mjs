import fs from 'node:fs/promises';
import path from 'node:path';

const budgets = [50, 100, 200, 500];
const outDir = path.resolve('docs');
const dataDir = path.join(outDir, 'data');
const round = (n, d = 2) => Number(Number(n || 0).toFixed(d));
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

function freshness(data) {
  const asOf = new Date(data?.asOf || 0).getTime();
  const ageMinutes = Number.isFinite(asOf) ? Math.max(0, Math.round((Date.now() - asOf) / 60000)) : null;
  const marketOpen = Boolean(data?.session?.isOpen || data?.market === 'OPEN');
  const maxAgeMinutes = marketOpen ? 90 : 2160;
  const stale = ageMinutes == null || ageMinutes > maxAgeMinutes;
  return { marketOpen, ageMinutes, maxAgeMinutes, stale };
}

function itemState(item, fresh) {
  if (fresh.stale) return 'STALE_DO_NOT_TRADE';
  if (!fresh.marketOpen) return 'MARKET_CLOSED_RECHECK';
  const price = Number(item.price || 0);
  const entry = Number(item.entry || 0);
  if (!price || !entry) return 'MISSING_PRICE_DO_NOT_TRADE';
  if (price < entry * 0.998) return 'WAIT_FOR_TRIGGER';
  if (price > entry * 1.02) return 'DO_NOT_CHASE';
  return 'READY_TO_REVIEW';
}

function confidence(data) {
  const p = data.featured || {};
  const learning = Number(p.learningScore ?? data.learning?.score ?? p.score ?? 0);
  const winRate = Number(data.learning?.calibration?.winRate ?? p.validation?.winRate ?? 50);
  const samples = Number(data.learning?.calibration?.samples ?? p.validation?.samples ?? 0);
  let score = learning;
  if (samples >= 15) score += (winRate - 50) * 0.25;
  if (data.regime?.tradeGate === 'TRADE') score += 3;
  if (data.learning?.sector?.confirm === false) score -= 6;
  if (data.learning?.intraday?.confirm === false) score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: score >= 88 ? 'HIGH' : score >= 78 ? 'MEDIUM' : 'LOW' };
}

function stockOrders(data, budget, fresh) {
  if (data.action !== 'TRADE CANDIDATE') return [];
  return (data.recommendations || []).slice(0, 3).map((r, index) => ({
    rank: index + 1,
    ticker: r.symbol,
    sector: r.sector || null,
    action: itemState(r, fresh),
    allocationDollars: round(r.allocation ?? r.estimatedCost ?? 0),
    estimatedSharesAtTrigger: r.entry ? round(Number(r.allocation ?? r.estimatedCost ?? 0) / Number(r.entry), 6) : null,
    scanPrice: round(r.price),
    minimumEntry: round(r.entry),
    maximumEntry: round(Number(r.entry || 0) * 1.02),
    stop: round(r.stop),
    target1: round(r.target1),
    target2: round(r.target2),
    estimatedLossAtStop: round(r.maxLossAtStop),
    setupScore: r.score ?? null,
    historicalWinRate: r.validation?.winRate ?? null,
    historicalSamples: r.validation?.samples ?? null,
    fundamentalsLabel: r.fundamentals?.label ?? null,
    holdingStyle: r.holdingStyle || 'Several weeks to several months',
    reviewCadence: r.reviewCadence || 'Weekly'
  }));
}

function optionOrder(data, budget, fresh) {
  const p = data.featured || {};
  const o = p.option;
  if (!o || data.action !== 'TRADE CANDIDATE' || Number(o.maxRisk || 0) <= 0 || Number(o.maxRisk) > budget) return null;
  const stockState = itemState({price:p.price, entry:p.entry}, fresh);
  return {
    ticker: p.symbol,
    action: stockState === 'READY_TO_REVIEW' ? 'READY_TO_REVIEW' : stockState,
    kind: o.kind || null,
    side: o.side || null,
    expiry: o.expiry || null,
    longStrike: o.longStrike ?? o.strike ?? null,
    shortStrike: o.shortStrike ?? null,
    maxRisk: round(o.maxRisk),
    maxProfit: o.maxProfit == null ? null : round(o.maxProfit),
    breakeven: o.breakeven == null ? null : round(o.breakeven),
    probabilityModel: o.probProfit == null ? null : round(o.probProfit),
    verifyLiveQuote: true
  };
}

function buildBudgetPlan(data, budget) {
  if (data?.error || !data?.featured) {
    return {budget, overallAction:'DO_NOT_TRADE', reason:data?.error || 'No usable Teststock scan is available.', stockOrders:[], optionOrder:null};
  }
  const fresh = freshness(data);
  const conf = confidence(data);
  const stocks = stockOrders(data, budget, fresh);
  const readyStocks = stocks.filter(x => x.action === 'READY_TO_REVIEW');
  const plannedAllocation = round(stocks.reduce((s,x)=>s+Number(x.allocationDollars||0),0));
  const readyAllocation = round(readyStocks.reduce((s,x)=>s+Number(x.allocationDollars||0),0));
  const readyStopRisk = round(readyStocks.reduce((s,x)=>s+Number(x.estimatedLossAtStop||0),0));
  let overallAction = 'DO_NOT_TRADE';
  let reason = 'No qualified setup.';
  if (fresh.stale) { overallAction = 'DO_NOT_TRADE'; reason = 'Signal is stale. Request a fresh Teststock scan.'; }
  else if (!fresh.marketOpen) { overallAction = 'WAIT_FOR_MARKET_OPEN'; reason = 'Market is closed. Re-read Teststock after the market opens.'; }
  else if (readyStocks.length) { overallAction = 'READY_TO_REVIEW'; reason = 'One or more Teststock stock allocations are at their entry and ready for live Robinhood verification.'; }
  else if (stocks.length) { overallAction = 'WAIT_FOR_TRIGGER'; reason = 'Qualified ideas exist, but none is at a valid entry yet.'; }
  else if (data.action === 'WATCH') { overallAction = 'WATCH'; reason = 'Setup is promising but has not passed all Teststock gates.'; }

  const expiresAt = data?.asOf ? new Date(new Date(data.asOf).getTime() + (fresh.marketOpen ? 90 : 2160) * 60000).toISOString() : null;
  return {
    budget,
    overallAction,
    reason,
    confidence: conf,
    signalAsOf: data.asOf || null,
    expiresAt,
    market: data.market || data.session?.label || null,
    marketRegime: data.regime?.label || null,
    dataQuality: data.dataQuality || null,
    plannedAllocationDollars: Math.min(budget, plannedAllocation),
    readyAllocationDollars: Math.min(budget, readyAllocation),
    keepCashDollars: round(Math.max(0, budget - Math.min(budget, readyAllocation))),
    estimatedLossIfAllReadyStopsHit: readyStopRisk,
    portfolioMethod: data.portfolioPlan?.method || 'Ranked Teststock plan',
    stockOrders: stocks,
    optionOrder: optionOrder(data, budget, fresh)
  };
}

const plans = [];
for (const budget of budgets) {
  try {
    plans.push(buildBudgetPlan(await readJson(path.join(dataDir, `latest-${budget}.json`)), budget));
  } catch (error) {
    plans.push({budget, overallAction:'DO_NOT_TRADE', reason:`Latest $${budget} scan is unavailable: ${error.message}`, stockOrders:[], optionOrder:null});
  }
}

const signal = {
  schemaVersion: 2,
  source: 'Teststock',
  purpose: 'Machine-readable Teststock plan for an AI agent using Robinhood Agentic Trading.',
  generatedAt: new Date().toISOString(),
  defaultBudget: 50,
  requiresUserApproval: true,
  autoExecute: false,
  instructionsForAgent: [
    'Treat Teststock as a screening and sizing input, not as permission to trade.',
    'Before every order, verify Robinhood market status, live bid/ask or executable price, available buying power, and that the Teststock signal has not expired.',
    'Never exceed allocationDollars or maxRisk from the selected budget plan.',
    'For stocks, do not buy below minimumEntry and do not buy above maximumEntry. If outside that range, wait for a fresh Teststock scan.',
    'If several stock orders are READY_TO_REVIEW, preserve the Teststock allocation split rather than putting the whole budget into one name unless the user explicitly asks to change the plan.',
    'Do not substitute a weaker stock merely to invest all available cash.',
    'Ask the user for explicit approval before every buy or sell.',
    'When monitoring an approved position, surface HOLD, REVIEW_PROFIT, or SELL based on the saved stop and targets; do not silently move a stop farther away.',
    'If Robinhood data materially conflicts with Teststock, do not trade and explain the conflict.',
    'No trade is guaranteed to make money.'
  ],
  plans
};

await fs.writeFile(path.join(outDir, 'signal.json'), JSON.stringify(signal, null, 2));
await fs.writeFile(path.join(dataDir, 'claude-signal.json'), JSON.stringify(signal, null, 2));
console.log('Generated Teststock agent signal schema v2');
