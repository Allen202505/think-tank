# 「大师吵股」微信小程序

该目录是“大师吵股”微信小程序原生代码。小程序通过微信云函数 `mini-api` 访问 `yieldglide.com` 的签名接口，不直接请求 Web 域名，也不使用 `web-view`。

## 1. 当前能力

### 研究工具

- **新闻分析**：按“巴菲特的早餐”事件穿透方法，拆解公开新闻的事实、影响传导、逆向检验和后续观察指标。
- **行业周期分析**：结合公开行情、财务指标和用户补充行业材料，判断行业阶段、公司位置与拐点信号。
- **上证指数脱水**：按行业或个股剔除上证权重，展示官方指数、同除数剩余点位、隔离收益、主要剔除对象与数据口径。
- **基本面研究**：从商业模式、增长质量、现金流、资产负债、竞争优势与反证拆解一家公司。
- **供应链瓶颈分析**：使用 Serenity 六步框架梳理供应链卡点、候选公司、多空证据与待核验数据。
- **芒格教你读财报**：支持粘贴财报原文或公开 HTML/PDF 链接，按三张表、利润含金量、营运资金、资本配置与逆向排雷阅读。

### 财经通识

- 财经圆桌：价值、逆向、成长、宏观、风险五个视角解释财经概念。
- 读懂财经资讯：整理公开材料的事实、影响、概念与不确定性。
- 本地研究记录：最多 30 条，仅保存在当前设备。
- 关于、边界与隐私说明。

## 2. 合规边界

小程序统一执行以下规则：

- 不提供买入、卖出、加仓、减仓、持有等交易指令。
- 不提供目标价、止损止盈位、收益预测或稳赚承诺。
- 不接入证券交易、开户、支付或用户公开发布功能。
- 输出同时经过内容安全检查；命中交易建议或收益预测时拒绝展示。
- 公开行情、财务数据可能延迟、缺失或存在口径差异，页面会提示数据缺口。

> 新增公司、行业、指数和财报分析能力后，微信小程序的类目、主体资质与审核尺度必须在提审前重新确认。个人主体尤其需要核对金融相关服务的开放范围，不应仅依赖代码中的免责声明。

## 3. 目录与数据流

```text
miniprogram/
├── app.js / app.json / app.wxss
├── config.js                         # 云环境 ID 与 demoMode
├── data/researchTools.js             # 六种研究工具元数据
├── pages/home/index                  # 首页：研究工具与通识入口
├── pages/analysis/index              # 统一研究工作台
├── pages/debate/index                # 财经圆桌
├── pages/reading/index               # 资讯学习卡片
├── pages/history/index               # 本地研究历史
├── pages/history-detail/index        # 历史详情
├── pages/profile/index               # 关于与边界
└── pages/privacy/index               # 隐私说明

cloudfunctions/mini-api/index.js      # OpenID、签名、转发
src/app/api/mini/debate/route.js      # 财经圆桌小程序接口
src/app/api/mini/reading/route.js     # 资讯卡片小程序接口
src/app/api/mini/research/route.js    # 六种研究工具小程序接口
src/lib/miniResearch.js               # 工具白名单、输入校验、提示词与结果归一化
```

```text
微信小程序
  └─ wx.cloud.callFunction({ name: 'mini-api', data: { action, payload } })
       ↓
    cloudfunctions/mini-api
       ├─ 获取 OPENID
       ├─ 生成 HMAC-SHA256 签名
       └─ POST /api/mini/debate | reading | research
              ↓
          Next.js 服务端
              ├─ 校验时间戳、nonce、OPENID 与 HMAC
              ├─ 输入校验和敏感输出拦截
              ├─ 拉取公开行情/财务/指数数据或调用 AI
              └─ 返回统一结构化结果
```

## 4. 首次配置

### 4.1 微信开发者工具

1. 安装微信开发者工具。
2. 导入仓库根目录 `/Users/zxiansheng/Desktop/think-tank`。
3. `project.config.json` 已写入 AppID `wx5c9e2626c351217f`。
4. 当前云环境为 `cloudbase-d0govchp716d4e94d`，`demoMode: false`。

### 4.2 云函数

1. 在微信开发者工具中打开“云开发”。
2. 右键 `cloudfunctions/mini-api`，选择“上传并部署：云端安装依赖”。
3. 配置环境变量：
   - `MINI_PROXY_SECRET`：至少 16 位随机字符串，与 Web 服务一致。
   - `THINK_TANK_API_BASE`：可选，默认 `https://yieldglide.com`。

### 4.3 Web 服务

在部署环境配置同名 `MINI_PROXY_SECRET`，重新部署 Next.js：

```bash
MINI_DAILY_FREE_LIMIT=8
```

未配置 `MINI_PROXY_SECRET` 时，`/api/mini/*` 会返回 `503` 或拒绝请求，这是预期的安全降级。

### 4.4 微信公众平台

代码改名不会自动修改微信后台注册名称。需要在微信公众平台手动将小程序名称改为“大师吵股”，并同步检查简称、介绍、头像、类目、隐私保护指引和版本描述。

## 5. 本地验证

```bash
find miniprogram cloudfunctions -name '*.js' -print0 | xargs -0 -n1 node --check
npm test
npm run build -- --webpack
npm run preflight:mini
```

本地签名联调：

```bash
MINI_PROXY_SECRET=test-secret-1234567890 npm run dev -- --port 3210
```

开发者工具重点检查：

1. 首页显示“大师吵股”和六个研究工具入口。
2. 六个工具可切换，输入区与结果区不横向溢出。
3. 新闻分析、行业周期、基本面、供应链、财报阅读能返回结构化结果。
4. 上证指数脱水能读取公开数据并展示官方/脱水点位与剔除明细。
5. 历史页“研究”筛选和详情可展示新结果。
6. 未签名请求返回 401；交易指令和收益预测被拒绝。

发布前执行：

```bash
npm run preflight:mini -- --release
```

## 6. 已知限制

- 上证指数脱水使用当前沪市样本和当前权重复刻，不等同于持牌指数公司口径。
- 行业与基本面研究依赖公开数据源，数据源失败时会明确报错或标注缺口。
- 财报阅读的链接模式仅支持公开可访问的 HTML/PDF；读取失败时应直接粘贴正文。
- 每日 AI 生成次数默认 8 次，可用 `MINI_DAILY_FREE_LIMIT` 调整；指数脱水不消耗 AI 次数。
- 本次改名与功能扩展尚未替代微信公众平台后台的名称、类目和资质变更。
