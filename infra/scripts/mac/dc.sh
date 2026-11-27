#!/usr/bin/env bash
# docker compose for the Mac mini interim environment.
# Pins the project name and reads the repository-root .env, so build args
# (dashboard NEXT_PUBLIC_*) and runtime variables come from the same file.
#   infra/scripts/mac/dc.sh ps
#   infra/scripts/mac/dc.sh logs -f api
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
exec docker compose -p parallly \
  -f "$ROOT/infra/docker/docker-compose.mac.yml" \
  --env-file "$ROOT/.env" \
  "$@"
