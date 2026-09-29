#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/think-tank}"
cd "$DEPLOY_PATH"

git fetch origin main

local_rev="$(git rev-parse HEAD)"
remote_rev="$(git rev-parse origin/main)"

if [[ "$local_rev" == "$remote_rev" ]]; then
  exit 0
fi

echo "Deploying $local_rev -> $remote_rev"
if ! "$DEPLOY_PATH/scripts/deploy-tencent.sh"; then
  echo "Deployment failed; restoring repository metadata to $local_rev" >&2
  git reset --hard "$local_rev"
  exit 1
fi
