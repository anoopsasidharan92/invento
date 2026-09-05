#!/usr/bin/env bash
# Expose the local backend (port 8000) over HTTPS so the Vercel-hosted
# frontend can reach it. Prints a https://<random>.trycloudflare.com URL.
#
# Quick tunnels get a NEW URL each run. After starting, set VITE_API_BASE on
# Vercel to the printed URL and redeploy, and add it to backend/.env as
# ALLOWED_ORIGINS is for the frontend origin (not this URL).
set -euo pipefail

PORT="${PORT:-8000}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install with: brew install cloudflared" >&2
  exit 1
fi

if ! curl -sf -o /dev/null "http://localhost:${PORT}/docs" 2>/dev/null; then
  echo "Warning: nothing responding on localhost:${PORT}. Start the backend first." >&2
fi

echo "Starting tunnel to http://localhost:${PORT} ..."
exec cloudflared tunnel --url "http://localhost:${PORT}"
