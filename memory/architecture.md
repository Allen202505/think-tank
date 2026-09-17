# 系统架构

## 整体架构图

```
用户访问 yieldglide.com
    ↓
Cloudflare CDN（全球节点加速）
    ↓
Vercel 服务器（美国）
    ↓
Next.js 应用
```

## 目录结构

```
think-tank/
├── src/
│   ├── app/
│   │   ├── masters/         # 大师列表页 + 32 位大师详情页（SEO）
│   │   └── page.css          # 首页样式（从 page.js 拆出）
│   ├── components/           # Card / MasterAvatar / MiniBtn / MasterProfileModal
│   ├── data/masters.js       # 32 位大师数据
│   ├── i18n/messages.js      # 中英文案
│   └── lib/                  # prompts.js（prompt 构建）/ poster.js（分享海报）
│       ├── robots.js          # 生成 robots.txt
│       ├── sitemap.js         # 生成 sitemap.xml
│       └── ...                # 其他页面和组件
├── memory/                    # 记忆文件夹（本文件所在）
│   ├── project.md            # 项目基本信息
│   ├── architecture.md       # 系统架构（本文件）
│   └── log.md                # 决策记录
└── package.json
```

## 核心文件说明

### SEO 相关
- `src/app/robots.js`: 配置搜索引擎爬虫规则，已包含 sitemap 声明
- `src/app/sitemap.js`: 动态生成站点地图，当前包含首页


### 数据层（实时行情/财务）
- `src/app/api/chat/marketData.js`: 统一市场数据层（东方财富 + Yahoo 双源、TTL 缓存、失败降级）
- `src/app/api/master-league/route.js`: 大师实盘联赛结算入口；东方财富 → 腾讯证券 → 新浪财经三级行情回退，5 分钟进程内缓存。
- `src/lib/masterLeagueEngine.mjs`: 纯函数结算引擎；按 100 股交易单位、次日开盘价成交、当日收盘价计量净值，并生成收益曲线和排名。
- `src/lib/masterLeagueInvites.mjs`: 用户邀请大师参赛，统一赠送 10 万元初始额度；公开赛按累计收益率合并排名。
- `src/lib/leagueInvites.js`: 读取、发布和删除 Supabase 公共邀请数据；所有访客可读，登录用户只能管理自己的邀请，管理员可删除任意邀请。
- `src/lib/leagueInvitePolicy.mjs`: 邀请错误分类（底表缺失/缺字段/RLS 拒绝）与删除模式（真删/黑名单下架）纯函数。
- `src/lib/marketSnapshot.mjs`: 全市场感知层（大师智能体数据底座）。新浪榜单/行业 + 东财指数/涨停池/单股 + 腾讯&新浪日线多源冗余，进程内缓存，纯函数可测。
- `src/lib/masterLeagueTools.mjs`: 智能体工具层，5 个工具（概览/筛选/快照/日线/持仓）+ JSON Schema，可直接用于 function calling。
- `src/app/api/master-league/tools/route.js`: 工具调试入口（零 LLM），`GET ?tool=&参数` 或 `POST {tool,args}`。
- `src/lib/masterLeagueAgent.mjs`: 单大师决策循环（人设 prompt + 工具调用 + 结构化校验 + 强制收口 + 成本台账）。所有成本闸门集中在 `AGENT_LIMITS` / `PRICING`，可用环境变量覆盖。
- `src/app/api/master-league/agent/route.js`: 单大师试跑入口 `POST /api/master-league/agent {masterId}`；生产需 `MASTER_LEAGUE_AGENT_TOKEN`。
- LLM 只输出意图（action/symbol/targetPct/reason/risk），成交价、持仓、收益仍由 `masterLeagueEngine.mjs` 按真实行情计算——模型永远不能自己编造成交价或收益。
- 服务端默认模型为 DeepSeek-V4.1-Flash（API ID `deepseek-flash`）；`src/lib/llm.js` 对 DeepSeek Flash/V4 系列显式发送 `thinking: { type: "disabled" }`，保持多轮工具调用上下文兼容并控制成本。
- `src/lib/masterLeagueDb.js`: 公开赛公共底表读写；服务端 service role 独占写入，匿名/登录用户可读取公开快照。
- 公开赛人物：利弗莫尔、威科夫、达瓦斯、勒布、科斯托拉尼、巴鲁克；每人包含时代、原始方法、A股映射和一句话简介。
- `src/lib/stockSearch.mjs` + `GET /api/stock-search`: A 股中文模糊搜索，兼容东财旧 `AStock` 与科创板 `Classify=23`。
- `src/lib/tableSort.mjs`: 选股池表头数值/文本排序；区间涨幅按带符号数值升降序，空值置尾。
- 行情容错：东财盘前 `f43=0` 时使用 `f60` 昨收并标记 `isPreviousClose`；客户端对网关 HTML/非 JSON 响应做统一友好降级。
- `src/app/api/chat/quoteContext.js`: 解析问题里的公司，生成「最新行情+财务快照」注入 AI
- `src/app/api/chat/route.js`: DeepSeek 代理，调用 quoteContext 注入最新数据
- `src/app/masters/page.js` + `[id]/page.js`: 大师列表页与详情静态页（SEO）
- `src/lib/poster.js`: 客户端生成 1080×1920 辩论分享海报

