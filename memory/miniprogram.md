# 微信小程序提审版

> 最后更新：2026-09-19

## 目标

在个人主体条件下，把“大师吵股”Web 产品迁移为可提审的微信小程序。个人主体不能选择金融业类目，因此小程序不直接复制 Web 端的股票行情、选股、财报诊断、实盘联赛和 AI 投资裁决能力，而是保留财经通识学习、公开资讯摘要和多视角解释能力。

## 提审版本定位

- 产品名：`多棱镜笔记`，已于 2026-09-19 在微信公众平台注册，AppID `wx5c9e2626c351217f`；简称“多棱镜”。
- 产品描述：财经通识学习工具，把概念和公开资讯整理成多视角学习卡片。
- 服务类目：优先“教育服务-教育信息展示”；如审核要求，可补充“工具-信息查询”。
- 不接入：金融业类目、证券期货投资咨询、行情服务、交易、开户、支付、广告。
- 不提供：荐买荐卖、目标价、止损止盈、收益预测、仓位指令、投资顾问服务。

## 已实现页面

| 页面 | 路径 | 作用 |
|---|---|---|
| 首页 | `pages/home/index` | 说明产品、边界和两个学习入口 |
| 财经圆桌 | `pages/debate/index` | 五个视角解释同一财经概念 |
| 读懂财经资讯 | `pages/reading/index` | 公开资讯摘要、概念拆解和不确定性 |
| 学习记录 | `pages/history/index` | 本地保存最近 30 条学习卡片 |
| 记录详情 | `pages/history-detail/index` | 查看和删除单条记录 |
| 关于与边界 | `pages/profile/index` | 能力边界、隐私入口和本地清理 |
| 隐私说明 | `pages/privacy/index` | OpenID 哈希限流、输入处理和第三方服务说明 |

## 数据流

```text
微信小程序
  ├─ 本地学习记录：wx.setStorageSync
  └─ wx.cloud.callFunction({ name: 'mini-api' })
          ↓
      cloudfunctions/mini-api
          ├─ 获取当前用户 OPENID
          ├─ 生成 HMAC-SHA256 签名
          └─ 转发 /api/mini/debate 或 /api/mini/reading
                  ↓
              Vercel / Next.js
                  ├─ 校验时间戳、nonce 和 HMAC
                  ├─ OpenID 转为 SHA-256 短期限流键
                  ├─ 输入安全校验
                  ├─ DeepSeek 生成结构化学卡片
                  └─ 输出安全校验
```

小程序不直接请求 `yieldglide.com`，因此提审时不需要把 Vercel 域名加入小程序 request 合法域名。云函数使用 HTTPS 访问 Web API；域名和 AI Key 不进入小程序代码。

## 合规与安全规则

- 输入含股票代码、荐买荐卖、目标价、止损止盈、收益预测等关键词时，后端在模型调用前拒绝。
- 模型提示词明确限定为财经通识教育，禁止具体证券交易建议。
- 模型输出还会做二次拦截；若出现买卖、仓位、目标价或收益预测，直接返回安全错误，不向前端展示。
- 云函数请求使用时间戳、随机 nonce、OpenID 与请求体的 HMAC-SHA256 签名；Web API 拒绝无签名、过期、篡改和重复请求。
- 每人每日默认 8 次生成机会，按哈希后的 OpenID 在进程内计数；不保存明文 OpenID 到业务数据库。
- 问题正文不写入业务数据库；AI 生成失败时返回统一错误，不暴露服务端提示词或配置。
- 小程序没有 web-view、外部跳转、用户公开发布、账号体系或支付入口。

## 运行配置

- Web 端：`MINI_PROXY_SECRET` 必须配置；`MINI_DAILY_FREE_LIMIT` 可选，默认 8。
- 云函数：`MINI_PROXY_SECRET` 必须与 Web 端一致；`THINK_TANK_API_BASE` 可选，默认 `https://yieldglide.com`。
- 小程序：`miniprogram/config.js` 的 `cloudEnv` 必须替换为真实云环境 ID。
- 本地预览：`demoMode: true` 使用内置样例，无需 AppID/云函数；正式提审必须改为 `false`。
- 当前正式配置：AppID `wx5c9e2626c351217f`，云环境 `cloudbase-d0govchp716d4e94d`，`demoMode: false`。
- 开发者工具：`project.config.json` 的 `appid` 必须替换为真实个人小程序 AppID。

## 已知限制

- 不是完整 Web 功能迁移；行情、选股池、财报诊断、联赛和付费能力均未进入提审版。
- 当前按 OpenID 的每日配额是 Vercel 进程内计数，多实例下为尽力而为；如需精确计费，应接 Redis 或数据库计数。
- 微信云环境、云函数依赖和 AppID 需要开发者账号配置，代码仓库无法代替实名和平台创建步骤。
- 如果后续升级企业主体并取得金融相关资质，可另建企业小程序或独立提审包，不要在个人主体提审包中逐步放开金融功能。
