// Account-relative hard risk gate for every live Teststock entry and exit.
//
// Why this exists: the older policies sized options as "whatever fits in buying
// power" (LIVE_UNLEVERAGED_CASH, no premium cap) and the scanner admitted 0-1 DTE
// contracts. On a small account that let a single cheap, nearly-expired option
// consume most of the account, and a fixed $80 daily-loss cap never fired because
// it was larger than the account itself. Every limit here scales with the account.
//
// This gate can only BLOCK or SHRINK a trade. It never creates eligibility and
// never loosens any other Teststock gate. Missing or invalid inputs fail closed.
//
// CLI (for the execution agent, run before every live order):
//   node scripts/account-risk-gate.mjs entry '<json>'
//   node scripts/account-risk-gate.mjs exit  '<json>'
// Prints the decision as JSON; exit code 0 = allowed, 2 = blocked.

export const DEFAULT_LIMITS = Object.freeze({
  // Sizing: an option premium is 100% at risk, so it is capped as a slice of the account.
  maxOptionPremiumPctOfAccount: 15,
  maxStockPositionPctOfAccount: 25,
  maxStockRiskPctOfAccount: 2, // (entry - stop) * shares as a % of account
  maxTotalOpenRiskPctOfAccount: 30, // all open option premium + stock stop risk
  // Contract quality: no lottery tickets, no nearly-expired contracts.
  minOptionDte: 7,
  maxOptionDte: 60,
  minOptionAsk: 0.2,
  maxOptionSpreadPctOfMid: 10,
  minOptionOpenInterest: 100,
  minOptionVolume: 25,
  // Day-level brakes.
  maxDailyLossPctOfDayStart: 5,
  maxDrawdownPctFromPeak: 25,
  maxNewEntriesPerDay: 2,
  maxLosingExitsPerDay: 2,
  allowSameDayReentrySameUnderlying: false,
  // Session timing (New York minutes since midnight).
  noEntriesBeforeNyMinute: 9 * 60 + 45, // skip the first 15 minutes after the open
  noEntriesAfterNyMinute: 15 * 60 + 15,
});

const num = x => typeof x === 'number' && Number.isFinite(x);
const pos = x => num(x) && x > 0;
const nonneg = x => num(x) && x >= 0;
const round2 = x => Math.round(x * 100) / 100;

export function nyMinuteOfDay(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const get = t => Number(parts.find(p => p.type === t)?.value);
  return get('hour') * 60 + get('minute');
}

export function nyDate(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

export function daysToExpiration(expirationDate, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expirationDate || ''))) return NaN;
  const today = Date.parse(`${nyDate(now)}T00:00:00Z`);
  return Math.round((Date.parse(`${expirationDate}T00:00:00Z`) - today) / 86400000);
}

// Day-level brakes shared by every entry. `account` values are in dollars.
export function evaluateAccountBrakes(account = {}, limits = DEFAULT_LIMITS, now = Date.now()) {
  const reasons = [];
  const { accountValue, dayStartValue, peakValue, entriesToday = 0, losingExitsToday = 0 } = account;
  if (!pos(accountValue) || !pos(dayStartValue) || !pos(peakValue)) {
    return { allowed: false, reasons: ['ACCOUNT_VALUES_UNVERIFIED'], dayLossPct: null, drawdownPct: null };
  }
  const dayLossPct = Math.max(0, (dayStartValue - accountValue) / dayStartValue * 100);
  const drawdownPct = Math.max(0, (Math.max(peakValue, accountValue) - accountValue) / Math.max(peakValue, accountValue) * 100);
  if (dayLossPct >= limits.maxDailyLossPctOfDayStart) reasons.push('DAILY_LOSS_LIMIT');
  if (drawdownPct >= limits.maxDrawdownPctFromPeak) reasons.push('DRAWDOWN_LIMIT');
  if (!nonneg(entriesToday) || entriesToday >= limits.maxNewEntriesPerDay) reasons.push('DAILY_ENTRY_LIMIT');
  if (!nonneg(losingExitsToday) || losingExitsToday >= limits.maxLosingExitsPerDay) reasons.push('LOSING_STREAK_PAUSE');
  const minute = nyMinuteOfDay(now);
  if (minute < limits.noEntriesBeforeNyMinute || minute > limits.noEntriesAfterNyMinute) reasons.push('OUTSIDE_ENTRY_WINDOW');
  return { allowed: reasons.length === 0, reasons, dayLossPct: round2(dayLossPct), drawdownPct: round2(drawdownPct) };
}

