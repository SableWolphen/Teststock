#!/usr/bin/env bash
set -euo pipefail

# One fast local decision cycle for the persistent self-hosted Teststock runner.
# This script does not push generated files. GitHub's normal monitor remains the
# durable publication/audit path; this cycle exists to reduce live reaction time.
# Session profit discipline (open drive / midday / power hour) is defined in
# scripts/daytrader-profit-discipline.md and enforced by the day-trader engine.

: "${ALPACA_API_KEY:?ALPACA_API_KEY is required}"
: "${ALPACA_API_SECRET:?ALPACA_API_SECRET is required}"

RUNTIME_STATE_DIR="${TESTSTOCK_RUNTIME_STATE_DIR:-$HOME/.teststock-runtime}"
RUNTIME_DISPATCH_STATE="$RUNTIME_STATE_DIR/execution-dispatch.json"
LEARNING_INPUT_DIR="$RUNTIME_STATE_DIR/learning-input"
LEARNING_OUTPUT_DIR="$RUNTIME_STATE_DIR/learning-output"
mkdir -p "$RUNTIME_STATE_DIR" "$LEARNING_INPUT_DIR" "$LEARNING_OUTPUT_DIR"
if [[ -f "$RUNTIME_DISPATCH_STATE" ]]; then
  cp "$RUNTIME_DISPATCH_STATE" docs/data/execution-dispatch.json
fi

# Feed immutable snapshots to the separate background learner. It writes only to
# runtime state, never to this live checkout, so learning cannot race broker logic.
for f in real-trade-journal.json; do
  if [[ -f "docs/data/$f" ]]; then
    cp "docs/data/$f" "$LEARNING_INPUT_DIR/$f.tmp"
    mv -f "$LEARNING_INPUT_DIR/$f.tmp" "$LEARNING_INPUT_DIR/$f"
  fi
done

# Consume the latest background scorecard when reasonably fresh. On cold start or
# stale learner output, build once synchronously as a safe fallback; normal cycles
# then return to non-blocking background learning.
learning_scorecard="$LEARNING_OUTPUT_DIR/real-fill-scorecard.json"
use_background=false
if [[ -f "$learning_scorecard" ]]; then
  use_background=$(python - "$learning_scorecard" <<'PY'
import json,sys
from datetime import datetime,timezone
try:
    d=json.load(open(sys.argv[1],encoding='utf-8'))
    t=datetime.fromisoformat(str(d.get('generatedAt','')).replace('Z','+00:00'))
    age=(datetime.now(timezone.utc)-t.astimezone(timezone.utc)).total_seconds()/60
    print('true' if 0 <= age <= 15 else 'false')
except Exception:
    print('false')
PY
)
fi
if [[ "$use_background" == "true" ]]; then
  cp "$learning_scorecard" docs/data/real-fill-scorecard.json
  echo "BACKGROUND_LEARNING_SCORECARD_CONSUMED"
else
  node scripts/build-real-fill-scorecard.mjs
  cp docs/data/real-fill-scorecard.json "$learning_scorecard.tmp"
  mv -f "$learning_scorecard.tmp" "$learning_scorecard"
  echo "BACKGROUND_LEARNING_COLD_START_FALLBACK"
fi

node scripts/build-daytrader-intelligence.mjs
node scripts/validate-daytrader-intelligence.mjs
node scripts/update-trigger-board.mjs
node scripts/build-trade-quality-engine.mjs
node scripts/apply-model-drift.mjs
node scripts/validate-trade-quality-engine.mjs

node scripts/enforce-day-trader-trigger-policy.mjs
node scripts/apply-intraday-edge-overlay.mjs
node scripts/rebuild-intraday-trigger-state.mjs
node scripts/validate-intraday-edge-overlay.mjs
node scripts/validate-trigger-board.mjs
node scripts/build-execution-dispatch.mjs
node scripts/validate-execution-dispatch.mjs
cp docs/data/execution-dispatch.json "$RUNTIME_DISPATCH_STATE"
node scripts/build-live-trading-health.mjs

# OpenAI executor handoff. PAPER is the repository default and never writes to
# Robinhood. Live mode is separately fail-closed inside chatgpt-executor.mjs and
# requires the user's explicit runtime sentinel plus authenticated Robinhood MCP.
execution_mode="${TESTSTOCK_EXECUTION_MODE:-paper}"
if jq -e '.chatgptShouldRun == true or .executionNeeded == true' docs/data/execution-dispatch.json >/dev/null 2>&1; then
  diagnostics_dir="$RUNTIME_STATE_DIR/executor-diagnostics"
  mkdir -p "$diagnostics_dir"
  run_dir="$(mktemp -d "$diagnostics_dir/cycle.XXXXXX")"
  executor_status=0
  TESTSTOCK_EXECUTION_MODE="$execution_mode" node scripts/chatgpt-executor.mjs > "$run_dir/stdout.json" 2> "$run_dir/stderr.txt" || executor_status=$?
  if ! python scripts/record-executor-result.py "$run_dir" "$executor_status"; then
    echo "::warning::OpenAI executor did not complete. Any live claim is retained and must be reconciled before another submission."
    return "$executor_status" 2>/dev/null || exit "$executor_status"
  fi
  echo "FAST_CYCLE_OPENAI_EXECUTOR mode=$execution_mode"
else
  echo "FAST_CYCLE_NO_ACTION"
fi
