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
├── miniprogram/              # 微信原生小程序提审版
│   ├── pages/                # 首页/圆桌/资讯/记录/关于/隐私
│   └── utils/                # 云函数调用与本地存储
├── cloudfunctions/mini-api/  # 小程序签名代理云函数
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
- `filterCompetitionDates` 按 `PUBLIC_LEAGUE.startDate` 截取比赛交易日；`dayCount` 使用截取后的日期数组长度，首日计 1。API 在生成计划映射前先过滤开赛日之前的旧计划，数据库快照降级读取时也会裁剪开赛日前曲线。
- `src/lib/masterLeagueInvites.mjs`: 用户邀请大师参赛，统一赠送 10 万元初始额度；公开赛按累计收益率合并排名。
- `src/lib/leagueInvites.js`: 读取、发布和删除 Supabase 公共邀请数据；所有访客可读，登录用户只能管理自己的邀请，管理员可删除任意邀请。
- `src/lib/leagueInvitePolicy.mjs`: 邀请错误分类（底表缺失/缺字段/RLS 拒绝）与删除模式（真删/黑名单下架）纯函数。
- `src/lib/marketSnapshot.mjs`: 全市场感知层（大师智能体数据底座）。新浪榜单/行业 + 东财指数/涨停池/单股 + 腾讯&新浪日线多源冗余，进程内缓存，纯函数可测。
- `src/lib/masterLeagueTools.mjs`: 智能体工具层，5 个工具（概览/筛选/快照/日线/持仓）+ JSON Schema，可直接用于 function calling。
- `src/app/api/master-league/tools/route.js`: 工具调试入口（零 LLM），`GET ?tool=&参数` 或 `POST {tool,args}`。
- `src/lib/masterLeagueAgent.mjs`: 单大师决策循环（人设 prompt + 工具调用 + 结构化校验 + 资金约束 + 强制收口 + 成本台账）。`applyFundingConstraints` 会按可用现金、一手成本和同日卖出回笼资金排序/校正买入；所有成本闸门集中在 `AGENT_LIMITS` / `PRICING`，可用环境变量覆盖。
- `src/app/api/master-league/agent/route.js`: 单大师试跑入口 `POST /api/master-league/agent {masterId}`；生产需 `MASTER_LEAGUE_AGENT_TOKEN`。
- LLM 只输出意图（action/symbol/targetPct/reason/risk），成交价、持仓、收益仍由 `masterLeagueEngine.mjs` 按真实行情计算——模型永远不能自己编造成交价或收益。
- 服务端默认模型为 DeepSeek-V4.1-Flash（API ID `deepseek-flash`）；`src/lib/llm.js` 对 DeepSeek Flash/V4 系列显式发送 `thinking: { type: "disabled" }`，保持多轮工具调用上下文兼容并控制成本。
- `src/lib/masterLeagueDb.js`: 公开赛公共底表读写；服务端 service role 独占写入，匿名/登录用户可读取公开快照。
- 公开赛人物：利弗莫尔、理查德·D·威科夫、达瓦斯、勒布、安德烈·科斯托拉尼、巴鲁克；每人包含时代、原始方法、A股映射、短版 `intro`（供智能体）和长版 `biography`（供详情页）。
- `src/lib/stockSearch.mjs` + `GET /api/stock-search`: A 股中文模糊搜索，兼容东财旧 `AStock` 与科创板 `Classify=23`；前端允许中文单字触发候选，6 位纯代码跳过候选请求。
- `src/lib/tableSort.mjs`: 选股池表头数值/文本排序；区间涨幅按带符号数值升降序，空值置尾。
- `src/components/StockPools.js`: 选股池列表与大师评价加载态使用单颗 CSS 3D 骰子（六面点数 + 透视旋转），不引入图片或第三方动画库；`prefers-reduced-motion` 下关闭动画。
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
- **加载动效**：`MasterLeague.js` 初次拉取公开赛数据时渲染两颗 CSS 3D 骰子（六个面 + 透视旋转），右上角读取胶囊使用迷你骰子图标；masthead 刷新按钮保持 lucide `RefreshCw`，刷新中仅旋转该图标，不复用骰子；正文只显示同步提示，`prefers-reduced-motion` 下关闭骰子动画。
- **当前边界**：AI 决策、幂等计划落库、收盘评论任务已上线；进程内成本台账持久化、公共点赞总数和历史赛季归档仍待建设。

