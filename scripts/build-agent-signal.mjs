import fs from 'node:fs/promises';
import path from 'node:path';

const budgets = [50, 100, 200, 500];
const outDir = path.resolve('docs');
const dataDir = path.join(outDir, 'data');
const round = (n, d = 2) => Number(Number(n || 0).toFixed(d));
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

const POLICY = {
  name: '6-Month Growth Autopilot',
  objective: 'Pursue fast account growth while making capital preservation the first constraint.',
  autoExecution: true,
  requiresPerOrderApproval: false,
  dedicatedAgenticAccountOnly: true,
  marginAllowed: false,
  averagingDownAllowed: false,
  nakedOptionsAllowed: false,
  maxStockPortfolioStopRiskPct: 5,
  maxOptionPremiumRiskPct: 20,
  maxDailyDrawdownPct: 4,
  maxRolling30DayDrawdownPct: 10,
  maxChasePct: 1.5,
  minimumEliteConfidence: 90,
  minimumEliteSetupScore: 90,
  minimumHistoricalWinRate: 60,
  minimumHistoricalSamples: 15,
  minimumOptionDte: 30,
  maximumOptionDte: 90,
  optionStopLossPct: 35,
  optionTakeProfit1Pct: 50,
  optionTakeProfit2Pct: 100,
  stockTakeProfit1Fraction: 0.5,
  cashWhenNoSetup: true
};

function freshness(data) {
  const asOf = new Date(data?.asOf || 0).getTime();
  const ageMinutes = Number.isFinite(asOf) ? Math.max(0, Math.round((Date.now() - asOf) / 60000)) : null;
  const marketOpen = Boolean(data?.session?.isOpen || data?.market === 'OPEN');
  const maxAgeMinutes = marketOpen ? 60 : 2160;
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
  if (price > entry * (1 + POLICY.maxChasePct / 100)) return 'DO_NOT_CHASE';
  return 'READY_TO_AUTO_EXECUTE';
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
  return { score, label: score >= 90 ? 'ELITE' : score >= 82 ? 'STRONG' : 'WAIT' };
}

function rawStockOrders(data, fresh) {
  if (data.action !== 'TRADE CANDIDATE') return [];
  return (data.recommendations || []).slice(0, 3).map((r, index) => {
    const allocation = Number(r.allocation ?? r.estimatedCost ?? 0);
    const risk = Number(r.maxLossAtStop ?? 0);
    return {
      rank: index + 1,
      ticker: r.symbol,
      sector: r.sector || null,
      action: itemState(r, fresh),
      rawAllocationDollars: round(allocation),
      rawEstimatedLossAtStop: round(risk),
      riskPerDollar: allocation > 0 ? risk / allocation : 1,
      scanPrice: round(r.price),
      minimumEntry: round(r.entry),
      maximumEntry: round(Number(r.entry || 0) * (1 + POLICY.maxChasePct / 100)),
      stop: round(r.stop),
      target1: round(r.target1),
      target2: round(r.target2),
      setupScore: r.score ?? null,
      historicalWinRate: r.validation?.winRate ?? null,
      historicalSamples: r.validation?.samples ?? null,
      fundamentalsLabel: r.fundamentals?.label ?? null,
      holdingStyle: r.holdingStyle || 'Several weeks to several months',
      reviewCadence: 'Continuously by agent; human review weekly'
    };
  });
}

function sizeStockOrders(data, budget, fresh) {
  const raw = rawStockOrders(data, fresh);
  const totalRiskCap = budget * POLICY.maxStockPortfolioStopRiskPct / 100;
  let remainingRisk = totalRiskCap;
  let remainingBudget = budget;
  return raw.map(r => {
    let allocation = Math.min(r.rawAllocationDollars, remainingBudget);
    if (r.riskPerDollar > 0) allocation = Math.min(allocation, remainingRisk / r.riskPerDollar);
    allocation = Math.max(0, round(allocation));
    const risk = round(allocation * r.riskPerDollar);
    remainingBudget = Math.max(0, remainingBudget - allocation);
    remainingRisk = Math.max(0, remainingRisk - risk);
    return {
      ...r,
      allocationDollars: allocation,
      estimatedSharesAtTrigger: r.minimumEntry ? round(allocation / r.minimumEntry, 6) : null,
      estimatedLossAtStop: risk,
      autoExecutionEligible: r.action === 'READY_TO_AUTO_EXECUTE' && allocation > 0,
      exitPolicy: {
        stop: r.stop,
        target1: r.target1,
        target1Action: `Sell ${Math.round(POLICY.stockTakeProfit1Fraction * 100)}% and never move the remaining stop lower.`,
        target2: r.target2,
        target2Action: 'Sell the remaining position.',
        invalidationAction: 'Sell the full remaining position.'
      }
    };
  });
}

