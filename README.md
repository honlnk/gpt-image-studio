# GPT Image Studio

[![Version](https://img.shields.io/badge/version-1.1.0-brightgreen)](https://github.com/honlnk/gpt-image-studio/releases)
[![npm](https://img.shields.io/npm/v/@honlnk/image-studio-companion?label=companion%20npm)](https://www.npmjs.com/package/@honlnk/image-studio-companion)
[![Deploy](https://github.com/honlnk/gpt-image-studio/actions/workflows/deploy.yml/badge.svg)](https://github.com/honlnk/gpt-image-studio/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

> 🔗 **在线体验**：<a href="https://image.honlnk.com" target="_blank">image.honlnk.com</a>

本地优先的 AI 图片创作工作台。通过聊天式界面调用 OpenAI 兼容 Images API，生成和编辑图片。数据本地存储，无需后端即可使用；需要保护 API 凭据或多人共用时，可接入本地 Companion 或部署为服务器模式。

## 快速开始

选择最适合你的使用方式：

| 方式 | 适合场景 | 一句话说明 |
|------|----------|------------|
| **[在线版](https://image.honlnk.com)** | 个人快速体验 | 直接打开浏览器用，填入自己的 API 地址和密钥 |
| **本地 Companion** | 不想暴露 API Key 给浏览器 | 装个 CLI 服务，凭据留在本机 |
| **Docker 自部署** | 内网 / 私有化 / 服务器多租户 | docker compose 一键拉起前端 + 后端 |
| **桌面端** | 想要原生 App 体验 | macOS 原生壳（Tauri v2） |

### 方式一：在线直接用

打开 [image.honlnk.com](https://image.honlnk.com)，在设置中填入你的 OpenAI 兼容 Images API 地址和密钥即可。所有数据保存在浏览器本地。

### 方式二：本地 Companion

凭据不经过浏览器，适合不想在前端暴露 API Key 的场景：

```bash
npm install -g @honlnk/image-studio-companion
gpt-image-studio provider add    # 交互式添加 Provider 凭据
gpt-image-studio start           # 启动后台服务
gpt-image-studio status          # 查看连接密钥（access key）
```

然后在网页设置中切换到「本地 Companion」，粘贴终端中 `status` 显示的连接密钥完成连接。

### 方式三：Docker 自部署

```bash
# 拉预构建镜像并启动（默认仅前端）
docker compose pull
docker compose up -d
# → http://localhost:8080

# 带 Companion 后端（local 模式）
docker compose --profile companion up -d

# 服务器模式（JWT 多租户，配合 qiankun 嵌入）
JWT_SECRET=xxx ADMIN_API_KEY=xxx docker compose --profile companion-server up -d
```

镜像已发布到 ghcr.io 和 Docker Hub：

| 镜像 | 地址 |
|------|------|
| 前端 (web) | `ghcr.io/honlnk/gpt-image-studio-web:latest` / `honlnk/gpt-image-studio-web:latest` |
| Companion | `ghcr.io/honlnk/gpt-image-studio-companion:latest` / `honlnk/gpt-image-studio-companion:latest` |

详见 [部署指南](docs/guides/deployment-guide.md)。

### 方式四：桌面端

下载安装包（含 macOS 安装指引）：**[image.honlnk.com/download](https://image.honlnk.com/download)**

```bash
pnpm dev:desktop      # 开发模式
pnpm build:desktop    # 构建 .app / .dmg（macOS，需 Rust）
```

详见 [桌面端打包方案](docs/guides/desktop-packaging.md)。

## 功能特性

**图片创作**
- 文生图：输入 prompt 直接生成图片
- 图片编辑：附带引用图 + prompt 进行局部或整体编辑
- 遮罩编辑：画笔、橡皮、矩形、圆形工具绘制编辑区域，支持撤销重做
- 自定义参数：尺寸比例、分辨率、背景透明度、输出格式

**提示词控制**
- 提示词模式：默认、安全、创意、开放四档，默认保持原始 prompt 直出
- 安全 / 创意 / 开放模式会在请求前注入对应模式说明和词库灵感
- 聊天记录保留用户原始提示词，模式包装只影响发送给图片接口的请求文本
- 提示词防改写：可在最终请求前追加防改写前缀，减少接口侧改写

**对话管理**
- 聊天式消息流，完整保留创作历史
- 多会话管理：新建、搜索、切换、重命名、删除
- 每个会话独立保存草稿和参数设置
- 生成失败支持重试

**图片库**
- 浏览所有生成和导入的图片
- 大图预览，支持缩放
- 多选批量下载（ZIP）、批量删除
- 存储用量可视化

**数据安全**
- 本地优先：所有数据存储在浏览器 IndexedDB（直连模式）或 Companion 后端（Companion 模式）
- 完整备份导出/恢复（ZIP 格式）
- API key 不写入备份文件
- Companion 模式凭据不经过浏览器

## 连接模式

| 模式 | 凭据存储 | 适合场景 |
|------|----------|----------|
| **浏览器直连** | 浏览器本地 | 个人快速使用，信任前端 |
| **本地 Companion** | 本机文件（loopback） | 不想暴露 API Key 给浏览器，单机使用 |
| **服务器模式 (Companion server)** | 服务器 + JWT 多租户 | 多人共用 / 私有化部署 / 嵌入宿主系统 |

服务器模式支持 JWT 认证的多用户数据隔离、qiankun 微前端嵌入、平台级凭据管理 API，详见 [部署指南](docs/guides/deployment-guide.md)。

## 提示词模式

提示词模式可以在「设置」里的「提示词保护」页面切换。默认模式不会修改 prompt；其他模式会在发送请求前追加模式说明和随机灵感词。

| 模式 | 说明 |
|------|------|
| 默认 | 不追加任何模式指令，保持当前逻辑 |
| 安全 | 使用安全提示词方向，只抽取 safe 词库 |
| 创意 | 使用 safe + creative 词库，强化性感氛围和画面张力 |
| 开放 | 使用 safe + creative + adultInspiration 词库，适合支持成人内容的模型或接口 |

提示词模式不会改写聊天记录里的原始输入，只改变最终发送给图片接口的请求文本。是否能生成对应内容仍取决于当前模型和接口本身的能力与限制。

## 页面嵌入

支持两种嵌入方式，将完整工作台集成到你的系统中：

### iframe 嵌入

通过 URL 参数预填浏览器直连配置和默认生成参数：

```html
<iframe
  src="https://image.honlnk.com?settings=%7B%22apiUrl%22%3A%22https%3A%2F%2Fapi.example.com%22%2C%22apiKey%22%3A%22sk-xxx%22%7D"
  allow="clipboard-read; clipboard-write"
></iframe>
```

也支持普通查询参数（`?apiUrl=...&apiKey=...&prompt=...`），详见下方参数列表。

### qiankun 微前端

适合需要与宿主系统深度集成的场景（宿主签发 JWT、管理用户、平台级凭据）：

```ts
// 宿主侧注册
registerMicroApps([{
  name: 'gpt-image-studio',
  entry: 'https://image.honlnk.com',
  container: '#container',
  activeRule: '/image-studio',
  props: {
    companionUrl: 'https://companion.your-domain.com',
    jwt: getCurrentUserJwt(),  // 宿主签发
  },
}])
```

完整嵌入示例（含宿主管理页）见 `examples/` 目录，部署细节见 [部署指南](docs/guides/deployment-guide.md)。

### 嵌入参数（iframe）

| 参数 | 说明 |
|------|------|
| `settings` | URL 编码后的 JSON，可包含下方所有参数 |
| `apiUrl` / `apiBaseUrl` | API Base URL |
| `apiKey` | API key |
| `apiBaseUrlMode=full` | 将 apiUrl 视为完整地址，不自动追加 `/v1/images` |
| `apiMode` | 接口模式：`images` / `responses` |
| `streamImages` | 是否开启流式预览：`1`/`0`、`true`/`false` |
| `streamPartialImages` | 中间图数量：`0`-`3` |
| `prompt` | 预填输入框（不自动提交） |
| `size` | 尺寸：`auto`、`1:1`、`16:9`、`9:16`、`custom` |
| `resolution` | 分辨率：`1k`、`2k`、`4k` |
| `width` / `height` | 自定义尺寸（配合 `size=custom`） |
| `background` | 背景：`auto`、`opaque`、`transparent` |
| `outputFormat` | 输出格式：`png`、`webp`、`jpeg` |
| `promptRewriteGuard` | 启用提示词防改写：`1`/`0` |
| `promptRewriteGuardText` | 自定义防改写前缀 |

页面读取参数后会保存设置并从地址栏清除已识别的配置参数。当前版本固定使用 `gpt-image-2`，不开放通过 URL 自定义模型。

## 技术栈

- Vue 3 (Composition API, `<script setup>`)
- TypeScript 6
- Pinia 状态管理
- Tailwind CSS v4
- Vite
- IndexedDB 持久化（直连模式）/ SQLite + OSS（Companion 模式）
- pnpm workspace monorepo
- Companion: Fastify + Commander（Node ≥ 20）

## 开发

```bash
pnpm install
pnpm dev              # Web App (http://127.0.0.1:8888)
pnpm dev:companion    # Companion (http://127.0.0.1:19750)
pnpm test             # 全量测试
pnpm typecheck        # 类型检查
pnpm build            # 生产构建 → dist/
```

桌面端开发（需 [Rust](docs/guides/desktop-packaging.md#前置依赖)）：

```bash
pnpm dev:desktop      # webview + 热重载
pnpm build:desktop    # .app / .dmg (macOS)
```

## 项目结构

```
gpt-image-studio/
├── src/                    # Web App 源码
├── companion/              # CLI Companion (Fastify + Commander)
├── desktop/                # Tauri v2 桌面壳
├── examples/               # 嵌入示例（iframe / qiankun）
├── docs/                   # 项目文档
└── .github/workflows/      # CI（Pages 部署 + npm/Docker 发布）
```

## 文档

- [架构说明](docs/architecture/architecture.md)
- [部署指南](docs/guides/deployment-guide.md) — Docker、服务器模式、nginx、qiankun 嵌入
- [发布指南](docs/guides/release-guide.md) — npm 与 Docker 镜像的 tag 驱动发布流程
- [产品路线图](docs/plans/roadmap.md)
- [桌面端打包方案](docs/guides/desktop-packaging.md)
- [本地 Companion 方案](docs/companion/companion.md)
- [遮罩编辑](docs/architecture/mask-editing.md)
- [提示词模式](docs/plans/prompt-modes.md)
- [备份格式](docs/architecture/backup-format.md)
- [文档索引](docs/README.md)

## 发布

本项目通过 git tag 驱动自动化发布（详见 [发布指南](docs/guides/release-guide.md)）：

```bash
# 改 companion/package.json version → 提交 → 打 tag → 推送
git tag companion-v1.1.0
git push origin companion-v1.1.0
# CI 自动：npm publish + Docker 镜像构建推送（ghcr.io + Docker Hub）
```

## 注意事项

- 浏览器直连模式下，部分接口可能被 CORS 拦截，建议使用支持 CORS 的中转站或切换到 Companion 模式。
- API key 保存在浏览器本地 IndexedDB（直连模式），适合个人设备使用。
- 服务器模式部署请妥善保管 `JWT_SECRET` 和 `ADMIN_API_KEY`。

## License

[MIT](LICENSE)
