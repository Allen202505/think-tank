# 大师吵股（think-tank）· AI 投资大师智囊团

一个开源的 AI 投资分析工具：汇聚巴菲特、芒格、缠中说禅等投资大师，用 AI 模拟大师辩论、新闻解读、财报拆解与短线分析。

> ⚠️ 本项目完全开源、免费。所有内容由 AI 生成，仅供学习交流与娱乐参考，**不构成任何投资建议或意见**，据此操作风险自负。

## 功能

| 模块 | 说明 |
|---|---|
| ⚔️ 大师PK | 向多位"投资大师"提问，AI 模拟大师公开辩论并给出裁决 |
| 🏆 大师实盘联赛 | 公开赛邀请六位已故历史投机大师，也支持用户邀请指定大师参赛，统一获得 10 万元虚拟额度并按照累计收益率排名 |
| 📰 巴菲特的早餐 | 新闻事件穿透解读 + 你的股票池新闻 |
| 🧰 功能箱 | 财报解读、缠论短线、知识学堂、基础面研究四个能力按 Tab 切换 |
| 🎯 大师的选股池 | 大师选股池 + 我的股票池，行情统计与自选新闻 |

## 技术栈

- Next.js 14（App Router）+ React 18
- DeepSeek / 任意 OpenAI 兼容模型（BYOK）
- 数据源：东方财富 / 财联社 / Yahoo（行情与新闻）
- 部署：Vercel 或 Docker 自建

## 快速开始

```bash
npm install
cp .env.example .env.local   # 填入你的 DeepSeek API Key（用于免费体验额度）
npm run dev                  # http://localhost:3000
```

## 登录 / 注册（可选）

本项目支持注册/登录（Supabase Auth），用于**云端同步你的「我的股票池」**：

- 注册后**自动登录**，无需邮箱验证
- 「我的股票池」登录后自动同步到云端，换设备也能同步
- **你的 API Key 仍只保存在本地浏览器，不上传**，云端只存股票池与非敏感配置
- 每位用户仅能访问自己的数据（RLS 行级安全）

### 启用步骤（可选）

