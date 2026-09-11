# SEO 策略与可搜索性改进方案

> **状态**：调研完成，待执行
> **日期**：2026-08-13
> **背景**：项目在公网上近乎不可被搜索到，本文档记录诊断结论、竞品调研、技术方案选型和分优先级行动计划。

---

## 一、现状诊断

### 1.1 线上资产

| 资产 | 地址 | 状态 |
|------|------|------|
| GitHub 仓库 | `github.com/honlnk/gpt-image-studio` | ✅ 在线，23 ⭐ / 3 🍴，0 topics |
| 在线体验站 | `image.honlnk.com` | ✅ 在线（GitHub Pages + 自定义域名） |
| npm 包 | `@honlnk/image-studio-companion` | ✅ 在线，上月 785 次下载 |
| Docker 镜像 | `ghcr.io/honlnk/*` + Docker Hub | ✅ 在线 |

### 1.2 搜索引擎收录情况

| 搜索引擎 | GitHub 仓库 | image.honlnk.com | npm 页面 |
|----------|------------|------------------|----------|
| **Google** | ⚠️ 带 "honlnk" 可搜到，`site:` 精确查询未返回 | ⚠️ 有索引痕迹但不完整 | ❌ 未收录 |
| **Bing** | ✅ 收录 | ✅ 收录（`site:image.honlnk.com` 返回多条） | 未测 |
| **百度** | ❓ 未验证 | ❓ 未验证 | ❓ 未验证 |

### 1.3 核心问题

#### 问题 1：SPA 零内容，爬虫看到的是空壳

`image.honlnk.com` 返回的 HTML 原文：

```html
<title>GPT Image Studio</title>
<body>
  <div id="app"></div>   ← 空，所有内容靠 JS 渲染
</body>
```

- 没有 `<meta name="description">`
- 没有 OG / Twitter Card 标签
- 没有结构化数据（JSON-LD）
- 没有任何可被爬虫索引的正文文字

#### 问题 2：无 robots.txt、无 sitemap.xml

```
/robots.txt  → 返回 index.html（SPA 404 fallback）
/sitemap.xml → 返回 index.html（同上）
```

#### 问题 3：GitHub 仓库无 topics 标签

```json
"topics": []   ← 空，GitHub Topics 页面完全错过
```

#### 问题 4：无外部反向链接

搜索结果中没有任何第三方文章、博客、推荐列表提到本项目。唯一的外部引用是作者自己的 `blog.honlnk.com`。

#### 问题 5：名称撞车严重

"GPT Image Studio" 是非常通用的名字，公网存在多个同名/近似竞品：

| 竞品 | 域名 | 类型 |
|------|------|------|
| GPT Image Studio (prompt gallery) | `gptimagestudio.com` | Next.js SSG |
| GPT Image 2 Studio (SaaS) | `gpt-image2ai.com` | Next.js SSG，SEO 标杆 |
| GPT-Image-2 Studio (aibasecamp) | `gptimage.aibasecamp.asia` | SPA |
| ChatGpt Image Studio (Go 项目) | 80aj.com 报道 | 不同项目，名称撞车 |

搜 "GPT Image Studio" 不带 "honlnk" 时，本项目完全不出现。

### 1.4 各爬虫对 SPA 的处理能力

| 爬虫 | 能否渲染 JS | 可靠性 | 说明 |
|------|------------|--------|------|
| **Googlebot** | ✅ 能，但有延迟 | 中等 | 三阶段：抓取 → 渲染 → 索引；渲染队列等待秒到天不等 |
| **Bingbot** | ⚠️ 能但很弱 | 低 | 5 秒超时，JS 依赖内容大概率拿不到；仍推荐 dynamic rendering |
| **百度 Baiduspider** | ⚠️ 极有限 | 极低 | SPA 收录率比传统站低 30-50%；不等待异步加载完成 |
| **社交爬虫**（微信/FB/X） | ❌ 不执行 JS | 零 | 分享链接无预览图、无标题描述 |
| **AI 爬虫**（GPTBot/ClaudeBot） | ❌ 不执行 JS | 零 | AI 搜索引擎（豆包/DeepSeek/Kimi）推荐不到本项目 |

