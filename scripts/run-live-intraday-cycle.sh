#!/usr/bin/env bash
set -euo pipefail

# One fast local decision cycle for the persistent self-hosted Teststock runner.
# This script does not push generated files. GitHub's normal monitor remains the
# durable publication/audit path; this cycle exists to reduce live reaction time.

: "${ALPACA_API_KEY:?ALPACA_API_KEY is required}"
: "${ALPACA_API_SECRET:?ALPACA_API_SECRET is required}"

# Discover today's liquid/active opportunity set, catalysts, liquidity state,
# shadow-strategy evidence, rejected opportunities and portfolio/circuit context.
node scripts/build-daytrader-intelligence.mjs
node scripts/validate-daytrader-intelligence.mjs

node scripts/update-trigger-board.mjs
node scripts/enforce-day-trader-trigger-policy.mjs
node scripts/apply-intraday-edge-overlay.mjs
node scripts/rebuild-trigger-competition.mjs
node scripts/validate-intraday-edge-overlay.mjs
node scripts/validate-trigger-board.mjs
node scripts/build-execution-dispatch.mjs
node scripts/validate-execution-dispatch.mjs

should_run=$(python - <<'PY'
import json
try:
    with open('docs/data/execution-dispatch.json', 'r', encoding='utf-8') as f:
        d=json.load(f)
    with open('docs/data/execution-watchlist.json', 'r', encoding='utf-8') as f:
        w=json.load(f)
    with open('docs/data/daytrader-intelligence.json', 'r', encoding='utf-8') as f:
        i=json.load(f)
    active=any(isinstance(p,dict) and p.get('status')=='ACTIVE' for p in (w.get('positions') or []))
    breaker=(i.get('circuitBreaker') or {}).get('state')
    # A STOP_NEW_RISK breaker never suppresses management/exits; it simply gives
    # Claude context to refuse fresh entries.
    print('true' if d.get('claudeShouldRun') or active else 'false')
except Exception:
    # Fail open to Claude; Claude itself remains fail-closed before new risk.
    print('true')
PY
)

if [[ "$should_run" != "true" ]]; then
  echo "FAST_CYCLE_NO_ACTION"
  exit 0
fi

output_path="$(mktemp /tmp/teststock-fast-executor.XXXXXX.json)"
trap 'rm -f "$output_path"' EXIT

claude -p "$(cat scripts/claude-executor-prompt.md)" \
  --mcp-config .mcp.json \
  --allowedTools "Read,Glob,Grep,mcp__robinhood-trading" \
  --max-turns 16 \
  --output-format json \
  > "$output_path"

python - "$output_path" <<'PY'
import json,sys
p=sys.argv[1]
with open(p,'r',encoding='utf-8') as f:
    data=json.load(f)
result=data.get('result') if isinstance(data,dict) else None
print('FAST_CYCLE_CLAUDE_COMPLETED')
if isinstance(result,str):
    print(result[:1000])
PY
