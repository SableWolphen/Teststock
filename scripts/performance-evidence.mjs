// Missing measurements are unknown, never zero-return observations.
export const measuredNumber = value =>
  (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) &&
  Number.isFinite(Number(value));

export const confirmedStockOutcome = trade =>
  String(trade.assetClass || 'STOCK').toUpperCase() === 'STOCK' &&
  trade.reconciledFromRobinhood === true &&
  ['WIN', 'LOSS', 'FLAT'].includes(String(trade.outcome || '').toUpperCase()) &&
  measuredNumber(trade.realizedR);

// Rejected setups are opportunity-cost diagnostics, not proof of the entry policy.
export const acceptedShadowOutcome = trade =>
  trade.status === 'RESOLVED' && trade.decision === 'ACCEPTED' &&
  measuredNumber(trade.realizedR);