**Google 官方立场**（2024-2025）：
- 已废弃 dynamic rendering，推荐 SSR 或 SSG。
- 仍建议在初始 HTML 中提供内容，不依赖 JS 渲染。
- 百度官方也承认 JS 渲染能力有限，建议 SSR/预渲染。

---

## 二、竞品分析

### 2.1 竞品对标矩阵

| 维度 | 我们 | gpt-image2ai.com | gptimagestudio.com | xianyu110 (GH Pages) |
|------|------|-------------------|--------------------|-----------------------|
| 渲染方式 | 纯 SPA（空 div） | Next.js SSG（完整 HTML） | Next.js SSG | 静态 HTML |
| meta description | ❌ 无 | ✅ 关键词丰富 | ✅ | ✅ 中文 |
| OG/Twitter 标签 | ❌ 无 | ✅ 完整 | ✅ 完整 | ❌ |
| 结构化数据 | ❌ 无 | ✅ 4 种 schema | ⚠️ 少量 | ❌ |
| sitemap.xml | ❌ 无 | ✅ 50+ URL，11 语言 | ✅ 双语 | ❌ |
| robots.txt | ❌ 无 | ✅ | ✅ | ❌ |
| 博客/内容 | ❌ 无 | ✅ 20+ SEO 文章 | ✅ 提示词画廊 | ❌ |
| 外链 | ❌ 零 | ✅ 18+ 目录徽章 | 未知 | GitHub 域名 |
| GitHub topics | ❌ 0 个 | N/A | N/A | N/A |
| **可抓取内容** | **零** | **完整** | **完整** | **部分** |

### 2.2 标杆竞品：gpt-image2ai.com

这是 SEO 做得最好的竞品，值得逐项学习：

- **技术栈**：Next.js SSG，输出完整 HTML。
- **i18n**：11 语言 + hreflang alternate 标签，50+ URL 的 sitemap。
- **结构化数据**（JSON-LD）：
  - `Organization` — name, alternateName, url, logo
  - `WebSite` — name, url, publisher
  - `SoftwareApplication` — applicationCategory: GraphicsApplication
  - `FAQPage` — 6 组 Q&A（可赢得 Google FAQ 富文本结果）
- **URL 策略**：关键词丰富的路径（`/text-to-image/gpt-image-2`、`/image-to-image/gpt-image-2`）。
- **内容**：20+ 篇 SEO 博客（如 "gpt-image-2-vs-midjourney"、"gpt-image-2-prompt-templates"）。
- **外链**：提交了 18+ AI 工具目录，每个目录提供一个 dofollow 反向链接，站点展示 "Featured on" 徽章作为交换。
- **robots.txt**：disallow `/settings/*`、`/activity/*`、`/admin/*`、`/api/*`。

### 2.3 其他竞品

- **gptimagestudio.com**：拥有精确匹配域名，双语 (EN/ZH) Next.js SSG，内容是提示词画廊（18+ 模板页），非真正的图片生成工具。
- **xianyu110.github.io/gpt-image-2-web**：静态 HTML（可抓取），中文 meta description，GitHub Pages 子域名（低域名权重），无 sitemap/结构化数据。
- **80aj.com 报道的 "ChatGpt Image Studio"**：是一个不同的 Go+Vite 项目（号池复用），非我们的 Vue 项目，名称撞车是问题。
- **gptimage.aibasecamp.asia**：与我们一样的 SPA 空壳问题，甚至更差（加载超时）。

### 2.4 开源 AI 图片工具的发现路径