1. 在 [Supabase](https://supabase.com) 新建项目，关闭 **Authentication → Sign In / Providers → Confirm email**
2. 打开 **SQL Editor**，粘贴并运行 [`supabase/schema.sql`](./supabase/schema.sql)（建表 + RLS）
3. 在 **Project Settings → API** 复制 `Project URL` 与 `anon public` key
4. 填入 `.env.local`：

```bash
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
```

> 不配置 Supabase 时，登录入口自动隐藏，项目仍可用（股票池只存本地）。

## BYOK：自带 API Key

本项目免费，但站长不承担所有用户的模型调用成本：

- 每位访客默认有 **10 次免费体验**（用站长的 Key）
- 2 次用完后，点击页面的「🔑 AI 设置」，填入**你自己的 API Key**
- 站长默认模型为 **DeepSeek-V4.1-Flash**（API ID `deepseek-flash`），默认关闭思考模式以控制成本
- 支持 DeepSeek / OpenAI / Kimi / 通义千问 / 任意 OpenAI 兼容服务（Base URL 与模型名都可自定义）
- **你的 Key 只保存在你自己的浏览器本地（localStorage）**，请求时即用即弃，不会上传保存到服务器

## 功能说明与回归测试

- [功能说明与回归测试手册](./memory/QA.md)

## 大师实盘联赛公共底表

公开赛账户、用户邀请大师、持仓、决策和评论使用 Supabase 公共底表。执行以下步骤启用：

1. 在 Supabase SQL Editor 运行 [`supabase/master_league.sql`](./supabase/master_league.sql)。
2. 在 Vercel / `.env.local` 添加服务端专用 `SUPABASE_SERVICE_ROLE_KEY`（不要提交到 Git 或暴露给浏览器）。
3. 用户邀请大师需要先登录，写入后会立即对所有访客可见并持久保存。
4. 站长账号设为管理员后，可在任意邀请大师详情中查看邀请人、提示词与 Skill，并「下架并删除」广告内容（被下架的大师 id 会进入黑名单，对方无法重新发布）：

```sql
update public.profiles set is_admin = true where email = '你的管理员邮箱';
```

未配置 service role 时，平台官方账户仍使用实时测试数据；用户邀请的持久化能力需要 Supabase 登录和底表。
底表尚未初始化时联赛页不报错，只是暂时看不到其他用户邀请的大师。

## 大师智能体感知层（可选调试）

大师实盘联赛的「感知层」给每位大师准备了 5 个可调用工具（全市场概览、条件选股、单股快照、日线、自己的持仓）。
全市场数据只在服务端流转并按需查询，**只有查询结果才会进模型上下文**，所以 5000+ 只股票不产生 token 成本。

本地调试（零 LLM 调用）：

```bash
curl -sS 'http://127.0.0.1:3000/api/master-league/tools'                          # 列出工具与参数
curl -sS 'http://127.0.0.1:3000/api/master-league/tools?tool=get_market_overview'  # 今天大盘/行业/涨停池
curl -sS 'http://127.0.0.1:3000/api/master-league/tools?tool=screen_stocks&industry=医药&minAmountYi=5&sortBy=changePct'
curl -sS 'http://127.0.0.1:3000/api/master-league/tools?tool=get_stock_quote&code=600276'
```

### 单大师试跑（会真实调用模型）

```bash
curl -sS -X POST 'http://127.0.0.1:3000/api/master-league/agent' \
  -H 'Content-Type: application/json' -d '{"masterId":"livermore"}'
```

返回内容包含：工具调用轨迹、最终决策、真实 token 用量与成本、以及当日累计台账。
成本闸门默认「4 轮 / 8 次工具调用 / 单次 30k token / 当日 200k token」，可用 `MASTER_LEAGUE_AGENT_*` 环境变量收紧（见 `.env.example`）。
生产环境需配置 `MASTER_LEAGUE_AGENT_TOKEN` 并在请求头带 `x-agent-token`，否则该接口只在非生产环境可用。

### 大师每日决策（AI 自主决策）

每个交易日收盘后，六位大师各自调用工具看行情、看自己的持仓，然后给出下一交易日的操作计划（1~3 个动作），
计划落库后由结算引擎按真实开盘价执行、收盘价结算。**模型只出意图，成交价与收益永远由引擎计算。**

```bash
# 手动跑一次（决策 + 互评），?master=livermore 可只跑一位，?skipCommentary=1 只跑决策
curl -sS 'http://127.0.0.1:3000/api/cron/master-league-daily' -H "Authorization: Bearer $CRON_SECRET"
```

- 定时：`vercel.json` 里 `35 7 * * 1-5`（UTC）= 北京时间 15:35 周一至周五；周末与节假日自动跳过。
- 成本：六位决策约 ¥0.13~0.20/天，互评约 ¥0.01/天，合计 **约 ¥4/月**。
- 兜底：某位大师当天没有 AI 计划时，自动回退到 `src/data/masterLeague.js` 的预置剧本，比赛不会中断。

### 大师互评（AI 现场生成）

```bash
# 生成当天六位大师的互评（真实调用模型，整天约 ¥0.01）
curl -sS -X POST 'http://127.0.0.1:3000/api/master-league/commentary' \
  -H 'Content-Type: application/json' -d '{"all":true}'

# 只读缓存（页面用的就是它，不花钱）
curl -sS 'http://127.0.0.1:3000/api/master-league/commentary?master=loeb'
```

互评由 AI 依据「对方今天的真实操作 + 最新持仓 + 排名 + 当天大盘」生成，每条都带本人回怼，并强制只能引用给定数据（不许编造股数/价格/收益）。
结果按天缓存，**访客刷新页面不产生费用**；生成需授权（生产环境配置 `MASTER_LEAGUE_AGENT_TOKEN`）。

## 部署

### Vercel

导入本仓库，填好环境变量即可。

### Docker 自建

```bash
cp .env.example .env.production
docker compose up -d --build
```

## 开源许可

[MIT](./LICENSE)

## 免责声明

本项目及其中所有 AI 生成内容仅供学习、交流与娱乐，不构成任何投资建议、意见或要约。股市有风险，入市需谨慎。
