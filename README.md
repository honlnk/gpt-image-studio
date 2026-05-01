# GPT Image Studio

本地优先的 AI 图片创作工作台，基于 Vue 3 + TypeScript + Tailwind CSS 构建。

通过聊天式界面调用 OpenAI 兼容的 Images API 进行图片生成和编辑，对话和图片数据保存在本地。

## 当前进度

**第一阶段（产品骨架）** — UI 和交互流程已跑通，使用 mock 数据。

- 三栏布局：会话侧边栏、聊天工作区、图片库面板
- 聊天式消息流，支持生成状态（生成中 / 成功 / 失败）
- 行内参数编辑器（尺寸、质量、背景、格式）
- 自定义尺寸输入，支持预设快捷选择
- 设置弹窗配置 API key 和 Base URL
- 响应式布局（小屏自动折叠侧边栏和图片库）

## 技术栈

- **Vue 3**（Composition API，`<script setup>`）
- **TypeScript**
- **Vite**
- **Tailwind CSS v4**
- **pnpm**

## 开发

```sh
pnpm install
pnpm dev
```

## 构建

```sh
pnpm build
```

## 开发计划

完整计划见 [docs/development-plan.md](docs/development-plan.md)。

- 第二阶段：IndexedDB 本地持久化
- 第三阶段：接入真实图片生成 API
- 第四阶段：图片编辑流程（引用图片）
- 第五阶段：桌面端打包（Tauri / Electron）

## 注意事项

API Base URL 在设置弹窗中配置。浏览器直接调用可能被 CORS 拦截，生产环境建议通过自己的服务器转发请求，避免在浏览器中暴露 API key。
