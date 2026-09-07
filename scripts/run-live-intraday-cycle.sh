#!/usr/bin/env bash
set -euo pipefail

# One fast local decision cycle for the persistent self-hosted Teststock runner.
# This script does not push generated files. GitHub's normal monitor remains the
# durable publication/audit path; this cycle exists to reduce live reaction time.

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
for f in real-trade-journal.json crypto-real-trade-journal.json; do
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

should_run=$(python - "$RUNTIME_STATE_DIR" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, 'scripts')
from executor_usage_gate import reserve_wake

def load(path, default):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default

def age_minutes(value):
    try:
        dt=datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return max(0.0,(datetime.now(timezone.utc)-dt.astimezone(timezone.utc)).total_seconds()/60.0)
    except Exception:
        return float('inf')

d=load('docs/data/execution-dispatch.json', {})
w=load('docs/data/execution-watchlist.json', {})
t=load('docs/data/crypto-tournament.json', {})
a=load('docs/data/crypto-profitability-admission.json', {})
active=any(isinstance(p,dict) and p.get('status')=='ACTIVE' for p in (w.get('positions') or []))
crypto_admitted=a.get('state') in {'MICRO_PROBATION','PROBATION','LIVE_ADMITTED'} and float(a.get('sizeMultiplier') or 0)>0
crypto_fresh=age_minutes(t.get('generatedAt')) <= 15
crypto_candidate=isinstance(t.get('qualifiedChampion'), dict) and bool(t.get('qualifiedChampion',{}).get('ticker'))
crypto_should_run=crypto_admitted and crypto_fresh and crypto_candidate
pending=d.get('pendingAction') if isinstance(d.get('pendingAction'), dict) else {}
trigger=pending.get('trigger')
urgent_exit=trigger in {'TRIGGER_1_STOP','STOCK_DAY_TRADE_FORCED_EXIT'}
actionable=bool(d.get('claudeShouldRun'))
routine=active or crypto_should_run
allowed=reserve_wake(Path(sys.argv[1])/'executor-usage.json',actionable=actionable,routine=routine,urgent_exit=urgent_exit)
print('true' if allowed else 'false')
PY
)

if [[ "$should_run" != "true" ]]; then echo "FAST_CYCLE_NO_ACTION"; exit 0; fi
umask 077
mkdir -p "$RUNTIME_STATE_DIR/executor-diagnostics"
diagnostic_dir="$(mktemp -d "$RUNTIME_STATE_DIR/executor-diagnostics/attempt.XXXXXX")"
output_path="$diagnostic_dir/stdout.json"
executor_status=0
claude -p "$(cat scripts/claude-executor-prompt.md scripts/claude-trade-quality-rules.md scripts/claude-stock-rotation-rules.md scripts/daytrader-profit-discipline.md)" \
  --mcp-config .mcp.json \
  --allowedTools "Read,Glob,Grep,mcp__robinhood-trading" \
  --max-turns 16 \
  --output-format json > "$output_path" 2> "$diagnostic_dir/stderr.txt" || executor_status=$?
python scripts/record-executor-result.py "$diagnostic_dir" "$executor_status"