| 项目 | Stars | 发现路径 |
|------|-------|---------|
| **ComfyUI** | 127K | 零营销预算，纯社区驱动（Reddit 160K、Discord 51K、6 万+ 自定义节点）；README 命名具体模型（Flux, SDXL, Wan）匹配搜索 |
| **Automatic1111** | 164K | 16 个 GitHub topics 覆盖所有搜索变体（`ai-art`, `text2image`, `img2img` 等）；先发优势 + Reddit 社区 |
| **Fooocus** | 52K | 定位差异化（"学 Midjourney 的简单，学 SD 的开源"）；YouTube 教程 + Reddit 传播；有维基百科词条 |

**GitHub Trending 算法**：优先看 star 增速而非总量。全语言 Trending 需 80-150 star/天，TypeScript 专项需 30-60 star/天。48 小时内多平台协调发布（Show HN + Reddit + Twitter/X + Product Hunt）可以复合放大势能。

---

## 三、技术方案选型

### 3.1 约束条件

- Vue 3 SPA（无 vue-router，单视图）
- Vite 构建
- GitHub Pages 静态托管（无服务端运行时）
- 自定义域名 `image.honlnk.com`

GitHub Pages 不能运行服务端中间件，因此 dynamic rendering 和 SSR 都不可行。**唯一正确方向是构建时预渲染（SSG）**。

### 3.2 方案对比

| 方案 | 改动量 | 效果 | 适合场景 |
|------|--------|------|----------|
| **A. 静态 meta 注入** | 极小（只改 index.html） | 爬虫能看到 meta 标签和 JSON-LD，但看不到正文内容 | 最低成本起步 |
| **B. vite-ssg 单页预渲染** | 中等（重构 main.ts） | 爬虫看到完整渲染后的 HTML 内容 | **推荐方案** |
| **C. Playwright 构建后预渲染** | 小（加构建脚本） | 同 B，零代码重构 | 备选方案 |

### 3.3 方案 A：静态 meta 注入（P0，立即可做）

直接在 `index.html` 的 `<head>` 中写入完整 SEO 元信息。不需要改任何 Vue 代码。

**要添加的内容**：

```html
<!-- meta description + keywords -->
<meta name="description" content="本地优先的 AI 图片创作工作台。通过聊天式界面调用 OpenAI 兼容 Images API，生成和编辑图片。数据本地存储，无需后端。Local-first AI image creation workbench.">
<meta name="keywords" content="AI图片生成,AI绘图,文生图,图生图,AI image generation,GPT image,OpenAI Images API,text-to-image,image editing,local-first,self-hosted,open source,Vue 3">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:title" content="GPT Image Studio - 本地优先的 AI 图片创作工作台">
<meta property="og:description" content="通过聊天式界面调用 OpenAI 兼容 Images API，生成和编辑图片。数据本地存储，无需后端。">
<meta property="og:url" content="https://image.honlnk.com">
<meta property="og:image" content="https://image.honlnk.com/og-image.png">
<meta property="og:site_name" content="GPT Image Studio">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="GPT Image Studio">
<meta name="twitter:description" content="Local-first AI image creation workbench">
<meta name="twitter:image" content="https://image.honlnk.com/og-image.png">

<!-- canonical -->
<link rel="canonical" href="https://image.honlnk.com">
```

**JSON-LD 结构化数据**（直接放在 `<head>` 内）：

