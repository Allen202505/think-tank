# 大师吵股（think-tank）· AI 投资大师智囊团

一个开源的 AI 投资分析工具：汇聚巴菲特、芒格、缠中说禅等投资大师，用 AI 模拟大师辩论、新闻解读、财报拆解与短线分析。

> ⚠️ 本项目完全开源、免费。所有内容由 AI 生成，仅供学习交流与娱乐参考，**不构成任何投资建议或意见**，据此操作风险自负。

## 功能

| 模块 | 说明 |
|---|---|
| ⚔️ 大师PK | 向多位"投资大师"提问，AI 模拟大师公开辩论并给出裁决 |
| 📰 巴菲特的早餐 | 新闻事件穿透解读 + 你的股票池新闻 |
| 📖 芒格教你读财报 | 财报丢给芒格：系统数据核验，拆穿数字里的水分 |
| 🧘 缠中说禅看短线 | 缠论视角的短线走势评估 |
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

## BYOK：自带 API Key

本项目免费，但站长不承担所有用户的模型调用成本：

- 每位访客默认有 **2 次免费体验**（用站长的 Key）
- 2 次用完后，点击页面的「🔑 AI 设置」，填入**你自己的 API Key**
- 支持 DeepSeek / OpenAI / Kimi / 通义千问 / 任意 OpenAI 兼容服务（Base URL 与模型名都可自定义）
- **你的 Key 只保存在你自己的浏览器本地（localStorage）**，请求时即用即弃，不会上传保存到服务器

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
