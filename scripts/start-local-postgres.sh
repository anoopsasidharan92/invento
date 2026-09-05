#!/usr/bin/env bash
# Start free local PostgreSQL via Docker Compose (no cloud costs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Free local options (no cloud):"
  echo "  1) Docker Desktop (recommended): https://docs.docker.com/desktop/setup/install/mac-install/"
  echo "  2) Homebrew PostgreSQL: brew install postgresql@16 && brew services start postgresql@16"
  echo "     Then: createuser agents --createdb && createdb -O agents agents"
  echo "     And set POSTGRES_URL in .env (see postgres.env.example; adjust password if needed)."
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "Creating $ROOT/.env from postgres.env.example"
  cp "$ROOT/postgres.env.example" "$ROOT/.env"
fi

echo "Starting PostgreSQL (docker compose up -d)..."
docker compose up -d

echo ""
echo "PostgreSQL should be on 127.0.0.1:5432 (database: agents, user: agents)."
echo "POSTGRES_URL is loaded from $ROOT/.env — agents will create tables on first run."
docker compose ps