```html
<!-- WebApplication schema -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "GPT Image Studio",
  "applicationCategory": "DesignApplication",
  "operatingSystem": "Web Browser",
  "url": "https://image.honlnk.com",
  "description": "Local-first AI image creation workbench. Generate and edit images with OpenAI-compatible APIs, all data stored locally in your browser.",
  "softwareVersion": "1.1.0",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "featureList": [
    "AI image generation",
    "Image editing with reference images",
    "Mask-based local editing",
    "Local-first IndexedDB storage",
    "Multi-provider support",
    "Desktop app via Tauri"
  ],
  "screenshot": "https://image.honlnk.com/og-image.png",
  "author": {
    "@type": "Organization",
    "name": "honlnk",
    "url": "https://github.com/honlnk"
  }
}
</script>

<!-- FAQPage schema（可赢得 Google FAQ 富文本结果） -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "GPT Image Studio 是什么？",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "GPT Image Studio 是一个本地优先的 AI 图片创作工作台，通过聊天式界面调用 OpenAI 兼容 Images API 生成和编辑图片，所有数据保存在浏览器本地。"
      }
    },
    {
      "@type": "Question",
      "name": "数据存储在哪里？是否安全？",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "浏览器直连模式下，所有数据（聊天记录、图片、设置）保存在浏览器 IndexedDB 中，不上传到任何服务器。Companion 模式下数据保存在本机 SQLite 中。API key 不写入备份文件。"
      }
    },
    {
      "@type": "Question",
      "name": "需要后端服务吗？",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "不需要。浏览器直连模式完全在浏览器中运行，无需后端。如需保护 API 凭据或多人共用，可选接入本地 Companion 服务或部署为服务器模式。"
      }
    }
  ]
}
</script>
```

**robots.txt**（放 `public/robots.txt`）：

```
User-agent: *
Allow: /

Sitemap: https://image.honlnk.com/sitemap.xml
```

**sitemap.xml**（放 `public/sitemap.xml`）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://image.honlnk.com/</loc>
    <lastmod>2026-08-13</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
```

### 3.4 方案 B：vite-ssg 单页预渲染（P1，推荐）

```bash
pnpm add -D vite-ssg @unhead/vue
```

重构 `src/main.ts`：

```ts
import { ViteSSG } from 'vite-ssg'
import App from './App.vue'
import { createPinia } from 'pinia'

export const createApp = ViteSSG(
  App,
  // 单页模式，不需要 vue-router
  (ctx) => {
    const { app } = ctx
    app.use(createPinia())
    // 其他插件初始化...
  },
)
```

构建时 vite-ssg 使用 Vue 的 `renderToString` 把根组件渲染成完整 HTML，写入 `dist/index.html`。爬虫拿到的不再是空 div，而是完整渲染后的页面内容。产物仍是纯静态文件，完全兼容 GitHub Pages。

**注意事项**：
- `main.ts` 中的初始化逻辑需要适配 SSG 上下文（避免在模块顶层访问 `window` / `localStorage` 等浏览器 API）。
- qiankun 嵌入逻辑需要条件判断（SSG 构建时不在 qiankun 容器内）。
- IndexedDB hydrate 逻辑不应在 SSG 阶段执行。

### 3.5 方案 C：Playwright 构建后预渲染（P1，备选）

零代码重构，加一个构建后脚本：

```js
// scripts/prerender.mjs
import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const DIST = path.resolve('dist')
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('file://' + path.join(DIST, 'index.html'), { waitUntil: 'networkidle' })
const html = await page.content()
await writeFile(path.join(DIST, 'index.html'), html)
await browser.close()
```

```json
// package.json
"build": "vite build && node scripts/prerender.mjs"
```

**缺点**：CI 需要 Chromium 依赖；构建变慢。

### 3.6 验证工具

部署后使用以下工具验证：

| 工具 | 用途 |
|------|------|
| [Google Rich Results Test](https://search.google.com/test/rich-results) | 验证 JSON-LD 结构化数据 |
| [Schema Markup Validator](https://validator.schema.org/) | 验证 schema.org 标记 |
| [Google Search Console](https://search.google.com/search-console) | 提交 sitemap、监控索引状态、查看搜索查询 |
| [Bing Webmaster Tools](https://www.bing.com/webmasters) | 同上，针对 Bing |
| [百度搜索资源平台](https://ziyuan.baidu.com) | 提交 URL、抓取诊断（针对百度） |
| `curl -A "Baiduspider" https://image.honlnk.com/` | 模拟百度爬虫查看返回内容 |