## 功能箱导航（2026-09-11）

- `src/components/ToolboxTabs.js`：渲染五个 Tab，不再显示“功能箱”标题与说明；使用 `role=tablist/tab/tabpanel` 保持键盘与读屏语义；Tab 顺序和默认值来自 `src/lib/toolboxTabs.mjs`。
- 收纳模块：`fundamental`（鱼大基础面研究，第一且默认）、`munger`（芒格财报）、`zen`（缠中说禅）、`naval`（纳瓦尔知识学堂）、`strategy-gallery`（选股策略大赏）。
- 主导航顺序：功能箱位于行业周期分析之后；移动端底栏与功能大厅保持一致。
- Tab 采用紧凑胶囊：仅保留图标与模块名，桌面宽度随内容收缩，移动端横向滚动。
- 功能箱桌面内容轨道统一为 1180px：页面标题、Tab 胶囊和五个模块主体共用同一左边界；功能箱标题与模块主标题统一使用 `line-height: 1.08`。
- URL：`?tab=toolbox&tool=<module>`；旧链接 `?tab=munger|zen|naval|fundamental|strategy-gallery` 自动进入功能箱并选中对应模块。
- 本地记忆：`thinktank_toolbox_tab` 保存用户最后一次选择的 Tab。
- 挂载策略：五个模块组件保持常驻，仅用 `.ws-hidden` 隐藏非当前面板，避免切换时丢失组件内状态。

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

- `src/app/api/chat/financialForensics.js`：A 股财报侦查数据层。并行拉取东财 `RPT_F10_FINANCE_GBALANCE`、`RPT_F10_FINANCE_GINCOME`、`RPT_F10_FINANCE_GCASHFLOW`、主要指标和最新年报/审计报告，生成结构化 seed 与附注证据包。构建 seed 前先从报告文本识别年报/半年报/一季报/三季报，并选择同口径历史序列做边际比较。
- `src/lib/pdfText.js`：PDF 文本抽取与受限页范围解析。用户上传的 PDF 仍走全文；自动获取的年报只解析前 12 页 + 后 68%，覆盖审计意见与财报附注，避免整份年报解析拖慢请求。
- `src/components/FinancialDiagnosisChecklist.js`：独立的一页纸诊断模块。公司画像只保留短标签，三类核心结论独立成区；桌面渲染五列表格，移动端切换为卡片；状态胶囊单独一行；每条支持证据详情展开、单条定向追问和数据缺口提示。表格去掉外框和优先级左侧竖线，使用图标、提亮色块和状态色做层级。状态、优先级、来源和 `⚪ 数据不足` 均由后端结构控制，不靠模型返回 emoji。
- `diagnosis` 结构升级为 `coreContradiction/mainRisk/keyLead + rows[question,evidence[],judgment,nextCheck{what,lookAt,judge},status,source]`；归一化层同时兼容旧版 `metric/current/trend/finding/next`，避免历史本地结果失效。
- `TermAddModal` 是全局右键入口：选中文字后可向纳瓦尔提问或添加词条；全局纳瓦尔 `AskDrawer` 直接挂载在页面根层，避免被隐藏 Tab 的 `display:none` 祖先影响，浮层内容仍受同一右键菜单管理。
- `financialForensics.js` 为 15 类结构化 seed 维护“侦查问题 + 三步核查”模板；AI 输出不足时，由确定性 seed 生成同结构清单，问题、证据和核查路径不依赖模型自由发挥。
- `financialForensics.js` 对现金流等指标增加边际变化分类：首次转负/显著恶化进入 P0，明显改善进入 P1 并生成“为什么改善、能否持续”的问题，持续无变化的旧问题降为背景风险。
- 芒格提示词要求先判断边际变化再排优先级，再基于诊断结果写正文；`diagnosis.rows` 只允许引用三表、年报附注、审计报告或明确的数据不足，并要求 P0 只留给首次出现/显著恶化/资金安全问题、总数 6-10 条、下一步固定三段式。
- 年报/审计报告原始来源优先使用东方财富公告正文接口 `np-anotice-stock.eastmoney.com` / `np-cnotice-stock.eastmoney.com`；附注命中失败时降级为结构化三表 + 数据不足，不编造数字。
- 数据缓存：三表 12 小时、年报/附注证据 7 天、公告列表 24 小时；单次证据包外层超时 22 秒，失败静默降级。
- `withTimeout()` 现在会在 Promise 完成后清理定时器，避免服务端进程因超时定时器悬挂 20 秒以上。
- 当前 A 股优先；港股、美股证据链未接入，仍使用原有系统数据核验并明确边界。

