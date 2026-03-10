# 决策记录

## 2026-03-04

### 百度 SEO 配置
**背景**: 希望网站能被百度收录，让更多中文用户找到

**已完成**:
- ✅ 网站已有 sitemap.js 和 robots.js 配置
- ✅ sitemap.xml 可正常访问: https://www.yieldglide.com/sitemap.xml
- ✅ robots.txt 已包含 Sitemap 声明
- ✅ 百度站长平台完成站点验证

**待处理**:
- ⏳ 百度站长平台 sitemap 提交（输入框置灰，可能需要等待 1-24 小时权限开放）
- ⏳ 可选：使用"手动提交"方式先提交首页
- ⏳ 等待百度抓取（预计 1-3 天开始抓取，1-2 周开始收录）

**决策**:
- 采用被动等待策略，不强制手动提交
- sitemap 当前只包含首页，后续可扩展到更多页面
- 通过百度站长平台监控"抓取频次"和"索引量"

**技术细节**:
- 服务器位置: Vercel（国外）
- CDN: Cloudflare（全球加速）
- DNS: 指向 Cloudflare
- 影响: 国外服务器 + 无 ICP 备案，收录速度会比国内慢，但可以收录

---

### 创建记忆系统
**背景**: 需要一个持久化的记忆系统，在 AI 失忆时能快速恢复上下文

**决策**:
- 创建 `/memory` 文件夹存放所有记忆文件
- 分为三个文件：
  - `project.md`: 项目不变的基本信息
  - `architecture.md`: 当前系统架构
  - `log.md`: 按时间记录的决策日志（本文件）

**原则**:
- 记录关键决策和背景
- 记录技术选型原因
- 记录待办事项和进度
- 保持简洁，只记录重要信息

**重要规则**:
- ⚠️ **每次执行完动作后，必须更新 memory 文件**
- 将新的决策、修改、配置记录到 `log.md`
- 如果架构有变化，更新 `architecture.md`
- 如果项目基本信息有变化，更新 `project.md`

---

## 2026-03-10

### Google SEO：修复规范网址冲突（www vs 非 www）
**背景**: Google Search Console 提示 `https://www.yieldglide.com/` 为「备用页面（有适当的规范标记）」，Google 选择的规范网址是 `https://www.yieldglide.com/`（带 www），与页面声明的 `https://yieldglide.com/`（不带 www）不一致，导致首页无法被正常收录。

**决策**: 统一使用不带 www 的版本 `https://yieldglide.com/` 作为规范网址（方案 A）。

**实现**:
- 创建 `/vercel.json`，添加 301 重定向规则：所有 `https://www.yieldglide.com/:path*` 的请求永久跳转到 `https://yieldglide.com/:path*`
- `layout.js` 中 `canonical: '/'` + `metadataBase: https://yieldglide.com` 已正确配置，无需修改
- 提交并推送到 GitHub，Vercel 自动部署生效

**影响**:
- `https://www.yieldglide.com/` 现在会 301 跳转到 `https://yieldglide.com/`
- Google 重新抓取后会统一认定 `https://yieldglide.com/` 为主版本
- GSC 中「备用页面」「会自动重定向」提示预计数天至数周内消失

**待办**:
- ⏳ 等待 Google 重新抓取（预计 1-2 周）
- ⏳ 在 GSC「网址检查」对 `https://yieldglide.com/` 点击「请求编入索引」（已操作）
- ⏳ 观察 GSC 收录数量是否恢复正常

---

### 部署后：大师头像丢失 + 重定向死循环（ERR_TOO_MANY_REDIRECTS）
**背景**:
- 部署后部分大师真实头像丢失（图片加载失败）。
- 浏览器 Console 报错：`Failed to load resource: net::ERR_TOO_MANY_REDIRECTS`，涉及 `/avatars/*.jpg` 与 `/favicon.ico`。

**决策**:
- 头像资源统一使用 ASCII 路径 `/avatars/*`，避免中文路径 `/头像/*` 在部分部署/CDN 环境兼容性问题。
- 站点规范域名继续统一为 **非 www**：`https://yieldglide.com/`。

**实现**:
- 代码侧（已推送到 GitHub）：
  - `src/data/masters.js`：预置大师头像从 `/头像/*.jpg` 改为 `/avatars/*.jpg`。
  - `scripts/sync-avatars.mjs`：构建前把 `public/头像` 同步复制到 `public/avatars`。
  - `package.json`：新增 `prebuild` 执行同步脚本。
- 排查发现线上重定向互相打架导致死循环：
  - Cloudflare：将 `yieldglide.com/*` 重定向到 `www.yieldglide.com/*`（非 www → www）。
  - Vercel（`vercel.json`）：将 `www.yieldglide.com/*` 重定向到 `yieldglide.com/*`（www → 非 www）。
  - 结果：两边互相 307/308，导致资源加载失败，页面可能出现“纯黑/无内容”的假象。

