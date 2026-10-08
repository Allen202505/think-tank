#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/think-tank}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

# 防止 GitHub Actions 与服务器定时拉取同时部署。
exec 9>/tmp/think-tank-deploy.lock
if ! flock -n 9; then
  echo "Another deployment is already running"
  exit 0
fi

cd "$DEPLOY_PATH"

if [[ ! -f .env.production ]]; then
  echo "Missing $DEPLOY_PATH/.env.production" >&2
  exit 1
fi

git fetch origin main
git checkout main
git reset --hard origin/main

set -a
# shellcheck disable=SC1091
source .env.production
set +a

export GIT_COMMIT="$(git rev-parse --short HEAD)"
printf '%s\n' "$GIT_COMMIT" > .deploy-commit
docker compose build --pull
docker compose up -d --remove-orphans

expected_commit="$(git rev-parse --short HEAD)"
for _ in $(seq 1 30); do
  health_body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
  if printf '%s' "$health_body" | grep -Fq "\"commit\":\"$expected_commit\""; then
    cron_line="35 * * * * $DEPLOY_PATH/scripts/run-daily-cron.sh >> $DEPLOY_PATH/cron.log 2>&1"
    auto_line="* * * * * $DEPLOY_PATH/scripts/auto-deploy-tencent.sh >> $DEPLOY_PATH/deploy.log 2>&1"
    {
      crontab -l 2>/dev/null | grep -vF "$DEPLOY_PATH/scripts/run-daily-cron.sh" | grep -vF "$DEPLOY_PATH/scripts/auto-deploy-tencent.sh" || true
      printf '%s\n' "$cron_line"
      printf '%s\n' "$auto_line"
    } | crontab -
    docker compose ps
    echo "Deployment healthy: $HEALTH_URL"
    exit 0
  fi
  sleep 2
done

echo "Deployment health check failed: $HEALTH_URL" >&2
docker compose ps >&2 || true
docker compose logs --tail=120 >&2 || true
exit 1