---

## 四、关键词策略

### 4.1 避开的词（竞争过于激烈）

以下词被 Midjourney、Canva、DALL-E、ChatGPT 官方等 DR 80+ 站点垄断，新站无法竞争：

- "AI图片生成" / "AI image generator" / "AI图片生成器"
- "GPT image" / "GPT图片"
- "AI绘图" / "AI绘画" / "AI画图"
- "text to image" / "文生图"（通用词）

### 4.2 应该占领的词（差异化定位）

#### 英文长尾关键词

| 关键词 | 竞争度 | 我们的优势 |
|--------|--------|-----------|
| local-first AI image generation | 低 | 无竞品，ComfyUI/A1111 是本地安装但 Python 重 |
| self-hosted AI image generator | 低 | Docker 部署 |
| OpenAI Images API tutorial | 低 | 开发者意图，完整实现 |
| browser-based AI image generation no backend | 极低 | 独特卖点 |
| open source AI image editor with mask editing | 极低 | 遮罩编辑功能 |
| AI image generation with own API key | 低 | 隐私卖点 |
| ComfyUI alternatives | 中 | 可在 AlternativeTo 获取反链 |
| Stable Diffusion WebUI alternatives | 中 | 同上 |
| Midjourney open source alternative | 中 | 对比文章长尾词 |

#### 中文长尾关键词

| 关键词 | 竞争度 | 我们的优势 |
|--------|--------|-----------|
| 本地优先 AI图片生成 | 极低 | 无竞品 |
| 自部署 AI生图 | 低 | Docker 一键部署 |
| OpenAI兼容API图片生成客户端 | 极低 | 精准匹配 |
| 使用自己的API密钥生成AI图片 | 低 | 隐私卖点 |
| 不需要后端的AI绘图工具 | 极低 | 独特卖点 |
| Docker部署AI图片生成 | 低 | 完整方案 |
| 浏览器本地存储AI绘图 | 极低 | 技术差异 |
| AI图片局部编辑工具 | 低 | 遮罩编辑 |

### 4.3 核心定位

**"local-first"（本地优先）是无人占领的定位。**

- ComfyUI / Automatic1111 / Fooocus：本地安装，但面向 Python / Stable Diffusion 生态。
- gpt-image2ai.com / 其他 SaaS：云端服务，无法宣称 local-first。
- 本项目：浏览器内本地优先，面向 OpenAI API 生态，数据不离开浏览器。

**一句话价值主张**：Your images never leave your browser. / 你的图片永远不会离开浏览器。

---

## 五、外链与分发策略

### 5.1 反向链接（按 ROI 排序）

#### 第一梯队：立即可做（高权重 dofollow）

| 平台 | DR | 操作 |
|------|-----|------|
| AlternativeTo | 76 | 注册为 Midjourney / DALL-E / ComfyUI / SD WebUI 的替代品 |
| SaaSHub | 76 | 同上 |
| Product Hunt | 91 | 准备 launch day（maker comment、gallery、hunter） |
| Hacker News (Show HN) | 90+ | "Show HN: GPT Image Studio – local-first AI image workbench" |
| There's An AI For That | 80+ | AI 工具目录提交 |
| Futurepedia | 75+ | AI 工具目录提交 |
| SourceForge | 93 | 开源软件目录 |

#### 第二梯队：awesome lists（GitHub 内被动发现）

提交 PR 到以下 GitHub 精选列表：

- `awesome-ai-tools`
- `awesome-image-generation`
- `awesome-open-source-ai-tools`
- `awesome-vue`
- `awesome-tauri`
- `awesome-selfhosted`

这些列表通常有数千 star，提供持续被动流量。

#### 第三梯队：中文社区（面向中文用户）