## 微信小程序提审版架构（2026-09-19）

```text
微信小程序（原生 WXML/WXSS/JS）
    ↓ wx.cloud.callFunction
微信云函数 mini-api
    ↓ 时间戳 + nonce + OpenID + 请求体 HMAC-SHA256
Next.js /api/mini/debate 或 /api/mini/reading
    ↓ 输入拦截 → DeepSeek → 输出拦截
结构化学习卡片返回小程序
    ↓
wx.setStorageSync（最多 30 条，仅本机）
```

- `miniprogram/`：原生小程序源码，不依赖 Taro/uni-app，避免额外构建链。
- `miniprogram/config.js`：真实云环境 ID 的配置入口；未配置时前端直接提示，不发起请求。
- `cloudfunctions/mini-api`：小程序唯一云函数入口；动作白名单固定为 `debate` 和 `reading`，不暴露 Web 端其他 API。
- `src/lib/miniProgramPolicy.js`：输入输出合规规则、结构化结果归一化、HMAC 签名与 OpenID 哈希。
- `src/app/api/mini/debate/route.js`：财经圆桌接口；2-4 个学习视角，不拉行情、不做具体证券判断。
- `src/app/api/mini/reading/route.js`：公开材料学习卡片接口；只做摘要、概念和影响维度梳理。
- 安全：小程序不直连 Vercel；云函数请求必须通过时间戳、nonce、OpenID 和请求体 HMAC 校验；重复/篡改/过期请求被拒绝。
- 隐私：OpenID 仅短期用于限流，服务端哈希后存在进程内 Map；问题正文不写入业务数据库；历史记录只在设备本地。
- 类目边界：个人主体选择教育信息展示/信息查询，不申请金融业类目；企业版若接入行情、财报或模拟交易，应独立部署和提审。

## 股票池、联赛持仓历史与基础面历史（2026-09-21）

### 股票池宽表

- `StockPools.js` 根据列定义生成固定 `colgroup` 宽度、冻结偏移和表格总宽；冻结列使用 `position: sticky`，仅保留表格底部横向滚动容器；表格 `border-collapse: separate`，避免 collapse 布局导致 Windows/Chrome 粘性列失效。
- `estimateTextWidth` 按中日韩全角字符、数字、字母和标点分别估算宽度；`adaptiveColumnWidth` 对表头与真实数据取最大值，再叠加排序箭头、单元格内边距和冗余，表头总冗余额外增加 6px。股票名称、机构评级、价位等列会随当前池内容自动变化。
- 冻结数量存于 `thinktank_pool_freeze_cols`，限制 0-5 列；单股移除由 `stockPoolUi.mjs#removeSymbolFromPool` 处理，组件随后调用 Supabase `upsertPoolServer` 覆盖 `symbols`，本地 `thinktank_user_pools` 由既有 effect 持久化。
- 移除股票时同步删除 `thinktank_costs` 中该池、该代码的成本，避免后续重新加入时继承旧成本。

### 大师联赛