### 环境变量
- `NEXT_PUBLIC_SITE_URL`: 网站基础 URL，用于生成 sitemap 和 robots

## 部署流程

1. 代码推送到 Git 仓库
2. Vercel 自动检测并构建
3. 部署到 Vercel 服务器
4. Cloudflare CDN 自动更新缓存
5. 用户通过 Cloudflare 访问网站

## 网络架构

### DNS 解析
- DNS 服务商: Cloudflare
- 域名指向: Cloudflare 的 IP
- Cloudflare 转发到: Vercel 服务器

### CDN 节点
- 全球 300+ 节点
- 国内用户主要通过香港、台湾、日本、新加坡节点访问
- 自动选择最近节点，降低延迟

## 数据流

1. 用户请求 → Cloudflare CDN
2. CDN 检查缓存
3. 如有缓存 → 直接返回
4. 如无缓存 → 请求 Vercel 服务器
5. Vercel 执行 Next.js 渲染
6. 返回结果 → CDN 缓存 → 用户

## 大师实盘联赛数据流（2026-09-15）

```text
AI 收盘任务：master_league_plans（6 位 × 1~3 条 / 日，缺失时回退 LEAGUE_PLANS）
    ↓
GET /api/master-league（按交易日历把计划映射到执行日）
    ↓
东方财富 → 腾讯证券 → 新浪财经（多源日 K）
    ↓
masterLeagueEngine 按真实开盘价执行、收盘价结算
    ↓
账户 / 持仓 / 收益曲线 / 排名 / 决策 / 评论
    ↓
MasterLeague.js 在工作台内展示

同一次 Vercel Cron：
runDecisionJob（生成下一交易日计划）
    ↓ decisionsByMaster
runCommentaryJob（按 planDate 生成并落库互评）
    ↓
GET /api/master-league/commentary?date=<策略 decisionDate>&master=<id>
```

- **公共账户数据**：由市场行情实时计算，并通过 `src/lib/masterLeagueDb.js` 同步至 `supabase/master_league.sql` 定义的公共底表；未配置 `SUPABASE_SERVICE_ROLE_KEY` 时只返回测试快照，不持久化。
- **收盘任务顺序**：`src/app/api/cron/master-league-daily/route.js` 先跑决策，再把刚生成的 `decisionsByMaster` 直接传给评论任务；评论不依赖联赛接口的计划缓存，因此不会把新操作误判为“无操作”。
- **持有语义**：无标的「持有」只表示不调整仓位；`masterLeagueEngine.mjs` 补充 `holdingNames`（已执行计划取执行日前持仓，待执行计划取最新收盘持仓）。前端据此显示实际股票名或“当前空仓”，不展示无意义的 `targetPct=0`。
- **互评日期**：服务端按策略 `planDate` / `decisionDate` 落库；`MasterLeague.js` 用当前展示策略的日期请求评论，避免次日默认查“今天”时错过前一晚生成的评论。
- **普通用户点赞**：仅保存在浏览器 `localStorage`，键为 `thinktank_master_league_likes_v1`；不新增账号依赖。
- **邀请参赛**：登录用户发布到 `master_league_invites` 公共底表，所有访客都能读取并留存；自定义大师同时通过 `onAddCustomMaster` 写回 `custom-masters-v1`，与大师 PK 共用人物库。
- **管理员审核**：`profiles.is_admin` 控制管理员权限，邀请详情页对管理员展示邀请人、发布时间、提示词与 Skill；普通用户只能删除自己的邀请，管理员删除他人邀请时先写 `master_league_invite_blocks` 黑名单再删除数据，防止对方换浏览器重新发布。
- **邀请降级**：`src/lib/leagueInvitePolicy.mjs` 把底表缺失（`PGRST205` / `42P01`）、缺字段（`42703`）、RLS 拒绝（`42501`）分类；缺表时联赛页静默显示官方大师，缺 `is_admin` 时按普通用户处理。
- **当前边界**：AI 决策、幂等计划落库、收盘评论任务已上线；进程内成本台账持久化、公共点赞总数和历史赛季归档仍待建设。

## 功能箱导航（2026-09-11）

