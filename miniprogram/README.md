# 微信小程序提审版运行说明

该目录是“多棱镜笔记”微信小程序原生代码。它复用现有 `yieldglide.com` 的 Next.js API，但通过微信云函数 `mini-api` 转发，因此小程序端不需要配置 `web-view`，也不要求把 Vercel 域名加入小程序 request 合法域名。

## 1. 提审版本能力

- 财经圆桌：从价值、逆向、成长、宏观、风险五个视角解释财经概念。
- 读懂财经资讯：把公开材料整理为事实、重要性、可能影响、不同解读、概念和不确定性。
- 学习记录：仅保存在当前设备，最多 30 条。
- 关于与隐私：展示产品边界、隐私说明和数据处理方式。

提审版本不包含：

- 股票/基金实时行情、股票代码查询、选股池和财报诊断。
- 买卖、加减仓、持有、目标价、止损止盈、收益预测。
- 实盘联赛、虚拟持仓、交易、开户、支付、广告和用户公开发布。

## 2. 首次配置

### 2.0 先看效果（无需 AppID、无需云开发）

1. 下载并安装微信开发者工具：<https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html>
2. 打开开发者工具，选择“导入项目”。
3. 项目目录选择 `/Users/zxiansheng/Desktop/think-tank`。
4. AppID 保持 `touristappid` 或选择“测试号”。
5. 点击“编译”，即可用内置样例预览首页、圆桌、资讯卡片、历史和隐私页面。

`miniprogram/config.js` 默认 `demoMode: true`，演示模式不调用 AI、不依赖云函数。正式提审前必须改为 `false`。

### 2.1 注册与开发者工具

1. 在微信公众平台注册个人主体小程序。
2. 当前后台名称已注册为“多棱镜笔记”，简称“多棱镜”；页面标题和分享文案需保持一致。
3. 安装微信开发者工具，导入仓库根目录 `/Users/zxiansheng/Desktop/think-tank`。
4. 根目录 `project.config.json` 已写入 AppID `wx5c9e2626c351217f`。

### 2.2 开通云开发

1. 在微信开发者工具中打开“云开发”，创建一个环境。
2. 把环境 ID 填入 `miniprogram/config.js` 的 `cloudEnv`。
3. 右键 `cloudfunctions/mini-api`，选择“上传并部署：云端安装依赖”。
4. 在云函数配置中添加环境变量：
   - `MINI_PROXY_SECRET`：至少 16 位的随机长字符串，与 Web 端保持一致。
   - `THINK_TANK_API_BASE`：可选，默认 `https://yieldglide.com`。

生成密钥示例：

```bash
openssl rand -hex 32
```

### 2.3 配置 Web 端

在 Vercel 项目的 Production 环境变量中增加同名 `MINI_PROXY_SECRET`，然后重新部署。可以额外设置：

```bash
MINI_DAILY_FREE_LIMIT=8
```

未配置 `MINI_PROXY_SECRET` 时，`/api/mini/debate` 和 `/api/mini/reading` 会返回 `503`，这是故意的安全降级。

## 3. 本地验证

Web API 回归：

```bash
npm test
npm run build
npm run preflight:mini
```

真实 AppID、云环境和图标都配置完成后，执行发布预检：

```bash
npm run preflight:mini -- --release
```

联调时启动：

```bash
MINI_PROXY_SECRET=test-secret npm run dev -- --port 3210
```

微信开发者工具中确认：

1. 首页可以进入“财经圆桌”和“读懂财经资讯”。
2. 输入“什么是安全边际？”可以生成圆桌笔记。
3. 粘贴一段宏观资讯可以生成学习卡片。
4. 输入“600519 可以买入吗？”会被前端或后端拦截。
5. 历史记录重启开发者工具后仍存在。
6. 真机预览中无横向溢出、按钮不被安全区遮挡。

## 4. 目录结构

```text
project.config.json                 # 微信开发者工具项目入口
miniprogram/                         # 小程序源码
├── app.js / app.json / app.wxss
├── config.js                        # 云环境 ID，需替换
├── data/perspectives.js
├── pages/                           # 首页、圆桌、资讯、记录、关于、隐私
└── utils/                           # 云函数调用、本地记录、格式化
cloudfunctions/mini-api/             # 签名代理云函数
src/app/api/mini/debate/route.js     # 圆桌 Web API
src/app/api/mini/reading/route.js    # 资讯卡片 Web API
src/lib/miniProgramPolicy.js         # 合规提示词、输入输出拦截、签名校验
```

## 5. 提交前检查

- `project.config.json` 已替换真实 AppID。
- `miniprogram/config.js` 的 `demoMode` 已改为 `false`。
- `miniprogram/config.js` 已替换真实云环境 ID。
- Vercel 与云函数使用相同的 `MINI_PROXY_SECRET`。
- 隐私保护指引已按 `submission/隐私保护指引填写.md` 配置。
- 服务类目选择“教育服务-教育信息展示”，可按实际审核意见补充“工具-信息查询”。
- 上传 `submission/app-icon-144.png` 作为小程序头像。
- 按 `submission/截图清单.md` 在开发者工具截取真实页面。
- 按 `submission/提审包说明.md` 填写版本描述和审核备注。
- `npm run preflight:mini -- --release` 通过。

## 6. 重要边界

个人主体不能在微信小程序开展证券期货投资咨询，也不能选择金融业相关类目。这个目录是提审版，不是完整 Web 产品的一比一移植。如果后续要上股票行情、财报诊断、选股池或模拟交易，应改由具备相应资质的企业主体接入，并重新评估类目、数据和内容合规。
