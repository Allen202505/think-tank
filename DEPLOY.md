# 自建服务器部署 + 百度 SEO 操作指南

> 账户类操作（买服务器、登录百度站长、DNS）需要你本人完成；当前生产已迁移到腾讯云香港 Lighthouse，代码、服务器自动拉取和部署脚本已备好。

## 一、买服务器（选一个方向）

| 方向 | 优点 | 缺点 | 推荐 |
|---|---|---|---|
| 国内云（腾讯云轻量/阿里云轻量） | 国内访问快 | 域名需 ICP 备案（1-2 周） | 有国内域名+愿意备案 |
| 香港/海外节点（Vultr、DigitalOcean、腾讯云香港轻量） | **免备案**，即刻可用 | 国内访问略慢（用 Cloudflare 加速可缓解） | **新手最省事** |

- 最低配置：2 核 2G、40G SSD、系统 Ubuntu 22.04 / Debian 12。约 ¥50-100/月，新用户常有优惠。
- 你项目已在用 Cloudflare，选香港/海外节点 + Cloudflare 加速是性价比最高的组合。

## 二、服务器上部署（Docker 一条龙）

1. 服务器装 Docker：`curl -fsSL https://get.docker.com | sh`。
2. 克隆仓库到 `/opt/think-tank`。
3. 服务器上准备环境变量：`cp .env.local .env.production`，并确认 `NEXT_PUBLIC_SITE_URL=https://yieldglide.com`。
4. 执行 `set -a && source .env.production && set +a`，再运行 `docker compose up -d --build`。
5. 安装 Nginx，使用 Cloudflare Origin Certificate 配置 443；Cloudflare SSL/TLS 设为 Full (strict)。
6. 服务器 crontab 每分钟运行 `scripts/auto-deploy-tencent.sh`；push `main` 后检测到新提交即自动执行 `scripts/deploy-tencent.sh`，并校验 `/api/health` 返回的构建 commit。
7. `scripts/run-daily-cron.sh` 由 crontab 每小时 `:35` 唤醒，只在北京时间 15:35–15:44 执行每日联赛任务。

## 三、百度搜索资源平台（ziyuan.baidu.com）提交 sitemap

1. 用百度账号登录 https://ziyuan.baidu.com
2. 「普通收录 → 资源提交 → 添加站点」：填你的域名（如 https://your-domain.com）
3. 选择验证方式（推荐**HTML标签验证**）：
   - 百度会给你一段 `<meta name="baidu-site-verification" content="XXXX">`
   - 告诉我这个 XXXX，我帮你替换到 src/app/layout.js 里（现在里面是旧占位值）
   - 部署后点「完成验证」
4. 验证通过后：站点管理 → 普通收录 → **sitemap** → 提交：
   ```
   https://your-domain.com/sitemap.xml
   ```
5. （推荐）**主动推送**，让新链接秒级进入收录队列：
   - 在「普通收录 → 主动推送」里复制你的推送 token
   - 执行（token 只需你自己保管，不放进代码仓库）：
     ```
     BAIDU_SITE_URL=https://your-domain.com BAIDU_PUSH_TOKEN=你的token bash scripts/baidu-push.sh
     ```

## 四、Google 搜索

- sitemap 已在 /sitemap.xml（含首页 + /breakfast）
- Google Search Console（search.google.com）添加站点 → 提交 sitemap 即可
- JSON-LD 结构化数据已内置（WebSite / WebApplication / 能力列表），Google 会自动读取

## 五、验收清单

- [ ] 首页可访问、HTTPS 正常
- [ ] /sitemap.xml 返回 XML
- [ ] 百度验证通过、sitemap 提交成功、主动推送返回 success
- [ ] 服务器上 .env.production 不含明文密钥泄露（勿提交到 git）
- [ ] `http://127.0.0.1:3000/api/health` 返回 200，且 `commit` 与当前部署提交一致

## 六、微信小程序提审版部署

小程序提审版使用“微信云函数代理 + 现有 Next.js API”，不依赖小程序 request 合法域名。完整步骤见 [`miniprogram/README.md`](./miniprogram/README.md)。

1. 在腾讯云服务器 `/opt/think-tank/.env.production` 增加随机 `MINI_PROXY_SECRET`，重新部署 Web 端。
2. 在微信开发者工具创建云开发环境，把环境 ID 写入 `miniprogram/config.js`。
3. 在 `cloudfunctions/mini-api` 配置相同的 `MINI_PROXY_SECRET`，选择“上传并部署：云端安装依赖”。
4. 把根目录 `project.config.json` 的 `appid` 替换为真实个人小程序 AppID。
5. 使用真实设备验证圆桌和资讯生成，再按 `submission/提审包说明.md` 提交审核。

注意：个人主体不能选择金融业类目。提审版本不得加入股票代码、行情、选股、财报诊断、实盘联赛、买卖建议、收益预测、交易或支付入口。