function openRiskCheck(account, addedRisk, limits, reasons) {
  const openRisk = nonneg(account.openRisk) ? account.openRisk : NaN;
  if (!num(openRisk)) { reasons.push('OPEN_RISK_UNVERIFIED'); return; }
  if ((openRisk + addedRisk) / account.accountValue * 100 > limits.maxTotalOpenRiskPctOfAccount) reasons.push('TOTAL_OPEN_RISK_LIMIT');
}

function reentryCheck(account, underlying, limits, reasons) {
  const traded = Array.isArray(account.underlyingsTradedToday) ? account.underlyingsTradedToday.map(s => String(s).toUpperCase()) : null;
  if (!traded) { reasons.push('TODAY_TRADES_UNVERIFIED'); return; }
  if (!limits.allowSameDayReentrySameUnderlying && traded.includes(String(underlying || '').toUpperCase())) reasons.push('SAME_DAY_REENTRY');
}

// Long call / long put buy-to-open. Returns the maximum whole contracts allowed (0 = blocked).
export function evaluateOptionEntry({ account = {}, contract = {}, limits: overrides = {}, now = Date.now() } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const brakes = evaluateAccountBrakes(account, limits, now);
  const reasons = [...brakes.reasons];
  const { underlying, kind, bid, ask, expirationDate, openInterest, volume } = contract;
  if (!['LONG_CALL', 'LONG_PUT'].includes(kind)) reasons.push('ONLY_LONG_CALL_OR_PUT');
  if (!pos(ask) || !nonneg(bid) || bid > ask) reasons.push('QUOTE_UNVERIFIED');
  const dte = daysToExpiration(expirationDate, now);
  if (!num(dte)) reasons.push('EXPIRATION_UNVERIFIED');
  else if (dte < limits.minOptionDte) reasons.push('EXPIRES_TOO_SOON');
  else if (dte > limits.maxOptionDte) reasons.push('EXPIRES_TOO_FAR');
  if (pos(ask) && ask < limits.minOptionAsk) reasons.push('LOTTERY_PREMIUM');
  const mid = pos(ask) && nonneg(bid) ? (bid + ask) / 2 : NaN;
  const spreadPct = pos(mid) ? (ask - bid) / mid * 100 : NaN;
  if (!num(spreadPct) || bid === 0 || spreadPct > limits.maxOptionSpreadPctOfMid) reasons.push('SPREAD_TOO_WIDE');
  if (!nonneg(openInterest) || openInterest < limits.minOptionOpenInterest) reasons.push('LOW_OPEN_INTEREST');
  if (!nonneg(volume) || volume < limits.minOptionVolume) reasons.push('LOW_VOLUME');
  reentryCheck(account, underlying, limits, reasons);

  const premiumPerContract = pos(ask) ? ask * 100 : NaN;
  const budget = pos(account.accountValue) ? account.accountValue * limits.maxOptionPremiumPctOfAccount / 100 : 0;
  const cash = nonneg(account.cash) ? account.cash : 0;
  let maxContracts = num(premiumPerContract) ? Math.floor(Math.min(budget, cash) / premiumPerContract) : 0;
  if (num(premiumPerContract) && maxContracts < 1) reasons.push(premiumPerContract > cash ? 'INSUFFICIENT_CASH' : 'CONTRACT_TOO_LARGE_FOR_ACCOUNT');
  if (maxContracts >= 1) {
    openRiskCheck(account, premiumPerContract, limits, reasons);
    if (nonneg(account.openRisk)) {
      const room = account.accountValue * limits.maxTotalOpenRiskPctOfAccount / 100 - account.openRisk;
      maxContracts = Math.min(maxContracts, Math.floor(room / premiumPerContract));
    }
  }

  const allowed = reasons.length === 0;
  return {
    allowed,
    maxContracts: allowed ? maxContracts : 0,
    reasons,
    detail: { dte, spreadPct: num(spreadPct) ? round2(spreadPct) : null, premiumPerContract: num(premiumPerContract) ? round2(premiumPerContract) : null, premiumBudget: round2(budget), dayLossPct: brakes.dayLossPct, drawdownPct: brakes.drawdownPct },
  };
}

