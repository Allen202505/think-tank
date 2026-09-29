#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/think-tank}"
cd "$DEPLOY_PATH"

if [[ ! -f .env.production ]]; then
  echo "Missing $DEPLOY_PATH/.env.production" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.production
set +a

curl -fsS --max-time 600 \
  -H "Authorization: Bearer ${CRON_SECRET:-}" \
  http://127.0.0.1:3000/api/cron/master-league-daily >/dev/null
