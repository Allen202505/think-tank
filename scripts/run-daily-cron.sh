#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/think-tank}"

# cron 在不同服务器时区下统一以北京时间判断；每小时 :35 触发，只有 15:35–15:44 才真正执行。
weekday="$(TZ=Asia/Shanghai date +%u)"
hour="$(TZ=Asia/Shanghai date +%H)"
minute="$(TZ=Asia/Shanghai date +%M)"
if [[ "$weekday" -gt 5 || "$hour" != "15" || "$minute" -lt 35 || "$minute" -gt 44 ]]; then
  exit 0
fi

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
