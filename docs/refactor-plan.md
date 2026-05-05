# GPT Image Studio 重构方案

## 背景

当前项目已经完成本地优先图片创作工作台的核心功能：聊天式生成、引用图编辑、IndexedDB 持久化、图片库、备份恢复和批量操作。

现有结构适合快速迭代 MVP，但随着功能继续增加，几个文件已经开始承担过多职责：

- `src/composables/useStudioState.ts` 同时管理设置、会话、消息、图片、生成请求、通知、确认弹窗、备份恢复和 hydration。
- `src/components/studio/SettingsModal.vue` 已超过 1000 行，包含 API 设置、备份恢复和批量操作等多个独立面板。
- `src/components/studio/ChatWorkspace.vue` 和 `src/components/studio/ImageLibrary.vue` 也在持续膨胀。
- 项目缺少测试、lint、formatter；目前主要依赖 `pnpm typecheck` 和 `pnpm build` 兜底。
- `main` 分支已经将 GitHub Actions 迁移到 pnpm；重构分支开始前需要确认当前开发分支已同步这部分配置，避免误用旧的 npm CI 文件。

本次重构目标不是重写应用，而是在保持现有功能和交互不变的前提下，降低后续开发成本。

## 重构原则

- 小步迁移，每一步都保持可构建、可回退。
- 优先拆职责边界，不做无关视觉重设计。
- 先拆业务状态，再拆大组件，最后整理目录结构。
- 对外 API 尽量稳定，尤其是先保留 `useStudioState()` 作为聚合入口。
- 重构过程中补充关键测试，避免只靠人工回归。
- 不改变当前本地数据结构，除非有明确迁移方案。

## 目标结构

短期目标是在现有目录上渐进拆分：

```text
src/
  composables/
    useStudioState.ts
    useStudioFeedback.ts
    useStudioSettings.ts
    useStudioConversations.ts
    useStudioImages.ts
    useStudioGeneration.ts
    useStudioHydration.ts
  components/
    studio/
    settings/
    chat/
    image-library/
    ui/
  services/
  types/
```

中长期可以进一步演进为按领域组织：

```text
src/
  modules/
    conversations/
      types.ts
      storage.ts
      useConversations.ts
    messages/
      types.ts
      storage.ts
      useMessages.ts
    images/
      types.ts
      storage.ts
      useImageLibrary.ts
      imageMetadata.ts
    generation/
      imagesApi.ts
      validation.ts
      useGeneration.ts
    settings/
      types.ts
      storage.ts
      useSettings.ts
    backup/
      backups.ts
      zipArchive.ts
    feedback/
      useNotice.ts
      useConfirmDialog.ts
  components/
  services/
  types/
```

第一轮重构不建议直接切到最终结构。先保持 `services/` 和 `types/` 原位，减少文件移动带来的噪音。

## 阶段一：确认工程基线

### 目标

先确认工程保障处于可依赖状态，确保后续重构有稳定反馈。

### 任务

- 确认当前开发分支已同步 `main` 上的 pnpm GitHub Actions 配置。
- 保留现有 `pnpm typecheck` 和 `pnpm build`。
- 引入 Vitest。
- 优先为纯逻辑模块补少量单测。

### 参考 CI 配置

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'

- name: Setup pnpm
  uses: pnpm/action-setup@v4

- name: Get pnpm store directory
  shell: bash
  run: echo "STORE_PATH=$(pnpm store path --silent)" >> $GITHUB_ENV

- name: Setup pnpm cache
  uses: actions/cache@v4
  with:
    path: ${{ env.STORE_PATH }}
    key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
    restore-keys: |
      ${{ runner.os }}-pnpm-store-

- name: Install dependencies
  run: pnpm install --frozen-lockfile

- name: Typecheck
  run: pnpm typecheck

- name: Test
  run: pnpm test

- name: Build project
  run: pnpm build