function daysTo(expiry) {
  const ms = new Date(`${expiry}T20:00:00Z`).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.ceil(ms / 86400000) : null;
}

function optionOrder(data, budget, fresh, conf) {
  const p = data.featured || {};
  const o = p.option;
  if (!o || data.action !== 'TRADE CANDIDATE') return null;
  const dte = daysTo(o.expiry);
  const maxPremiumRisk = round(budget * POLICY.maxOptionPremiumRiskPct / 100);
  const risk = Number(o.maxRisk || 0);
  const winRate = Number(data.learning?.calibration?.winRate ?? p.validation?.winRate ?? 0);
  const samples = Number(data.learning?.calibration?.samples ?? p.validation?.samples ?? 0);
  const setupScore = Number(p.score || 0);
  const elite = conf.score >= POLICY.minimumEliteConfidence &&
    setupScore >= POLICY.minimumEliteSetupScore &&
    winRate >= POLICY.minimumHistoricalWinRate &&
    samples >= POLICY.minimumHistoricalSamples &&
    data.regime?.tradeGate === 'TRADE' &&
    data.learning?.sector?.confirm !== false &&
    data.learning?.intraday?.confirm !== false &&
    dte != null && dte >= POLICY.minimumOptionDte && dte <= POLICY.maximumOptionDte &&
    risk > 0 && risk <= maxPremiumRisk;
  const stockState = itemState({price:p.price, entry:p.entry}, fresh);
  const action = elite && stockState === 'READY_TO_AUTO_EXECUTE' ? 'READY_TO_AUTO_EXECUTE' : stockState === 'READY_TO_AUTO_EXECUTE' ? 'STOCK_ONLY_OPTION_BLOCKED' : stockState;
  return {
    ticker: p.symbol,
    action,
    eliteQualified: elite,
    blockReason: elite ? null : `Options require confidence >= ${POLICY.minimumEliteConfidence}, setup >= ${POLICY.minimumEliteSetupScore}, historical win rate >= ${POLICY.minimumHistoricalWinRate}% with ${POLICY.minimumHistoricalSamples}+ samples, confirming market/sector/intraday signals, ${POLICY.minimumOptionDte}-${POLICY.maximumOptionDte} DTE, and max premium risk <= ${moneyText(maxPremiumRisk)}.`,
    kind: o.kind || null,
    side: o.side || null,
    expiry: o.expiry || null,
    dte,
    longStrike: o.longStrike ?? o.strike ?? null,
    shortStrike: o.shortStrike ?? null,
    maxRisk: round(risk),
    maxAllowedRisk: maxPremiumRisk,
    maxProfit: o.maxProfit == null ? null : round(o.maxProfit),
    breakeven: o.breakeven == null ? null : round(o.breakeven),
    probabilityModel: o.probProfit == null ? null : round(o.probProfit),
    verifyLiveQuote: true,
    exitPolicy: {
      closeIfUnderlyingBreaks: round(p.stop),
      premiumStopLossPct: POLICY.optionStopLossPct,
      firstProfitPct: POLICY.optionTakeProfit1Pct,
      firstProfitAction: 'Take partial profit when practical; if one contract only, agent may hold for target 2 only when thesis and liquidity remain strong.',
      secondProfitPct: POLICY.optionTakeProfit2Pct,
      secondProfitAction: 'Close the remaining position.'
    }
  };
}

function moneyText(n) { return `$${round(n)}`; }

