# GPT Image Studio

[![Deploy](https://github.com/honlnk/gpt-image-studio/actions/workflows/deploy.yml/badge.svg)](https://github.com/honlnk/gpt-image-studio/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

> 🔗 **在线体验**：<a href="https://image.honlnk.com" target="_blank">image.honlnk.com</a>

本地优先的 AI 图片创作工作台。通过聊天式界面调用 OpenAI 兼容 Images API，生成和编辑图片。所有数据保存在浏览器本地，无需后端服务。

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
- 本地优先：所有数据存储在浏览器 IndexedDB
- 完整备份导出/恢复（ZIP 格式）
- API key 不写入备份文件
- 支持本地 Companion 模式，凭据不经过浏览器

## 连接模式

| 模式 | 说明 |
|------|------|
| 浏览器直连 | 配置 API Base URL 和 API key，浏览器直接调用接口 |
| 本地 Companion | 安装本地 CLI 服务，凭据保存在本机，浏览器只与 localhost 通信 |

## 提示词模式

提示词模式可以在「设置」里的「提示词保护」页面切换。默认模式不会修改 prompt；其他模式会在发送请求前追加模式说明和随机灵感词。

| 模式 | 说明 |
|------|------|
| 默认 | 不追加任何模式指令，保持当前逻辑 |
| 安全 | 使用安全提示词方向，只抽取 safe 词库 |
| 创意 | 使用 safe + creative 词库，强化性感氛围和画面张力 |
| 开放 | 使用 safe + creative + nsfw 词库，适合支持成人内容的模型或接口 |

提示词模式不会改写聊天记录里的原始输入，只改变最终发送给图片接口的请求文本。是否能生成对应内容仍取决于当前模型和接口本身的能力与限制。

## 页面嵌入

可以将完整工作台作为 iframe 嵌入到其他页面，并通过 URL 参数预填浏览器直连配置和默认生成参数：

使用 `settings` JSON 传入完整配置：

```html
<iframe
  id="imageStudioFrame"
  allow="clipboard-read; clipboard-write"
></iframe>

<script>
  const settings = {
    apiUrl: "https://api.example.com",
    apiKey: "sk-xxx",
    model: "gpt-image-2",
    prompt: "生成一张白底商品主图",
    size: "1:1",
    background: "opaque",
    outputFormat: "png",
  };

  document.querySelector("#imageStudioFrame").src =
    `https://image.honlnk.com?settings=${encodeURIComponent(JSON.stringify(settings))}`;
</script>
```

也可以直接使用普通查询参数：

```html
<iframe
  src="https://image.honlnk.com?apiUrl=https://api.example.com&apiKey=sk-xxx&model=gpt-image-2&prompt=生成一张白底商品主图&size=1:1&background=opaque&outputFormat=png"
  allow="clipboard-read; clipboard-write"
></iframe>
```

`settings` 和普通查询参数可以同时存在；同时存在时，普通查询参数会覆盖 `settings` 中的同名配置。

支持的参数：

- `settings`：URL 编码后的 JSON 配置。可包含下方所有参数；如果 `settings` 与独立参数同时存在，以独立参数为准
- `apiUrl` 或 `apiBaseUrl`：API Base URL
- `apiKey`：API key
- `model`：模型 ID
- `apiBaseUrlMode=full`：将 `apiUrl` / `apiBaseUrl` 视为完整 API Base URL；默认会将其视为站点根地址并自动追加 `/v1/images`
- `prompt`：预填输入框内容，不会自动提交
- `size`：默认尺寸，支持 `auto`、`1:1`、`16:9`、`9:16`、`custom` 等
- `resolution`：默认分辨率，支持 `1k`、`2k`、`4k`
- `width` / `height`：自定义尺寸，通常与 `size=custom` 配合使用
- `background`：默认背景，支持 `auto`、`opaque`、`transparent`
- `outputFormat`：默认输出格式，支持 `png`、`webp`、`jpeg`
- `promptRewriteGuard` 或 `promptRewriteGuardEnabled`：是否启用提示词防改写，支持 `1` / `0`、`true` / `false`
- `promptRewriteGuardText`：自定义提示词防改写前缀

页面读取这些参数后会保存设置类配置，并从地址栏清除已识别的配置参数，保留其他查询参数。`prompt` 只会写入当前输入框草稿。

本仓库提供了一个本地测试页，可用于验证 iframe 嵌入效果：

```bash
pnpm dev
```

然后在浏览器打开 `http://127.0.0.1:8888/embed-test.html`。测试页左侧会显示平台地址、API URL、API Key、Model 等输入框；右侧 iframe 默认加载 `http://127.0.0.1:8888/`。如果需要测试线上站点，可以在测试页左侧把平台地址改成 `https://image.honlnk.com`，并确认线上版本已经部署了 URL 参数支持。

跨站 iframe 中的 IndexedDB 可能被浏览器按顶层站点分区，因此测试页里看到的会话和图片数据可能不同于直接打开平台时的数据。

### 本地 Companion 快速开始

```bash
npm install -g @honlnk/image-studio-companion
gpt-image-studio login
gpt-image-studio start
```

然后在网页设置中切换到「本地 Companion」，点击配对并输入终端中显示的 6 位配对码。

## 技术栈

- Vue 3 (Composition API, `<script setup>`)
- TypeScript
- Pinia 状态管理
- Tailwind CSS v4
- Vite
- IndexedDB 持久化
- pnpm workspace monorepo

## 快速开始

```bash
pnpm install
pnpm dev              # 启动 Web App (http://127.0.0.1:8888)
```

启动本地 Companion（可选）：

```bash
pnpm dev:companion    # 启动 Companion 服务 (http://127.0.0.1:19750)
```

## 构建

```bash
pnpm build            # 生产构建到 dist/
pnpm preview          # 预览生产构建
```

## 项目结构

```
gpt-image-studio/
├── src/                    # Web App 源码
├── companion/              # 本地 CLI Companion (Fastify + Commander)
└── docs/                   # 项目文档
```

## 文档

- [架构说明](docs/architecture.md)
- [产品路线图](docs/roadmap.md)
- [本地 Companion 方案](docs/companion.md)
- [遮罩编辑](docs/mask-editing.md)
- [提示词模式开发计划](docs/prompt-modes.md)
- [备份格式](docs/backup-format.md)
- [文档索引](docs/README.md)

## 注意事项

API key 保存在当前浏览器本地 IndexedDB，适合个人设备使用。浏览器直连模式下，部分接口可能被 CORS 拦截，建议使用支持 CORS 的中转站或切换到本地 Companion 模式。

## License

[MIT](LICENSE)