```

### 优先测试范围

- `src/services/imagesApi.ts`
  - 自定义尺寸校验。
  - 参数转换。
  - HTTP 错误响应解析。
- `src/services/backups.ts`
  - manifest 校验。
  - 缺失图片 Blob 时的错误。
  - 导出备份不包含 API key。
- `src/services/zipArchive.ts`
  - 可创建基础 ZIP。
  - 文件名和 Blob 内容可被恢复逻辑读取。

### 验收标准

- `pnpm typecheck` 通过。
- `pnpm build` 通过。
- `pnpm test` 通过。
- PR 和 main 分支 CI 使用 pnpm 安装依赖；如果当前分支显示旧 npm CI，先从 `main` 同步。

## 阶段二：拆反馈与设置状态

### 目标

从 `useStudioState.ts` 中先拆最独立、风险最低的逻辑。

### 新增文件

```text
src/composables/useStudioFeedback.ts
src/composables/useStudioSettings.ts
```

### `useStudioFeedback`

负责：

- notice 状态。
- success/error toast。
- confirm dialog 状态。
- confirmation promise resolver。
- notice timer 清理。

迁出内容：

- `notice`
- `confirmDialog`
- `notifySuccess`
- `notifyError`
- `dismissNotice`
- `requestConfirmation`
- `cancelConfirmDialog`
- `acceptConfirmDialog`

### `useStudioSettings`

负责：

- `apiKey`
- `apiBaseUrl`
- `model`
- 默认生成参数。
- 参数 label/options。
- `currentSettings()`
- `currentGenerationParams()`
- `applySettings()`
- 设置持久化 watcher。

需要注意：

- 现有 API key 和 API Base URL 同时涉及 localStorage 旧逻辑与 IndexedDB settings，需要先保持兼容。
- `background: "transparent"` 对 `gpt-image-2` 的兼容修正可以保留在 settings 或 generation validation 中，但不要分散两处。

### 验收标准

- `useStudioState()` 对 App 和组件暴露的字段不变。
- 设置弹窗功能不变。
- 通知和确认弹窗行为不变。
- 构建、类型检查、测试通过。

## 阶段三：拆图片与会话状态

### 目标

把数据集合和基础 CRUD 从全局大 composable 中分离出来。

### 新增文件

```text
src/composables/useStudioConversations.ts
src/composables/useStudioImages.ts
```

### `useStudioConversations`

负责：

- `conversations`
- `activeConversationId`
- `activeConversation`
- `selectConversation`
- `createConversation`
- `deleteConversation`
- `deleteConversations`
- `updateConversationSummary`
- `persistConversation`
- conversation write queue。

需要注入或回调：

- 删除会话时需要删除相关 messages。
- 删除确认使用 `useStudioFeedback` 提供的 `requestConfirmation`。
- 删除后需要通知图片和草稿状态清理。

### `useStudioImages`

负责：

- `imageAssets`
- `storageUsage`
- `imageById`
- `activeAttachments`
- `attachImage`
- `removeAttachment`
- `deleteImage`
- `deleteImages`
- `importImages`
- `hydrateImagePreviews`
- `refreshStorageUsage`

需要注意：

- `URL.createObjectURL` 需要逐步统一释放策略。
- 删除图片不会删除历史消息中的 ID，只会让聊天记录显示“图片已删除”占位，这个行为需要保持。
- 图片导入后加入当前引用图的行为需要保持。

### 验收标准

- 会话新建、切换、删除、批量删除功能不变。
- 图片导入、选择引用、删除、批量删除、预览功能不变。
- 本地存储用量仍能刷新。
- 构建、类型检查、测试通过。

## 阶段四：拆生成流程与 hydration

### 目标

把 API 请求编排、消息创建和启动恢复逻辑从状态聚合器里拆出。

### 新增文件

```text
src/composables/useStudioGeneration.ts
src/composables/useStudioHydration.ts
```

### `useStudioGeneration`

负责：

- `canSend`
- `isGenerating`
- `submitMessage`
- `retryMessage`
- `runImageRequest`
- `requestImageEdit`
- `importImageFile` 中与生成结果落库相关的辅助逻辑可以视情况留在 images 模块。

依赖：

- settings：API key、base URL、model、generation params。
- conversations：当前会话、创建会话、更新摘要。
- messages：消息列表和消息持久化。
- images：图片查询、Blob 读取、图片资源保存。
- feedback：错误提示。

### `useStudioHydration`

负责：

- 从 IndexedDB 并行加载 settings、conversations、messages、imageAssets。
- 移除 legacy seed records。
- 恢复 pending message 为 error。
- 恢复图片 preview URL。
- 清理无效草稿附件。
- 刷新 storage usage。

需要注意：

- hydration 是多个模块的协调逻辑，允许它作为较薄的 orchestrator 存在。
- 旧数据兼容逻辑不要散落到多个组件。

### 验收标准

- 刷新页面后数据恢复行为不变。
- 页面刷新中断的 pending 消息仍会变成可重试错误。
- 文生图、引用图编辑、失败重试功能不变。
- 构建、类型检查、测试通过。

## 阶段五：拆设置弹窗

### 目标

降低 `SettingsModal.vue` 的文件体积，把独立面板拆成子组件。

### 建议结构

```text
src/components/settings/
  SettingsModal.vue
  ApiSettingsPanel.vue
  BackupPanel.vue
  BatchOperationsPanel.vue
  BatchImagesPanel.vue
  BatchConversationsPanel.vue