function buildBudgetPlan(data, budget) {
  if (data?.error || !data?.featured) return {budget, overallAction:'DO_NOT_TRADE', reason:data?.error || 'No usable Teststock scan is available.', stockOrders:[], optionOrder:null};
  const fresh = freshness(data);
  const conf = confidence(data);
  const stocks = sizeStockOrders(data, budget, fresh);
  const readyStocks = stocks.filter(x => x.autoExecutionEligible);
  const readyAllocation = round(readyStocks.reduce((s,x)=>s+Number(x.allocationDollars||0),0));
  const readyStopRisk = round(readyStocks.reduce((s,x)=>s+Number(x.estimatedLossAtStop||0),0));
  const option = optionOrder(data, budget, fresh, conf);
  let overallAction = 'DO_NOT_TRADE';
  let reason = 'No qualified setup.';
  if (fresh.stale) { overallAction = 'DO_NOT_TRADE'; reason = 'Signal is stale. Wait for a fresh Teststock scan.'; }
  else if (!fresh.marketOpen) { overallAction = 'WAIT_FOR_MARKET_OPEN'; reason = 'Market is closed. Re-read Teststock after the market opens.'; }
  else if (option?.action === 'READY_TO_AUTO_EXECUTE') { overallAction = 'AUTO_OPTION_ALLOWED'; reason = 'An elite defined-risk option passed every autopilot gate. Live Robinhood checks still control execution.'; }
  else if (readyStocks.length) { overallAction = 'AUTO_STOCK_ALLOWED'; reason = 'One or more stock allocations passed the growth-autopilot entry and risk gates.'; }
  else if (stocks.length) { overallAction = 'WAIT_FOR_TRIGGER'; reason = 'Qualified ideas exist, but none is at a valid entry yet.'; }
  else if (data.action === 'WATCH') { overallAction = 'WATCH'; reason = 'Setup is promising but has not passed all Teststock gates.'; }
  const expiresAt = data?.asOf ? new Date(new Date(data.asOf).getTime() + (fresh.marketOpen ? 60 : 2160) * 60000).toISOString() : null;
  return {
    budget,
    mode: POLICY.name,
    overallAction,
    reason,
    confidence: conf,
    signalAsOf: data.asOf || null,
    expiresAt,
    market: data.market || data.session?.label || null,
    marketRegime: data.regime?.label || null,
    dataQuality: data.dataQuality || null,
    maxStockPortfolioStopRiskDollars: round(budget * POLICY.maxStockPortfolioStopRiskPct / 100),
    maxOptionPremiumRiskDollars: round(budget * POLICY.maxOptionPremiumRiskPct / 100),
    readyAllocationDollars: readyAllocation,
    keepCashDollars: round(Math.max(0, budget - readyAllocation)),
    estimatedLossIfAllReadyStopsHit: readyStopRisk,
    stockOrders: stocks,
    optionOrder: option
  };
}

const plans = [];
for (const budget of budgets) {
  try { plans.push(buildBudgetPlan(await readJson(path.join(dataDir, `latest-${budget}.json`)), budget)); }
  catch (error) { plans.push({budget, overallAction:'DO_NOT_TRADE', reason:`Latest $${budget} scan is unavailable: ${error.message}`, stockOrders:[], optionOrder:null}); }
}

const signal = {
  schemaVersion: 3,
  source: 'Teststock',
  purpose: 'Machine-readable guarded growth-autopilot plan for an AI agent using Robinhood Agentic Trading.',
  generatedAt: new Date().toISOString(),
  defaultBudget: 50,
  policy: POLICY,
  executionPermission: {
    requestedByUser: true,
    autoExecuteWithinPolicy: true,
    requiresPerOrderApproval: false,
    scope: 'Dedicated Robinhood Agentic account only',
    note: 'This file cannot itself place trades. The connected agent must enforce every live-data and risk gate before using Robinhood trading tools.'
  },
  preTradeChecks: [
    'Confirm the Robinhood Agentic account is the dedicated account intended for this strategy.',
    'Confirm market is open and this signal has not expired.',
    'Refresh Robinhood live quote/bid/ask and reject material disagreement with Teststock.',
    'Confirm buying power and existing open risk before any order.',
    `Stop opening new trades if intraday account drawdown reaches ${POLICY.maxDailyDrawdownPct}% or rolling 30-day drawdown reaches ${POLICY.maxRolling30DayDrawdownPct}%.`,
    'Do not use margin, do not average down, do not move stops farther away, and do not add money automatically.',
    'If any required field is missing or contradictory, stay in cash.'
  ],
  executionRules: [
    'AUTO_STOCK_ALLOWED permits automatic stock execution only for stockOrders with autoExecutionEligible=true and only up to allocationDollars.',
    'AUTO_OPTION_ALLOWED permits automatic option execution only when optionOrder.eliteQualified=true and action=READY_TO_AUTO_EXECUTE.',
    'Options must remain defined-risk. Never open naked or undefined-risk option positions.',
    'Prefer a limit order at a reasonable live price. Cancel rather than chase outside the permitted entry range.',
    'Unused budget stays cash. Never substitute a weaker trade just to stay invested.'
  ],
  positionManagementRules: [
    'Continuously inspect Agentic-account positions and open orders during market hours when the agent is running.',
    'For stocks: exit the remaining position if the saved stop/invalidation is broken; at target1 take the configured partial profit; at target2 close the remainder.',
    'After target1, a stop may only move upward/tighter, never farther away from the market.',
    'For options: close if the underlying invalidates, if the defined premium-loss rule is reached, or when profit targets are reached.',
    'Do not turn a losing trade into a larger trade.'
  ],
  plans
};

await fs.writeFile(path.join(outDir, 'signal.json'), JSON.stringify(signal, null, 2));
await fs.writeFile(path.join(dataDir, 'claude-signal.json'), JSON.stringify(signal, null, 2));
console.log('Generated Teststock guarded growth-autopilot signal schema v3');