- `src/components/ToolboxTabs.js`：功能箱标题与四个 Tab，使用 `role=tablist/tab/tabpanel` 保持键盘与读屏语义。
- 收纳模块：`munger`（芒格财报）、`zen`（缠中说禅）、`naval`（纳瓦尔知识学堂）、`fundamental`（鱼大基础面研究）。
- 主导航顺序：功能箱位于行业周期分析之后；移动端底栏与功能大厅保持一致。
- Tab 采用紧凑胶囊：仅保留图标与模块名，桌面宽度随内容收缩，移动端横向滚动。
- URL：`?tab=toolbox&tool=<module>`；旧链接 `?tab=munger|zen|naval|fundamental` 自动进入功能箱并选中对应模块。
- 本地记忆：`thinktank_toolbox_tab` 保存用户最后一次选择的 Tab。
- 挂载策略：四个模块组件保持常驻，仅用 `.ws-hidden` 隐藏非当前面板，避免切换时丢失组件内状态。

## 芒格财报侦查诊断数据流（2026-09-16）

```text
/api/munger 解析链接/附件文本
    ↓ 并行
┌──────────────────────────────┬────────────────────────────────┐
│ buildEarningsDataCard        │ buildAStockForensicEvidence    │
│ 行情 / 财务历史 / 预期 / 研报 │ 三表 / 主要指标 / 年报附注    │
└──────────────────────────────┴────────────────────────────────┘
    ↓
证据包 + Skill 规则注入 LLM
    ↓
芒格正文 + 结构化 diagnosis + followUps
    ↓
MungerFinance → FinancialDiagnosisChecklist
  ├─ 芒格回答区
  ├─ 独立「本期核心结论」区（核心矛盾 / 主要风险 / 重点线索）
  ├─ 五列侦查清单（问题 / 证据 / 判断 / 核查路径）
  ├─ 单条继续追问 + 3 个继续调查问题
  ├─ 数据缺口
  └─ 系统数据核验与来源（折叠）
```

- `src/app/api/chat/financialForensics.js`：A 股财报侦查数据层。并行拉取东财 `RPT_F10_FINANCE_GBALANCE`、`RPT_F10_FINANCE_GINCOME`、`RPT_F10_FINANCE_GCASHFLOW`、主要指标和最新年报/审计报告，生成结构化 seed 与附注证据包。
- `src/lib/pdfText.js`：PDF 文本抽取与受限页范围解析。用户上传的 PDF 仍走全文；自动获取的年报只解析前 12 页 + 后 68%，覆盖审计意见与财报附注，避免整份年报解析拖慢请求。
- `src/components/FinancialDiagnosisChecklist.js`：独立的一页纸诊断模块。公司画像只保留短标签，三类核心结论独立成区；桌面渲染五列表格，移动端切换为卡片；状态胶囊单独一行；每条支持证据详情展开、单条定向追问和数据缺口提示。表格去掉外框和优先级左侧竖线，使用图标、提亮色块和状态色做层级。状态、优先级、来源和 `⚪ 数据不足` 均由后端结构控制，不靠模型返回 emoji。
- `diagnosis` 结构升级为 `coreContradiction/mainRisk/keyLead + rows[question,evidence[],judgment,nextCheck{what,lookAt,judge},status,source]`；归一化层同时兼容旧版 `metric/current/trend/finding/next`，避免历史本地结果失效。
- `financialForensics.js` 为 15 类结构化 seed 维护“侦查问题 + 三步核查”模板；AI 输出不足时，由确定性 seed 生成同结构清单，问题、证据和核查路径不依赖模型自由发挥。
- `financialForensics.js` 对现金流等指标增加边际变化分类：首次转负/显著恶化进入 P0，明显改善进入 P1 并生成“为什么改善、能否持续”的问题，持续无变化的旧问题降为背景风险。
- 芒格提示词要求先判断边际变化再排优先级，再基于诊断结果写正文；`diagnosis.rows` 只允许引用三表、年报附注、审计报告或明确的数据不足，并要求 P0 只留给首次出现/显著恶化/资金安全问题、总数 6-10 条、下一步固定三段式。
- 年报/审计报告原始来源优先使用东方财富公告正文接口 `np-anotice-stock.eastmoney.com` / `np-cnotice-stock.eastmoney.com`；附注命中失败时降级为结构化三表 + 数据不足，不编造数字。
- 数据缓存：三表 12 小时、年报/附注证据 7 天、公告列表 24 小时；单次证据包外层超时 22 秒，失败静默降级。
- `withTimeout()` 现在会在 Promise 完成后清理定时器，避免服务端进程因超时定时器悬挂 20 秒以上。
- 当前 A 股优先；港股、美股证据链未接入，仍使用原有系统数据核验并明确边界。
