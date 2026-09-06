#!/usr/bin/env bash
set -euo pipefail

# One fast local decision cycle for the persistent self-hosted Teststock runner.
# This script does not push generated files. GitHub's normal monitor remains the
# durable publication/audit path; this cycle exists to reduce live reaction time.

: "${ALPACA_API_KEY:?ALPACA_API_KEY is required}"
: "${ALPACA_API_SECRET:?ALPACA_API_SECRET is required}"

# Preserve executor dispatch fingerprints outside the git worktree so the hourly
# runner's `git reset --hard origin/main` cannot erase local duplicate-prevention
# state between 45-second cycles or between successive long-lived sessions.
RUNTIME_STATE_DIR="${TESTSTOCK_RUNTIME_STATE_DIR:-$HOME/.teststock-runtime}"
RUNTIME_DISPATCH_STATE="$RUNTIME_STATE_DIR/execution-dispatch.json"
mkdir -p "$RUNTIME_STATE_DIR"
if [[ -f "$RUNTIME_DISPATCH_STATE" ]]; then
  cp "$RUNTIME_DISPATCH_STATE" docs/data/execution-dispatch.json
fi

node scripts/build-daytrader-intelligence.mjs
node scripts/validate-daytrader-intelligence.mjs
node scripts/build-trade-quality-engine.mjs
node scripts/apply-model-drift.mjs
node scripts/validate-trade-quality-engine.mjs

node scripts/update-trigger-board.mjs
node scripts/enforce-day-trader-trigger-policy.mjs
node scripts/apply-intraday-edge-overlay.mjs
node scripts/rebuild-intraday-trigger-state.mjs
node scripts/validate-intraday-edge-overlay.mjs
node scripts/validate-trigger-board.mjs
node scripts/build-execution-dispatch.mjs
node scripts/validate-execution-dispatch.mjs
cp docs/data/execution-dispatch.json "$RUNTIME_DISPATCH_STATE"
node scripts/build-live-trading-health.mjs

should_run=$(python - <<'PY'
import json
from datetime import datetime, timezone

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

# Normal crypto must be able to wake Claude even when there is no simultaneous
# stock dispatch. Keep this fail-closed: only a fresh qualified champion whose
# profitability-admission state permits live risk can wake the executor.
crypto_admitted=a.get('state') in {'MICRO_PROBATION','PROBATION','LIVE_ADMITTED'} and float(a.get('sizeMultiplier') or 0)>0
crypto_fresh=age_minutes(t.get('generatedAt')) <= 15
crypto_candidate=isinstance(t.get('qualifiedChampion'), dict) and bool(t.get('qualifiedChampion',{}).get('ticker'))
crypto_should_run=crypto_admitted and crypto_fresh and crypto_candidate

print('true' if d.get('claudeShouldRun') or active or crypto_should_run else 'false')
PY
)

if [[ "$should_run" != "true" ]]; then echo "FAST_CYCLE_NO_ACTION"; exit 0; fi
output_path="$(mktemp /tmp/teststock-fast-executor.XXXXXX.json)"
trap 'rm -f "$output_path"' EXIT
claude -p "$(cat scripts/claude-executor-prompt.md scripts/claude-trade-quality-rules.md)" \
  --mcp-config .mcp.json \
  --allowedTools "Read,Glob,Grep,mcp__robinhood-trading" \
  --max-turns 16 \
  --output-format json > "$output_path"
python - "$output_path" <<'PY'
import json,sys
with open(sys.argv[1],'r',encoding='utf-8') as f:data=json.load(f)
result=data.get('result') if isinstance(data,dict) else None
print('FAST_CYCLE_CLAUDE_COMPLETED')
if isinstance(result,str):print(result[:1000])
PY