**影响**:
- 只要重定向死循环存在，头像/favicon/静态资源都会加载失败，用户体验和 SEO 都会受影响。

**待办**:
- ✅ 选择 **非 www** 为主域名的前提下：到 Cloudflare 关闭/删除 “非 www → www” 的跳转规则，只保留 Vercel 的 “www → 非 www”。
- （可选）Cloudflare 清缓存（Purge）后再验证 `https://yieldglide.com/favicon.ico` 与 `https://yieldglide.com/avatars/buffett.jpg` 返回 200 且不再跳转。

---

### Todo App：新增“归档已完成任务”能力（后端 Spring Boot + 前端 React）
**背景**: 需要把已完成的 Todo 归档隐藏在主列表中，并提供一个“Archived”视图查看归档内容；同时提供“一键归档所有已完成”的操作。

**决策**:
- 在 Todo 模型中新增 `isArchived` 字段作为归档标记。
- 后端提供按归档状态筛选的查询能力，并提供批量归档已完成 Todo 的专用接口。
- 前端增加“Archive Completed”按钮与“Show Archived / Show Active”切换，以两种视图展示数据。

**实现**:
- 后端（Spring Boot / JPA）：
  - `Todo` 实体：新增 `isArchived` 字段及 getter/setter。
  - `TodoRepository`：新增 `findByCompletedTrue()`、`findByIsArchivedTrue()`、`findByIsArchivedFalse()`。
  - `TodoService`：
    - `getAllTodos(showArchived)`：按归档状态返回 active/archived 列表。
    - `updateTodo`：允许更新 `isArchived`。
    - `archiveCompletedTodos()`：把所有 completed=true 的记录批量设置 `isArchived=true` 并保存。
  - `TodoController`：
    - `GET /api/todos?showArchived=false|true`：按参数返回 active/archived。
    - `POST /api/todos/archive-completed`：触发批量归档。
  - `application.properties`：设置 `spring.jpa.hibernate.ddl-auto=update` 以便新增列自动更新到数据库。
- 前端（React）：
  - `client/src/App.js`：新增 `showArchived` 状态；请求时携带 `showArchived`；增加两个按钮（归档已完成、切换视图）。
  - 依赖：安装 `axios` 用于 API 调用。

**影响**:
- Active 视图默认不再展示归档 Todo；Archived 视图可查看历史归档。
- 批量归档避免前端逐条更新，接口更清晰。

**验收**:
- 页面可打开无报错；归档/切换视图功能已验证可用（用户反馈）。

---

### 站点 UI：在主题切换旁新增“我的二维码”
**背景**: 需要在页面显眼位置提供个人二维码入口，方便用户扫码（例如公众号/社群/个人号）。

**决策**: 将二维码入口放在首页右上角，与深浅色主题切换并列，减少打扰但容易找到。

**实现**:
- `src/app/page.js`：
  - header 右上角新增二维码按钮（与主题按钮同一操作区）。
  - 点击弹出二维码浮层，支持按 `Esc` 或点击空白处关闭。
  - 二维码图片来源约定：
    - 默认读取 `public/my-qr.png`
    - 或通过环境变量 `NEXT_PUBLIC_QR_CODE_URL` 指向外部二维码图片 URL
  - 若图片缺失/加载失败，会显示替换提示。

**影响**: UI 增加一个轻量入口，不改变现有业务逻辑；可在不改代码的情况下替换二维码（放文件或改环境变量）。

**待办**:
- ~~把二维码图片文件放入 `public/my-qr.png`（推荐），或设置 `NEXT_PUBLIC_QR_CODE_URL`。~~ ✅ 已完成（见下条）

---

### 二维码图片路径修复：.png → .jpg
**背景**: 用户将二维码图片 `my-qr.jpg` 放入 `public/` 目录，但代码默认读取路径为 `/my-qr.png`，导致图片加载失败。

**决策**: 将代码中硬编码的默认路径从 `.png` 改为 `.jpg`，与实际文件名保持一致。

**实现**:
- `src/app/page.js`：
  - `qrSrc` 默认值：`'/my-qr.png'` → `'/my-qr.jpg'`
  - 兜底提示文字：`public/my-qr.png` → `public/my-qr.jpg`
- `public/my-qr.jpg` 文件已由用户放入 `public/` 目录。

**影响**: 点击右上角 `⌁` 按钮，二维码图片可正常加载显示。

**待办**: 无。

---

## 模板（新增记录时使用）

```markdown
## YYYY-MM-DD

### 标题
**背景**: 为什么要做这件事

**决策**: 做了什么决定

**实现**: 具体怎么做的

**影响**: 对项目有什么影响

**待办**: 还有什么要做的
```
