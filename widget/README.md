# 大师吵股 · 桌面组件（widget）

面向「大师吵股」（think-tank）的桌面小组件：自选股行情速览、7×24 快讯、快速提问入口。
目标：把网站搬进用户桌面，每天被动触达 3-5 次 → 点击回流 → 提升日活与提问转化。

## 快速预览（网页形态，无需 Rust）

```bash
cd widget
python3 -m http.server 4111
# 浏览器打开 http://localhost:4111
```

- 行情：腾讯实时直连（CORS 友好），东财批量接口做快路径，失败自动降级
- 快讯：站点 `/api/news`（已加 CORS）→ 本地联调可用 `?api=http://localhost:3210` 指定地址
- 站点地址默认 `https://yieldglide.com`，可用 `?api=` 或 `localStorage['widget.apiBase']` 覆盖

## 跑成真正的桌面 App（Tauri 2）

```bash
# 1) 安装 Rust（https://rustup.rs，Mac 上 Xcode 已就绪）
# 2) 安装 Tauri CLI
cd widget
npm i -D @tauri-apps/cli@^2
# 3) 启动桌面开发窗口
npx tauri dev
```

macOS 菜单栏 / Windows 托盘：关闭窗口会隐藏到托盘，托盘菜单可「显示 / 隐藏 / 退出」；
所有跳转链接交给系统浏览器打开。

打包分发：`npx tauri build`（Mac 出 .app/.dmg，Windows 出 .msi/.exe）。

## 目录结构

```
widget/
  index.html / styles.css / app.js   # 组件前端（纯静态，无构建依赖）
  favicon.png                        # 组件图标（复用站点 favicon）
  src-tauri/                         # Tauri 桌面壳
    tauri.conf.json                  # 窗口 380×620 + 托盘
    src/lib.rs                       # 托盘菜单、关闭隐藏、open_url 命令
```

## 与网站配合（已做/待做）

- [x] `src/lib/cors.js` + `/api/news` 加 CORS 头，组件可直连站点 API
- [ ] 站点支持 `?q=` 参数预填「大师PK」问题（组件「问大师」直达提问）
- [ ] `/api/widget/quotes`：服务端聚合行情（东财→腾讯→新浪），组件统一走站点，便于埋点统计
- [ ] 回流埋点：组件跳转带 `utm_source=desktop_widget`，看「曝光→点击→进站→提问」漏斗
- [ ] 用户自选股同步：登录 Supabase 后组件读「我的股票池」
- [ ] 价格/新闻提醒（本地定时检查 + 系统通知）

> 免责声明：行情与 AI 内容仅供学习交流，不构成投资建议。
