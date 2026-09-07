#!/usr/bin/env bash
set -euo pipefail

RUNTIME_STATE_DIR="${TESTSTOCK_RUNTIME_STATE_DIR:-$HOME/.teststock-runtime}"
INPUT_DIR="$RUNTIME_STATE_DIR/learning-input"
OUTPUT_DIR="$RUNTIME_STATE_DIR/learning-output"
mkdir -p "$INPUT_DIR" "$OUTPUT_DIR"

interval="${TESTSTOCK_LEARNING_INTERVAL_SECONDS:-300}"
case "$interval" in (*[!0-9]*|'') interval=300;; esac
if [ "$interval" -lt 60 ]; then interval=60; fi

while true; do
  stock="$INPUT_DIR/real-trade-journal.json"
  crypto="$INPUT_DIR/crypto-real-trade-journal.json"
  if [[ -f "$stock" && -f "$crypto" ]]; then
    tmp="$OUTPUT_DIR/real-fill-scorecard.json.tmp"
    if node scripts/build-real-fill-scorecard.mjs "$stock" "$crypto" "$tmp"; then
      mv -f "$tmp" "$OUTPUT_DIR/real-fill-scorecard.json"
      date -u +%FT%TZ > "$OUTPUT_DIR/last-success.txt"
      echo "BACKGROUND_LEARNING_REFRESHED $(cat "$OUTPUT_DIR/last-success.txt")"
    else
      rm -f "$tmp"
      echo "BACKGROUND_LEARNING_FAILED; live execution continues with last known safe scorecard/fallback" >&2
    fi
  else
    echo "BACKGROUND_LEARNING_WAITING_FOR_INPUT"
  fi
  sleep "$interval"
done
