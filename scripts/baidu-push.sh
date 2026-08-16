#!/usr/bin/env bash
# 百度搜索资源平台 · 主动推送
# 用法：
#   export BAIDU_SITE_URL=https://你的域名
#   export BAIDU_PUSH_TOKEN=百度站长平台给你的推送token
#   bash scripts/baidu-push.sh
set -euo pipefail

SITE="${BAIDU_SITE_URL:-}"
TOKEN="${BAIDU_PUSH_TOKEN:-}"
if [ -z "$SITE" ] || [ -z "$TOKEN" ]; then
  echo "请先设置 BAIDU_SITE_URL 和 BAIDU_PUSH_TOKEN（在 ziyuan.baidu.com → 普通收录 → 主动推送 获取 token）"
  exit 1
fi

API="http://data.zz.baidu.com/urls?site=${SITE}&token=${TOKEN}"
# 推送给百度的链接（可增删）
BODY="${SITE}/
${SITE}/breakfast"

echo "推送: $SITE 首页 + /breakfast"
curl -s -X POST -H 'Content-Type:text/plain' -d "$BODY" "$API"
echo