```

### 拆分原则

- `SettingsModal.vue` 只负责 modal 外壳、tabs、当前 tab/panel 状态。
- `ApiSettingsPanel.vue` 负责 API key、base URL、模型等基础设置。
- `BackupPanel.vue` 负责备份导出和恢复。
- `BatchOperationsPanel.vue` 负责批量操作入口和 panel 切换。
- `BatchImagesPanel.vue` 负责图片批量下载和删除。
- `BatchConversationsPanel.vue` 负责会话批量删除。

### 验收标准

- 设置弹窗打开、关闭、切 tab 行为不变。
- 备份导出、恢复行为不变。
- 批量删除的确认输入行为不变。
- 构建、类型检查、测试通过。

## 阶段六：拆聊天工作区和图片库

### 聊天工作区建议结构

```text
src/components/chat/
  ChatWorkspace.vue
  MessageList.vue
  MessageItem.vue
  Composer.vue
  AttachmentStrip.vue
  ParameterToolbar.vue
  SizeEditor.vue
  QualityEditor.vue
  BackgroundEditor.vue
  FormatEditor.vue
```

拆分重点：

- 消息列表和单条消息展示分离。
- 输入框和附件区域分离。
- 参数编辑器拆成可维护的小组件。
- 保持 props down / events up，不急着引入全局 store。

### 图片库建议结构

```text
src/components/image-library/
  ImageLibrary.vue
  ImageLibraryToolbar.vue
  ImageGrid.vue
  ImageCard.vue
  StorageUsageBadge.vue
```

拆分重点：

- 工具栏负责筛选、批量模式、入口按钮。
- 网格只负责布局。
- 卡片只负责单张图片展示和操作。
- 存储用量展示独立，后续可扩展为更详细的容量面板。

### 验收标准

- 小屏响应式折叠行为不变。
- 图片预览、下载、加入引用图、删除功能不变。
- 聊天提交、重试、继续编辑功能不变。
- 构建、类型检查、测试通过。

## 阶段七：目录领域化

### 目标

当 composable 和组件边界稳定后，再考虑目录领域化。

### 建议

不要在前几个阶段做大量文件移动。等逻辑拆分稳定后，再把强相关文件逐步搬到 `modules/`：

```text
modules/generation/
  imagesApi.ts
  validation.ts
  useGeneration.ts

modules/backup/
  backups.ts
  zipArchive.ts

modules/images/
  storage.ts
  imageMetadata.ts
  useImageLibrary.ts
```

### 验收标准

- 导入路径清晰。
- 没有循环依赖。
- `services/` 只保留真正跨模块的基础设施。

## 额外技术债

### Object URL 生命周期

当前多处使用 `URL.createObjectURL`：

- 备份下载。
- 设置页 ZIP 下载。
- 生成图 preview。
- 导入图 preview。
- hydration 恢复图 preview。

下载类 URL 已有即时 revoke 的地方可以继续保留。图片 preview URL 需要统一管理，避免长时间使用后内存堆积。

建议：

- 为图片 preview URL 建立集中创建和释放函数。
- 删除图片时 revoke 对应 preview URL。
- 重新 hydration 或替换图片列表前释放旧 preview URL。
- 应用卸载时释放所有 preview URL。

### API key 存储策略

当前 README 已提示浏览器直接调用会暴露 API key。后续如果产品化，需要考虑：

- 服务端代理。
- 桌面端安全存储。
- 不把 API key 写入备份，这一点当前已经实现，需要测试保护。

### 数据迁移策略

当前 IndexedDB 版本是 `1`。后续如果修改 store/index/schema，需要：

- 提升 `DB_VERSION`。
- 在 `onupgradeneeded` 中写迁移逻辑。
- 为旧数据兼容写测试或手动验证清单。

## 推荐执行顺序

1. 确认当前分支已同步 `main` 的 pnpm CI 配置。
2. 加 Vitest 基础配置和关键测试。
3. 拆 `useStudioFeedback`。
4. 拆 `useStudioSettings`。
5. 拆 `useStudioImages`。
6. 拆 `useStudioConversations`。
7. 拆 `useStudioGeneration`。
8. 拆 `useStudioHydration`。
9. 拆 `SettingsModal.vue`。
10. 拆 `ChatWorkspace.vue`。
11. 拆 `ImageLibrary.vue`。
12. 视情况推进 `modules/` 领域化目录。

每完成一个步骤，都运行：

```sh
pnpm typecheck
pnpm build
pnpm test
```

如果某一步涉及 UI 拆分，还需要人工验证：

- 新建会话。
- 发送文生图。
- 上传或粘贴引用图并编辑。
- 重试失败消息。
- 删除会话。
- 删除图片。
- 批量删除图片和会话。
- 导出和恢复备份。
- 刷新页面后数据恢复。

## 第一轮交付建议

第一轮建议只做到：

- 确认或同步 pnpm CI 配置。
- 加测试框架。
- 拆 `useStudioFeedback`。
- 拆 `useStudioSettings`。

这一轮改动收益明确、风险较低，可以快速建立后续重构的节奏。等第一轮稳定后，再进入图片、会话和生成流程拆分。
