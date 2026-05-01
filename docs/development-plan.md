# GPT Image Studio 开发计划

## 产品方向

GPT Image Studio 将从一个“单次图片生成表单”，重构成一个本地优先的 AI 图片创作工作台。

目标体验是接近聊天工具：用户通过对话创建图片、编辑图片、引用历史图片，并随时回看过去的创作记录。应用产生的数据优先保存在本地，包括聊天会话、聊天消息、图片文件和图片元数据。

## 当前策略

第一阶段仍然先做 Web App，不急着做桌面端。

本地数据先使用 IndexedDB 存储。等 Web 版本的交互、数据模型和核心流程稳定后，再考虑用 Tauri 或 Electron 打包成本地桌面应用，并把存储层扩展到真实文件系统。

这样可以先把产品体验跑通，避免太早被桌面端工程复杂度拖住。

## 核心目标

- 把当前左右结构的表单页面，重构成聊天式图片创作界面。
- 支持用户直接输入文字进行文生图。
- 支持用户输入文字并附带引用图片，进行图片编辑。
- 使用 IndexedDB 保存聊天会话、聊天消息、图片元数据和图片二进制数据。
- 聊天记录中不长期保存 base64 图片内容，而是保存图片资源 ID 或本地 Blob 引用。
- 提供历史聊天侧边栏，用户可以随时打开过去的会话。
- 提供图片库侧边栏，用户可以浏览所有生成过或导入过的图片。
- 用户可以从图片库中选择或拖拽图片到输入框，作为下一次编辑的引用图片。
- 保留设置能力，包括 API key、API Base URL、模型和默认生成参数。

## 第一阶段暂不做

- 暂不接入文本模型做意图识别。
- 暂不让 AI 自动判断用户到底是想生成图片还是编辑图片。
- 暂不打包桌面应用。
- 暂不实现完整的“自动保存到用户指定本地目录”能力。
- 暂不做多用户、云同步或账号系统。

## 第一版交互规则

- 只输入文字：执行文生图。
- 输入文字并附带图片：执行图片编辑。
- 在输入框粘贴或拖入图片：把图片作为下一条消息的引用图片。
- 从图片库选择图片：把图片作为下一条消息的引用图片。
- 生成成功：追加一条 assistant 消息，并把生成结果加入本地图片库。
- 生成失败：保留用户消息，追加一条失败状态的 assistant 消息，并支持重试。

## 主要界面

### 聊天工作区

- 展示当前会话的消息流。
- 用户消息展示 prompt 文本和引用图片。
- assistant 消息展示生成中、生成成功、生成失败等状态。
- 图片结果以卡片方式展示。
- 图片卡片提供下载、设为引用图、查看详情等操作。
- 页面底部提供固定输入框，包括文本输入、图片附件、参数入口和发送按钮。

### 会话侧边栏

- 新建会话。
- 展示历史会话列表。
- 切换会话。
- 重命名会话。
- 删除会话。
- 后续可以增加搜索或筛选。

### 图片库

- 展示所有生成过或导入过的图片。
- 查看图片元数据。
- 将图片拖入或选入输入框。
- 删除图片资源。
- 打开图片详情预览。

### 设置

- API key。
- API Base URL。
- 默认模型。
- 默认尺寸、质量、背景、输出格式。
- 本地存储状态。
- 未来桌面端或浏览器文件系统能力成熟后，再加入默认保存目录设置。

## 本地数据模型草案

### Conversation 会话

```ts
type Conversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}
```

### Message 消息

```ts
type Message = {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  type: 'text' | 'image_result' | 'error'
  content: string
  status: 'pending' | 'success' | 'error'
  referencedImageIds: string[]
  resultImageIds: string[]
  generationParams?: GenerationParams
  errorMessage?: string
  createdAt: string
}
```

### ImageAsset 图片资源

```ts
type ImageAsset = {
  id: string
  blobKey: string
  name: string
  mimeType: string
  width?: number
  height?: number
  sizeBytes?: number
  source: 'generated' | 'imported'
  conversationId?: string
  messageId?: string
  prompt?: string
  createdAt: string
  updatedAt: string
}
```

### AppSettings 应用设置

```ts
type AppSettings = {
  apiKey: string
  apiBaseUrl: string
  model: string
  defaults: GenerationParams
  storageMode: 'indexeddb'
  preferredDirectoryName?: string
}
```

### GenerationParams 生成参数

```ts
type GenerationParams = {
  size: 'auto' | '1024x1024' | '1536x1024' | '1024x1536'
  quality: 'auto' | 'high' | 'medium' | 'low'
  background: 'auto' | 'opaque' | 'transparent'
  outputFormat: 'png' | 'webp' | 'jpeg'
}
```

## IndexedDB 存储规划

结构化数据和图片二进制数据都先存到 IndexedDB。

建议的 object store：

- `conversations`：保存会话列表。
- `messages`：保存聊天消息。
- `imageAssets`：保存图片资源元数据。
- `imageBlobs`：保存图片 Blob 数据。
- `settings`：保存应用设置。

存储原则：

- 消息记录中只保存图片 ID，不直接保存大段 base64。
- 图片二进制数据单独存 Blob。
- `ImageAsset.blobKey` 用来关联图片 Blob。
- API key 的保存方式要在设置里明确提示。
- 后续可以增加导入、导出、备份能力。

## 重构阶段

### 第一阶段：产品骨架

- 替换当前页面结构，改成聊天式工作台。
- 增加会话侧边栏 UI。
- 增加图片库 UI。
- 增加底部输入框和图片附件预览。
- 先使用 mock 数据，不急着接真实 API。

### 第二阶段：本地持久化

- 增加 IndexedDB 存储层。
- 实现会话的增删改查。
- 实现消息的增删改查。
- 实现图片资源和图片 Blob 的增删改查。
- 保存应用设置。

### 第三阶段：文生图流程

- 将纯文字消息接入图片生成接口。
- 生成成功后，把图片 Blob 写入 IndexedDB。
- 在消息流中展示生成中、成功、失败状态。
- 增加重试能力。
- 增加图片下载和“设为引用图”能力。

### 第四阶段：图片编辑流程

- 支持粘贴、拖拽、上传、从图片库选择引用图片。
- 将“文字 + 引用图片”接入图片编辑接口。
- 编辑成功后，把结果保存为新的图片资源。
- 记录编辑结果和引用图片之间的关系。

### 第五阶段：体验增强

- 增加会话搜索。
- 增加图片库筛选。
- 增加图片详情页或详情弹窗。
- 增加导入、导出、备份能力。
- 探索浏览器 File System Access API，实现可选的本地目录导出。
- 在 Web App 工作流稳定后，再评估 Tauri 或 Electron 桌面端。

## 待确认问题

- 图片库应该只包含生成图，还是也包含用户导入的参考图？
- 删除会话时，要不要同时删除该会话下生成的图片？
- 一张图片是否必须归属于某一个会话？
- API key 应该继续存在 localStorage，还是迁移到 IndexedDB，或者每次打开都重新填写？
- 未来桌面端应该把真实文件系统作为主存储，还是继续以 IndexedDB 为主，再单独导出文件？
