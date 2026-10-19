import fs from 'node:fs';
import { SAFETY_POLICY } from './safety-policy.mjs';

// Local, deterministic dry-run harness. NEVER imports brokerage clients or submits orders.
export function evaluatePaperDispatch(dispatch, broker, policy = SAFETY_POLICY) {
  const reasons = [];
  if (policy.liveExecutionEnabled !== false) reasons.push('PAPER_HARNESS_REQUIRES_LIVE_LOCK');
  if (!dispatch || typeof dispatch !== 'object') reasons.push('MISSING_DISPATCH');
  if (!broker || typeof broker !== 'object') reasons.push('MISSING_BROKER_SNAPSHOT');
  if (reasons.length) return { mode: 'PAPER_ONLY', decision: 'NO_ACTION', reasons };
  if (dispatch.manualExecutionOnly !== true) reasons.push('UNEXPECTED_DISPATCH_MODE');
  if (dispatch.executorCapability?.mode !== 'MANUAL_ONLY_FAIL_CLOSED') reasons.push('UNEXPECTED_EXECUTOR_MODE');
  if (dispatch.optionEntryAllowed || dispatch.equityEntryAllowed) reasons.push('UNEXPECTED_ENTRY_AUTHORIZATION');
  if (!Number.isFinite(broker.unleveragedCash) || broker.unleveragedCash < 0) reasons.push('INVALID_CASH');
  if (!Array.isArray(broker.positions) || !Array.isArray(broker.orders)) reasons.push('INCOMPLETE_BROKER_SNAPSHOT');
  if (broker.orders?.some(o => !['filled','cancelled','rejected','open','partially_filled'].includes(o.status))) reasons.push('AMBIGUOUS_ORDER');
  if (broker.positions?.some(p => !p.protectiveOrderVerified)) reasons.push('UNPROTECTED_POSITION');
  return { mode: 'PAPER_ONLY', decision: 'NO_ACTION', reasons: reasons.length ? reasons : ['LIVE_EXECUTION_DISABLED'], positionsReviewed: broker.positions?.length ?? 0, ordersReviewed: broker.orders?.length ?? 0 };
}

if (process.argv[1]?.endsWith('/paper-executor.mjs')) {
  const [dispatchPath, brokerPath] = process.argv.slice(2);
  if (!dispatchPath || !brokerPath) {
    console.error('Usage: node scripts/paper-executor.mjs <dispatch.json> <sanitized-broker-snapshot.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = evaluatePaperDispatch(JSON.parse(fs.readFileSync(dispatchPath,'utf8')), JSON.parse(fs.readFileSync(brokerPath,'utf8')));
      console.log(JSON.stringify(result,null,2));
    } catch (e) {
      console.error(JSON.stringify({mode:'PAPER_ONLY',decision:'NO_ACTION',reasons:['INPUT_READ_FAILED']}));
      process.exitCode = 1;
    }
  }
}