| 平台 | 策略 |
|------|------|
| 知乎 | 回答 "有哪些好用的AI图片生成工具？" 类问题 |
| 掘金 | 写技术文章（架构设计、实现原理） |
| V2EX | `/go/share` 分享开源项目 |
| Linux.do | 开发者社区，80aj 等科技博客从此抓内容 |
| B站 | 录屏教程视频 |
| 小红书 | AI 生图作品展示 |
| 少数派 | 工具评测 / 教程 |
| SegmentFault | 技术文章 |

### 5.2 GEO（生成式引擎优化）

越来越多用户通过豆包、DeepSeek、Kimi、ChatGPT 等 AI 搜索而非传统搜索引擎。要让 AI 推荐本项目：

- 在**知乎**、**搜狐号**发布内容（AI 爬虫高频抓取这些平台）。
- 写 AI 友好的内容：**结论先行**、3-5 行短段落、FAQ 格式。
- 每篇文章直接回答一个用户问题（如 "有没有不用上传图片到服务器的 AI 生图工具？"）。
- 发布 10+ 篇文章后 1-2 周可见效。

### 5.3 GitHub 仓库优化

**Topics**（加满 20 个）：

```
ai-image-generation, openai, gpt-image, text-to-image, image-editing,
vue, vue3, typescript, tailwindcss, local-first, offline-first,
tauri, docker, self-hosted, indexeddb, pinia, vite, ai-art,
open-source, companion
```

**Description** 改为中英双语：

```
Local-first AI image creation workbench | 本地优先的 AI 图片创作工作台
```

**README 优化**：
- 顶部加 2-3 句英文摘要（GitHub 搜索对英文索引更好）。
- 加 GIF / 截图演示。
- 加 Star History 图表。
- 加 Docker pulls / npm downloads 徽章。
- 加 "Who's using it" / "Integrations" 段落（促进反向链接）。

### 5.4 package.json 补全

当前主项目 `package.json` 缺少 `description`、`keywords`、`homepage`、`repository` 字段。npm 页面会被 Google 收录，补全后可带来发现性：

```json
{
  "description": "Local-first AI image generation workbench. Chat-based interface for OpenAI-compatible Images API with mask editing, prompt modes, and multi-provider support.",
  "keywords": ["ai-image-generation", "openai", "gpt-image", "image-generation", "text-to-image", "image-editing", "vue", "vue3", "typescript", "local-first", "self-hosted", "ai-art"],
  "homepage": "https://image.honlnk.com",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/honlnk/gpt-image-studio.git"
  }
}
```

Companion 包的 keywords 也应扩展，增加 `ai-image`、`image-generation`、`text-to-image`、`local-first`、`credential-management` 等。

### 5.5 搜索引擎站长平台

| 平台 | 操作 |
|------|------|
| Google Search Console | 验证域名所有权、提交 sitemap、监控索引状态、查看搜索查询 |
| Bing Webmaster Tools | 同上，针对 Bing |
| 百度搜索资源平台 | 主动提交 URL、使用抓取诊断验证百度爬虫实际看到的内容 |

---

## 六、内容策略

### 6.1 架构选择：App 与内容分离

当前 SPA 不适合作为 SEO 内容载体。推荐**内容漏斗架构**（参考 Excalidraw / tldraw）：

```
Landing page（SEO 优化，静态 HTML）
  → links to App（SPA，image.honlnk.com）
  → links to Documentation（VitePress 静态站，可抓取）
  → links to Blog（内容营销，排名长尾关键词）
```

**实现路径**：
- 短期：在 `index.html` 中预渲染静态落地页内容（方案 A/B）。
- 中期：用 VitePress 建独立文档站（`docs.image.honlnk.com` 或 GitHub Pages 子路径），VitePress 生成静态 HTML 且支持 Vue 组件。
- 长期：博客可以放在 `blog.honlnk.com`（已有），或用 VitePress/Astro 建专门的内容站。

### 6.2 内容日历（前 3 个月）

