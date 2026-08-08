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
│   └── app/
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
- `src/app/api/chat/quoteContext.js`: 解析问题里的公司，生成「最新行情+财务快照」注入 AI
- `src/app/api/chat/route.js`: DeepSeek 代理，调用 quoteContext 注入最新数据

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
