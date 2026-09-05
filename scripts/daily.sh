#!/usr/bin/env bash
#
# What launchd actually runs every morning (see launchd/com.denis.agentco.daily.plist).
# launchd gives its jobs a minimal PATH, so this sets one explicitly before
# doing anything else: node lives at /opt/homebrew/bin/node and the `claude`
# CLI the worker spawns lives at /Users/denisgolosin/.local/bin/claude —
# without both on PATH the worker fails with "could not spawn claude".
set -euo pipefail

export PATH="/opt/homebrew/bin:/Users/denisgolosin/.local/bin:$PATH"

REPO_DIR="/Users/denisgolosin/Desktop/agentco"
LOG_FILE="$REPO_DIR/logs/daily.log"

cd "$REPO_DIR"

{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') ====="
  npm run schedule
  npm run worker
  echo "----- done -----"
} >>"$LOG_FILE" 2>&1