| 优先级 | 标题 | 目标关键词 | 类型 |
|--------|------|-----------|------|
| 1 | GPT Image Studio：本地优先的 AI 图片生成工作台 | AI图片生成, 本地优先 | 落地页 |
| 2 | How to use OpenAI Images API for local image generation | OpenAI Images API tutorial | 教程 |
| 3 | Best open-source AI image generation tools in 2026 | open source AI image generation | 对比 |
| 4 | GPT image prompt engineering: complete guide | GPT image prompt | 指南 |
| 5 | AI图片生成工具对比：GPT Image Studio vs Midjourney vs SD WebUI | AI图片生成工具对比 | 对比 |
| 6 | Privacy-focused AI image generation: why local-first matters | local AI image generation privacy | 用例 |
| 7 | Mask editing with AI: a step-by-step tutorial | AI image mask editing | 教程 |
| 8 | 本地部署 AI 绘图工具完全指南 | 本地部署AI绘图 | 教程 |

### 6.3 内容类型与对应关键词

| 内容类型 | 示例 | 吸引的流量 |
|----------|------|-----------|
| **教程** | "How to use OpenAI Images API" | 高意图长尾流量 |
| **对比文章** | "GPT Image Studio vs Midjourney" | 决策阶段用户 |
| **提示词指南** | "GPT image prompt templates" | 高搜索量、可分享 |
| **用例文章** | "AI image generation for e-commerce" | 长尾转化 |
| **技术深度文章** | "Building a local-first AI workbench with Vue 3" | 开发者反向链接 |

---

## 七、分优先级行动计划

### P0：立即可做（半天内，零架构改动）

| # | 行动 | 改动 |
|---|------|------|
| 1 | `index.html` 加完整 meta 标签 + OG + Twitter Card + canonical | 改 1 个文件 |
| 2 | `index.html` 加 JSON-LD（WebApplication + FAQPage） | 同上 |
| 3 | `public/robots.txt` + `public/sitemap.xml` | 加 2 个文件 |
| 4 | GitHub 仓库加 20 个 topics | GitHub 网页操作 |
| 5 | GitHub description 改中英双语 | GitHub 网页操作 |
| 6 | `package.json` 补 description / keywords / homepage / repository | 改 1 个文件 |
| 7 | Google Search Console 验证站点 + 提交 sitemap | 网页操作 |
| 8 | Bing Webmaster Tools 验证 + 提交 sitemap | 网页操作 |
| 9 | 制作 OG 图片（1200×630 PNG）放 `public/og-image.png` | 加 1 个文件 |

### P1：1-2 周内（中等工作量）

| # | 行动 | 效果 |
|---|------|------|
| 10 | 实现 vite-ssg 单页预渲染（或 Playwright 脚本） | 爬虫看到完整 HTML 内容 |
| 11 | README 加英文摘要 + GIF 演示 + Star History | 提升 GitHub 转化率 |
| 12 | 提交 AlternativeTo（作为 4 个竞品的替代品） | 高质量 dofollow 反链 |
| 13 | 提交 5+ AI 工具目录 | 批量反链 |
| 14 | 提交 awesome lists PR（3-5 个） | GitHub 内被动发现 |
| 15 | 知乎 / 掘金发 1-2 篇技术文章 | 中文渠道冷启动 |

> 实施记录（2026-09-11）：#10 已完成——vite-ssg 预渲染落地，并扩展为无路由多页机制
> （`includedRoutes` + `entry-ssg.ts` 按路由分发 + `onBeforePageRender` 路由级 meta/JSON-LD）。
> 同批上线 `/download` 下载页（SoftwareApplication/FAQPage 结构化数据、sitemap、IndexNow），
> 见 `docs/plans/download-page-plan.md`。

### P2：1-2 个月（内容建设）

