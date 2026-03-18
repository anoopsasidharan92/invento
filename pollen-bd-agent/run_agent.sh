#!/bin/bash
# run_agent.sh — wrapper script for cron to call
# Cron doesn't inherit your shell environment, so we source it here.

set -e
cd "$(dirname "$0")"

# Load env vars (create a .env file with your keys)
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "Running Pollen BD Agent at $(date)"
python3 agent.py