- `masterLeagueEngine.mjs#buildPositionHistory` 仅依赖成交记录和最新持仓，按股票重建买入均价、已实现收益、未实现收益和最后一次完整清仓信息。`settleMasterLeague` 将结果挂到每个账户的 `positionHistory`。
- 现金不足导致实际成交 0 股时，`applyTrade` 返回 `blocked: true`；决策状态落为 `skipped`，避免“已执行 0 股”的前端展示。
- `settleMasterLeague` 对同一执行日的计划按“卖出/减仓 → 买入/加仓 → 持有”排序，卖出回笼资金可以在同一开盘批次内供后续买入使用；生成阶段的资金约束仍作为第一道防线。
- `MasterLeague.js` 详情页使用「持仓与变动 / 投资策略历史」两个 Tab；`masterGrid` 改为单列堆叠，收益曲线独占第一行，整个持仓面板（含页签）在曲线下方占满后续整行。持仓 Tab 以 `positionHistory` 为统一数据源合并当前与历史记录，表格标题为「持仓记录」，状态列只映射为「持仓中 / 已清仓」。待执行计划仍在决策数组中，但明确标注“尚未计入当前持仓”，与真实成交状态分离。
- 详情页 Tab 复用功能箱胶囊视觉；`StrategyMasterTabs` 通过头像点击命中检测进入详情，`StrategyBoard` 与 `RandomCommentFeed` 的头像使用 `onOpenMaster` 按钮进入同一详情视图。
- 联赛大师资料以 `LEAGUE_MASTERS` 为单一数据源；详情页姓名字段旁渲染 `era` 年代/国籍标签，不再重复显示“参赛者档案”行；详情正文读取 `biography`，智能体读取精简 `intro`。三位新头像统一上传到 `public/头像` 并由 `sync-avatars.mjs` 同步到 `public/avatars`。
- 详情页 `performanceGrid` 将收益曲线和四项收益指标放在同一卡片中，桌面使用 `1.55fr / 0.75fr` 左右分栏，曲线 SVG 高度固定 190px；`max-width: 980px` 时改为单列，收益指标仍保持 2×2。
- `pagination.mjs#paginateItems` 为通用分页纯函数：验证页码越界夹取、总数、总页数和当前区间。`MasterLeague.js` 使用每页 10 条渲染投资策略历史。
- 投资策略历史按决策展示显式状态标签：`pending → 待执行`、`executed → 已执行`、`skipped → 未执行`；执行日期与未执行原因始终可见。只有产生真实成交的标的才会进入 `positionHistory` 和「持仓记录」。
- 公共底表的账户 `master` JSON 会保留 `positionHistory`；数据库降级读取时即使没有逐笔 `trades`，也能继续展示已保存的清仓记录。

### 鱼大基础面历史

- `fundamentalHistory.mjs` 提供历史归一化、追加、时间排序和按股票分组供筛选项使用；数据只存浏览器 `thinktank_crocodile_fundamental_history_v1`，最多 30 条。每次查询生成一条独立记录，同一股票重复查询会保留多条。
- `CrocodileFundamental.js` 完成研究后同时写入最近状态和股票历史；点击历史记录直接恢复 `result / symbol / note`，不重复调用 AI。历史 UI 为「股票筛选下拉框 + 单层查询记录列表」，不再渲染股票分组卡片，因此每次查询只对应一条可见记录。
- `CrocodileFundamental.js` 加载态复用 `Dice3D`（6 面、`spinning`），CSS `.fnd-loading` 使用 `min-height: 420px`、`align-items: center`、`justify-content: center` 和居中文本。
- 基础面 `findRecentFundamentalHistory` 在每次发起研究前检查本地历史：同一股票 7 天内已有查询结果时，直接恢复该条历史记录并高亮，不消耗免费次数、不调用 `/api/fundamental`。

## 本地查询缓存规则（2026-09-21）