| # | 行动 | 效果 |
|---|------|------|
| 16 | 建独立博客 / 文档站（VitePress，静态 HTML） | 长尾关键词内容载体 |
| 17 | 发 4-6 篇 SEO 文章（教程 + 对比 + 提示词指南） | 占领长尾搜索 |
| 18 | Product Hunt + Hacker News 协调发布 | star 集中爆发冲 Trending |
| 19 | V2EX / Linux.do / 掘金社区发布 | 中文开发者冷启动 |
| 20 | B站录屏教程 | 视频搜索流量 |

### P3：长期（3-6 个月）

| # | 行动 | 效果 |
|---|------|------|
| 21 | 内容集群（10+ 篇文章围绕 AI 图片生成主题） | 建立 topical authority |
| 22 | 多语言 i18n（至少中英双语页面） | 扩大搜索覆盖 |
| 23 | FAQPage schema 持续扩展 | Google 富文本结果 |
| 24 | 鼓励用户写教程 / 使用案例 | UGC 内容 + 反链 |
| 25 | 百度搜索资源平台提交 + 抓取诊断 | 百度收录 |

---

## 八、不应做的事

| 不做 | 原因 |
|------|------|
| ❌ dynamic rendering | Google 已废弃（2024）；GitHub Pages 无法运行中间件 |
| ❌ `prerender-spa-plugin` | 2023 年已归档，无人维护 |
| ❌ `vue-meta` | 已过时，被 `@unhead/vue` 取代 |
| ❌ `@vueuse/head` | 已 sunset，新项目用 `@unhead/vue` |
| ❌ Rendertron | Google 已归档 |
| ❌ hash 路由（`#/path`） | Googlebot 无法可靠解析；如引入路由须用 History API |
| ❌ 仅依赖客户端 meta 标签 | 社交爬虫和 AI 爬虫不执行 JS |
| ❌ 迁移到 Nuxt 3（当前阶段） | 改动量过大，ROI 不匹配；等 SEO 成为最高优先级时再考虑 |

---

## 九、验证与监控

### 部署后验证清单

- [ ] `curl https://image.honlnk.com/` 返回的 HTML 包含 meta description 和 JSON-LD
- [ ] `curl https://image.honlnk.com/robots.txt` 返回正确的 robots.txt
- [ ] `curl https://image.honlnk.com/sitemap.xml` 返回正确的 sitemap.xml
- [ ] Google Rich Results Test 验证 JSON-LD 通过
- [ ] Google Search Console 中 sitemap 提交成功
- [ ] Bing Webmaster Tools 中 sitemap 提交成功
- [ ] `curl -A "Baiduspider" https://image.honlnk.com/` 模拟百度爬虫验证内容
- [ ] 社交平台分享链接时有预览图和标题（微信/Telegram/X）
- [ ] GitHub 仓库 topics 显示在仓库页面
- [ ] npm 包页面显示 description 和 keywords

### 持续监控

| 指标 | 工具 | 频率 |
|------|------|------|
| 索引页面数 | Google Search Console | 每周 |
| 搜索查询曝光 / 点击 | Google Search Console | 每周 |
| Bing 索引状态 | Bing Webmaster Tools | 每月 |
| 百度收录状态 | 百度搜索资源平台 | 每月 |
| GitHub star 增速 | GitHub Insights | 每月 |
| npm 下载量 | npm stats | 每月 |
| 反向链接数量 | Google Search Console (Links) | 每月 |

---

## 十、参考资料

- [Google JavaScript SEO 基础](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google 动态渲染迁移指南](https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering)
- [vite-ssg GitHub](https://github.com/antfu-collective/vite-ssg)
- [@unhead/vue 文档](https://unhead.unjs.io/usage/composables/use-seo-meta)
- [schema.org WebApplication](https://schema.org/WebApplication)
- [GitHub Topics 文档](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
- [rafgraph/spa-github-pages](https://github.com/rafgraph/spa-github-pages)（SPA 404 fallback 方案）
- 竞品分析：gpt-image2ai.com、gptimagestudio.com、xianyu110.github.io/gpt-image-2-web