// Long stock buy. Requires a stop price so risk is defined before entry.
export function evaluateStockEntry({ account = {}, order = {}, limits: overrides = {}, now = Date.now() } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const brakes = evaluateAccountBrakes(account, limits, now);
  const reasons = [...brakes.reasons];
  const { symbol, entryPrice, stopPrice } = order;
  if (!pos(entryPrice)) reasons.push('ENTRY_PRICE_UNVERIFIED');
  if (!pos(stopPrice) || !(stopPrice < entryPrice)) reasons.push('STOP_REQUIRED_BELOW_ENTRY');
  reentryCheck(account, symbol, limits, reasons);
  const value = pos(account.accountValue) ? account.accountValue : 0;
  const cash = nonneg(account.cash) ? account.cash : 0;
  const riskPerShare = pos(entryPrice) && pos(stopPrice) ? entryPrice - stopPrice : NaN;
  // Fractional shares are allowed; round down to 4 decimals so caps are never exceeded.
  const floor4 = x => Math.floor(x * 10000) / 10000;
  let shares = 0;
  if (pos(riskPerShare) && pos(entryPrice)) {
    shares = floor4(Math.min(
      value * limits.maxStockRiskPctOfAccount / 100 / riskPerShare,
      value * limits.maxStockPositionPctOfAccount / 100 / entryPrice,
      cash / entryPrice,
    ));
    if (shares <= 0) reasons.push('POSITION_TOO_SMALL');
    else openRiskCheck(account, shares * riskPerShare, limits, reasons);
  }
  const allowed = reasons.length === 0;
  return { allowed, maxShares: allowed ? shares : 0, reasons, detail: { riskPerShare: num(riskPerShare) ? round2(riskPerShare) : null, dayLossPct: brakes.dayLossPct, drawdownPct: brakes.drawdownPct } };
}

// Exit orders. Options must exit with a limit order at or near the bid: market and
// stop-market orders on thin option books fill at whatever the worst bid is.
export function evaluateExitOrder({ assetClass, type, trigger = 'immediate', limitPrice, bid } = {}) {
  const reasons = [];
  if (assetClass === 'option') {
    if (type !== 'limit') reasons.push('OPTION_EXIT_MUST_BE_LIMIT');
    if (trigger === 'stop' && type === 'market') reasons.push('NO_STOP_MARKET_ON_OPTIONS');
    if (type === 'limit' && (!pos(limitPrice) || !nonneg(bid))) reasons.push('EXIT_QUOTE_UNVERIFIED');
  } else if (assetClass !== 'stock') {
    reasons.push('UNKNOWN_ASSET_CLASS');
  }
  return { allowed: reasons.length === 0, reasons };
}

const isMain = import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const [mode, raw] = process.argv.slice(2);
  let input;
  try { input = JSON.parse(raw || '{}'); } catch { input = null; }
  let result;
  if (!input) result = { allowed: false, reasons: ['INPUT_NOT_JSON'] };
  else if (mode === 'entry') result = input.contract ? evaluateOptionEntry(input) : evaluateStockEntry(input);
  else if (mode === 'exit') result = evaluateExitOrder(input);
  else result = { allowed: false, reasons: ['USAGE: entry|exit <json>'] };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.allowed ? 0 : 2;
}
