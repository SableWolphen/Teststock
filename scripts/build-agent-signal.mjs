import fs from 'node:fs/promises';
import path from 'node:path';

const budgets = [50, 100, 200, 500];
const outDir = path.resolve('docs');
const dataDir = path.join(outDir, 'data');

const round = (n, d = 2) => Number(Number(n || 0).toFixed(d));
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

function stockExecutionState(data) {
  const p = data.featured || {};
  const beginner = data.beginnerDecision || {};
  const price = Number(p.price || 0);
  const trigger = Number(p.entry || beginner.buyTrigger || 0);
  const stop = Number(p.stop || beginner.invalidation || 0);
  const stockQualified = Boolean(
    data.action === 'TRADE CANDIDATE' &&
    p.direction === 'BULLISH' &&
    beginner.stockQualified !== false &&
    trigger > 0 && stop > 0
  );

  if (!stockQualified) {
    return {
      action: data.action === 'WATCH' ? 'WATCH' : 'DO_NOT_BUY',
      reason: data.action === 'WATCH'
        ? 'Setup is promising but has not passed all Teststock gates.'
        : 'Teststock does not currently have a qualified stock buy.'
    };
  }

  if (price < trigger) {
    return {
      action: 'WAIT_FOR_TRIGGER',
      reason: `Do not buy until the live Robinhood price reaches at least $${round(trigger)}.`
    };
  }

  if (price > trigger * 1.015) {
    return {
      action: 'DO_NOT_CHASE',
      reason: `Price is more than 1.5% above the planned trigger. Wait for a new Teststock scan.`
    };
  }

  return {
    action: 'READY_TO_REVIEW',
    reason: 'The Teststock stock setup is qualified and near its planned entry. Robinhood must still verify the live quote before an order is shown.'
  };
}

function planFrom(data, budget) {
  if (data?.error || !data?.featured) {
    return {
      budget,
      action: 'DO_NOT_BUY',
      reason: data?.error || 'No usable Teststock scan is available.',
      generatedAt: data?.generatedAt || null
    };
  }

  const p = data.featured;
  const state = stockExecutionState(data);
  const entry = Number(p.entry || 0);
  const stop = Number(p.stop || 0);
  const riskPct = entry > 0 && stop > 0 ? Math.max(0, (entry - stop) / entry) : null;
  const fullBudgetStopLoss = riskPct == null ? null : round(budget * riskPct);

  return {
    budget,
    action: state.action,
    reason: state.reason,
    ticker: p.symbol || null,
    direction: p.direction || null,
    scanAction: data.action || null,
    setup: p.setup || null,
    scanPrice: round(p.price),
    buyTrigger: round(p.entry),
    stop: round(p.stop),
    target1: round(p.target1),
    target2: round(p.target2),
    fullBudgetDollars: budget,
    estimatedLossAtStopIfFullBudgetUsed: fullBudgetStopLoss,
    setupScore: p.score ?? null,
    learningScore: p.learningScore ?? data.learning?.score ?? null,
    historicalWinRate: data.learning?.calibration?.winRate ?? p.validation?.winRate ?? null,
    historicalSamples: data.learning?.calibration?.samples ?? p.validation?.samples ?? null,
    marketRegime: data.regime?.label || null,
    sectorCheck: data.learning?.sector?.label || null,
    intradayCheck: data.learning?.intraday?.label || null,
    asOf: data.asOf || null,
    market: data.market || null,
    dataQuality: data.dataQuality || null
  };
}

const plans = [];
for (const budget of budgets) {
  try {
    const data = await readJson(path.join(dataDir, `latest-${budget}.json`));
    plans.push(planFrom(data, budget));
  } catch (error) {
    plans.push({budget, action: 'DO_NOT_BUY', reason: `Latest $${budget} scan is unavailable: ${error.message}`});
  }
}

const signal = {
  schemaVersion: 1,
  source: 'Teststock',
  purpose: 'Machine-readable decision handoff for an AI agent such as Claude using Robinhood Agentic Trading.',
  generatedAt: new Date().toISOString(),
  defaultBudget: 50,
  requiresUserApproval: true,
  autoExecute: false,
  agentRules: [
    'Never place an order solely because this file says READY_TO_REVIEW.',
    'Before any order, verify the current Robinhood quote, buying power, and that the signal is fresh.',
    'During an open market, reject signals older than 90 minutes.',
    'Ask the user for explicit approval before every buy or sell order.',
    'Do not buy below the trigger, do not chase more than 1.5% above the trigger, and do not increase the selected budget.',
    'If any field is missing, stale, contradictory, or Robinhood data disagrees materially, do not trade and ask for a fresh Teststock scan.',
    'This is decision support, not a guarantee of profit.'
  ],
  plans
};

await fs.writeFile(path.join(outDir, 'signal.json'), JSON.stringify(signal, null, 2));
await fs.writeFile(path.join(dataDir, 'claude-signal.json'), JSON.stringify(signal, null, 2));
console.log('Generated docs/signal.json and docs/data/claude-signal.json');