- `browserCache.mjs` 统一提供 `stableHash`、`readJsonCache`、`writeJsonCache`、`marketAwareTtlMs` 和 `researchCacheTtlMs`。缓存键带统一前缀与内容哈希，避免不同模块互相覆盖。
- 行情类：盘中缓存 5 分钟；盘前缓存到当日 09:15；收盘后与周末缓存到下一个工作日 09:15。已接入 `/api/context`、股票联想搜索、行业周期分析和大师联赛公开赛数据（联赛额外封顶 30 分钟，避免收盘任务生成后长时间看不到新计划）。
- 研究/分析类：财报链接结果按“链接 + 补充说明”缓存 7 天；基础面研究同股票 7 天内直接复用历史结果；缠论分析按问题缓存到行情窗口结束；早餐新闻、纳瓦尔期数、选股池评级/区间数据保留既有专用缓存。
- 不缓存：登录态、免费额度、分享状态、用户池写入、邀请/删除等账户与写操作；实时快讯和雷达源仍按各自时效请求，避免把新闻流错误地长期缓存。


## 选股策略大赏（2026-09-26）

- 预置数据：`src/data/strategyGallery.js` 收录 18 条方法型策略，站点不展示“名单股票池”栏目；保留答主、赞数、问题浏览量、原始链接、可执行要点和风险备注。`src/data/strategyDetails.js` 从源汇编提取 119 条详细拆解，按核心逻辑、执行步骤、买卖条件、止损、案例和时效限制分节展示；2 条神回复与 1 条纯观点回答不进入正式榜单。
- 页面：`src/components/StrategyGallery.js` + `StrategyGallery.module.css`，提供热度/最近添加/标题排序、三类筛选、关键词搜索、策略详情抽屉和用户添加流程；作为功能箱第五个 Tab，入口为 `?tab=toolbox&tool=strategy-gallery`。
- 用户策略：`thinktank_strategy_gallery_user_v1` 仅存当前浏览器 localStorage，最多 100 条，不写入公共数据库，删除也在本机完成。
- 提取接口：`POST /api/strategy-extract`。链接必须先通过 http(s)、内网/本机地址和 DNS 校验；抓取最多 4 次跳转、1.5MB 页面、12 秒超时，并限制正文长度，避免 SSRF、超时和大页面拖垮服务。
- 提取降级：公开链接抓取失败时，用户可粘贴正文继续；无正文或正文过短会返回 422，不伪造策略。AI 只允许引用给定页面/粘贴正文，输出再次归一化并限制字段长度。
- 成本与安全：提取复用 `generateJson` 与 BYOK/免费额度/按 IP 限流；用户 Key 不落库。AI 结构化数据固定保留用户输入链接，用户可在保存前编辑核对。
- 自动化测试：`scripts/strategy-extraction.test.mjs` 覆盖 HTML 清洗、私网地址拦截、字段归一化和 18 条预置数据完整性；请求命令 `npm test`。

## 分析结果分享链接（2026-09-26）

```text
大师PK / 巴菲特早餐 / 芒格财报结果
    ↓ 前端序列化为类型化快照
POST /api/share-results
    ↓ 递归移除敏感字段 + 类型/大小校验
Supabase share_results（service_role 写入）
    ↓ 随机 24 位不可枚举 ID
/share/[id]（服务端读取，公开只读）
    ↓
大师PK原发言 / 早餐原步骤 / 财报原诊断
```

- `src/lib/shareResults.mjs`：类型白名单、递归脱敏、大小限制、三类结果快照构建函数和纯函数测试入口。
- `src/app/api/share-results/route.js`：生成分享链接；按 IP 每小时 30 次限流，错误区分参数错误、服务未初始化和数据库异常。
- `src/lib/shareResultsDb.js`：生产使用 `SUPABASE_SERVICE_ROLE_KEY` 读写 `share_results`；本地开发使用进程内 Map，避免本机网络不可达时阻塞，不用于生产持久化。
- `src/app/share/[id]/page.js`：公开动态只读页；服务端按随机 ID 查询，设置 `noindex`，不要求登录。
- `ShareResultButton` 只提交当前结果快照；分享页不暴露原应用状态、用户股票池、API Key 或上传文件 Base64。
- `supabase/share_results.sql` / `supabase/schema.sql`：创建 `share_results`，RLS 开启但不向 anon/authenticated 授权；仅 service_role 有 select/insert 权限，避免通过公开 anon key 枚举分享数据。
- 分享链接是不可变快照：原分析重新生成不会回写旧链接；当前不做撤回、过期、浏览计数和跨设备管理。
