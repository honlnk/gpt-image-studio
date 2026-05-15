# Pinia 状态管理迁移计划

本文档记录 GPT Image Studio 从当前 Composition API ViewModel 状态组织，渐进迁移到 Pinia 的执行计划。

它不是一次性重写方案。迁移目标是解决深层组件反复转传状态和事件的问题，同时保留现有 IndexedDB service、业务行为和测试边界。

相关文档：

- [架构说明](architecture.md)
- [重构路线图](refactor-roadmap.md)
- [并发生成任务](generation-jobs.md)
- [遮罩局部编辑](mask-editing.md)

## 背景

当前项目没有使用 Pinia。应用状态主要由 `src/app/studio/useStudioViewModel.ts` 统一装配，再拆到多个 feature composable：

- `useStudioSettings`
- `useStudioConversations`
- `useStudioImages`
- `useStudioGeneration`
- `useStudioBackup`
- `useStudioFeedback`

这套结构在早期是合适的，因为应用是单页工作台，状态入口集中，业务模块边界也比较清楚。

但随着聊天区能力变多，组件树里已经出现明显的 prop drilling。例如生成参数、输入框、编辑模式、引用图和提交动作会从 `App.vue` 传到 `ChatWorkspace.vue`，再传到 `ChatComposer.vue`，再继续传到参数编辑组件。

近期已完成一轮小重构，将 `App.vue -> ChatWorkspace` 的几十个参数收口为：

```text
header
messages
composer
editor
actions
```

这让 `App.vue` 更清爽，但没有根治 `ChatWorkspace -> ChatComposer -> ComposerEditorPanel` 的深层转传问题。继续做对象分组只能缓解表面复杂度，不能解决状态来源和跨层调用越来越重的问题。

## 目标

本次 Pinia 迁移的目标：

1. 消除聊天输入区和生成参数区的大量机械 props/events 转传。
2. 让深层组件可以直接读取所属领域的状态，而不是依赖上层逐级传递。
3. 将跨组件共享状态移动到明确的 store 边界。
4. 保留 service 层，store 调用现有 IndexedDB、API、备份等 service。
5. 保留 `useStudioViewModel` 作为过渡期页面装配层，避免一次性推倒重来。
6. 每个阶段都保持可构建、可测试、可回退。

非目标：

- 不一次性迁移所有状态。
- 不把所有东西塞进一个 `studioStore`。
- 不重写 UI。
- 不改变 IndexedDB 数据结构，除非对应阶段单独定义迁移。
- 不在同一轮里重构备份格式、companion 协议或生成 API 客户端。

## 设计原则

### Store 负责跨组件共享状态

适合进入 Pinia 的状态：

- 多个不相邻组件都要读写。
- 需要跨页面区域协调。
- 当前正在被多层组件机械转传。
- 具备清晰业务领域，例如 settings、composer、images、conversations。

不适合进入 Pinia 的状态：

- 单个组件内部 UI 状态，例如 hover、展开动画、临时搜索输入。
- 拖拽深度、局部弹窗 pending file、局部 canvas 绘制状态。
- 纯展示组件的选中项，除非其他区域也需要感知。

### 避免大一统 Store

不要创建一个包含所有状态和方法的 `studioStore`。这只会把大的 `useStudioViewModel` 换成大的 store。

推荐按领域拆分：

```text
src/stores/
  settingsStore.ts
  composerStore.ts
  imagesStore.ts
  conversationsStore.ts
  generationStore.ts
  feedbackStore.ts
```

具体文件名可以在落地时按项目命名风格微调，但边界应保持清晰。

### ViewModel 过渡期保留

迁移过程中保留 `useStudioViewModel`：

- 继续负责页面级装配。
- 继续协调尚未迁移的 composable。
- 作为 Pinia store 和旧 feature composable 之间的过渡层。

当主要领域都迁移后，再评估是否拆薄或移除 `useStudioViewModel`。

### Service 层不搬进 Store

`src/services/*` 继续作为底层能力：

- IndexedDB 读写
- 图片 Blob 管理
- 备份导入导出
- ZIP 打包
- 设置持久化
- API 请求封装

Store 可以调用 service，但不要把 service 的底层实现内联到 store。

## 目标结构

短期目标：

```text
src/
  stores/
    settingsStore.ts
    composerStore.ts

  app/
    studio/
      useStudioViewModel.ts

  features/
    settings/
    generation/
    images/
    conversations/
```

中期目标：

```text
src/
  stores/
    settingsStore.ts
    composerStore.ts
    imagesStore.ts
    conversationsStore.ts
    generationStore.ts
    feedbackStore.ts

  services/
  components/
  app/
```

## 阶段一：引入 Pinia 基础设施

目标：只安装和注册 Pinia，不迁移业务状态。

任务：

- [x] 安装 `pinia`。
- [x] 在 `src/main.ts` 中注册 `createPinia()`。
- [x] 建立 `src/stores/` 目录。
- [x] 添加一个最小 store 或空目录占位，确认类型检查通过。

验收：

- [x] 应用启动行为不变。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

风险：

- 很低。这个阶段不改变业务状态来源。

## 阶段二：迁移生成参数 Settings Store

目标：优先迁移当前穿参最重的生成参数和接口设置。

建议新增：

```text
src/stores/settingsStore.ts
```

迁移状态：

- [x] `model`
- [x] `connectionMode`
- [x] `apiKey`
- [x] `apiBaseUrl`
- [x] `activeSizePreset`
- [x] `sizeResolution`
- [x] `imageWidth`
- [x] `imageHeight`
- [x] `quality`
- [x] `background`
- [x] `outputFormat`

迁移派生状态：

- [x] `sizeLabel`
- [x] `qualityLabel`
- [x] `backgroundLabel`
- [x] `formatLabel`
- [x] `customSizeError`
- [x] `currentGenerationParams`

迁移常量/选项：

- [x] `qualityOptions`
- [x] `backgroundOptions`
- [x] `formatOptions`
- [x] `sizeRatioOptions`
- [x] `sizeResolutionOptions`

迁移动作：

- [x] `applySizePreset`
- [x] `applySizeResolution`
- [x] `applySettings`
- [x] `saveCurrentSettings`

组件调整：

- [x] `ChatComposer.vue` 不再从父组件接收生成参数、labels、options。
- [x] `ComposerEditorPanel.vue` 直接读取 `settingsStore`。
- [x] `ComposerParameterBar.vue` 直接读取 labels 和 `model`，或接收一个更小的展示对象。
- [x] `SettingsModal.vue` 可以暂时继续通过 `useStudioViewModel` 传 API 设置，等后续阶段再收口。

推荐落地方式：

1. 先让 `settingsStore` 复用 `useStudioSettings` 中的常量和校验逻辑。
2. 再逐步把 `useStudioSettings` 的状态源替换为 Pinia。
3. 最后删除或瘦身 `useStudioSettings`。

验收：

- [x] `ChatWorkspace -> ChatComposer` 的生成参数 props 数量显著减少。
- [x] `ComposerEditorPanel` 不再接收十几个生成参数 props。
- [x] API 设置保存和恢复行为不变。
- [x] 草稿中的生成参数保存和恢复行为不变。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

风险：

- 设置持久化和草稿恢复都依赖生成参数，需要重点测试刷新恢复。
- 自定义尺寸校验不能丢。
- `currentGenerationParams` 是生成请求的重要输入，需要保持字段完全一致。

## 阶段三：迁移 Composer Store

目标：迁移聊天输入框、编辑模式和局部工作区开关状态，继续减少 `ChatWorkspace -> ChatComposer` 穿参。

建议新增：

```text
src/stores/composerStore.ts
```

迁移状态：

- [x] `composerText`
- [x] `activeEditor`
- [x] `editModeEnabled`
- [x] `activeEditSourceImageId`
- [x] `activeEditMaskImageId`
- [x] `isLibraryOpen`
- [x] `isConversationSidebarOpen`

迁移动作：

- [x] `toggleEditor`
- [x] `closeAllEditors`
- [x] `setEditModeEnabled`
- [x] `applyEditSelection`
- [x] `clearEditSelection`
- [x] `setLibraryOpen`
- [x] `openConversations`

草稿相关：

- [x] 当前对话草稿读取。
- [x] 当前对话草稿保存。
- [x] 切换会话时应用草稿。
- [x] 删除会话时清理草稿。

组件调整：

- [x] `ChatComposer.vue` 直接读取 composer store。
- [x] `PromptInputBox.vue` 可以继续保持受控组件，也可以在后续阶段接入 store。
- [x] `ComposerAttachmentList.vue` 只保留附件展示 props，或等 images store 阶段再收口。
- [x] `ChatWorkspace.vue` 保留拖拽状态和 mask modal 选择状态，因为它们是局部 UI 协调。

验收：

- [x] 输入框内容输入、刷新恢复、切换会话恢复都正常。
- [x] 编辑模式开启/关闭、mask 清理行为正常。
- [x] 移动端图片库开关和会话侧边栏开关正常。
- [x] `ChatComposer` props 进一步减少。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

风险：

- 草稿保存有防抖和会话切换队列，迁移时要保持时序。
- 编辑模式关闭时需要清理 transient mask，当前逻辑涉及 images 能力，可能需要临时从 store 间调用或保留在 ViewModel。

## 阶段四：迁移 Images Store

目标：迁移图片资产、附件、图片库和 transient mask 相关状态。

建议新增：

```text
src/stores/imagesStore.ts
```

迁移状态：

- [x] `imageAssets`
- [x] `attachedImages`
- [x] `activeAttachments`
- [x] `storageUsage`

迁移动作：

- [x] `imageById`
- [x] `attachImage`
- [x] `removeAttachment`
- [x] `importImages`
- [x] `deleteImage`
- [x] `deleteImages`
- [x] `renameImage`
- [x] `setImageTagColor`
- [x] `hydrateImagePreviews`
- [x] `createMaskAsset`
- [x] `clearTransientMask`
- [x] `refreshStorageUsage`

组件调整：

- [x] `ComposerAttachmentList.vue` 可以直接读取 active attachments，或接收一个较小对象。
- [x] `MessageList.vue` 和 `MessageItem.vue` 根据实际情况决定是否直接读 image store。
- [ ] `ImageLibrary.vue` 可以直接读取图片列表和 storage usage。

验收：

- [x] 图片导入、预览、引用、删除、重命名正常。
- [x] transient mask 创建和清理正常。
- [x] 图片库当前会话/全部图片过滤正常。
- [x] 存储用量刷新正常。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

风险：

- 图片 Blob、object URL 和 transient mask 生命周期比较敏感。
- 删除图片后历史消息占位提示不能回退。
- 备份恢复依赖图片资产结构，迁移时不应改变数据形状。

## 阶段五：迁移 Conversations Store

目标：迁移会话、当前会话、消息列表和会话标题摘要逻辑。

建议新增：

```text
src/stores/conversationsStore.ts
```

迁移状态：

- [x] `conversations`
- [x] `activeConversationId`
- [x] `messages`
- [x] `activeConversation`
- [x] `activeMessages`

迁移动作：

- [x] `createConversation`
- [x] `selectConversation`
- [x] `deleteConversation`
- [x] `deleteConversations`
- [x] `renameConversation`
- [x] `persistConversation`
- [x] `updateConversationSummary`
- [x] `createConversationRecord`

组件调整：

- [ ] `ConversationSidebar.vue` 可以直接读取 conversations store。
- [x] `MessageList.vue` 可以直接读取 active messages，或继续接收纯展示 props。
- [ ] 设置批量会话操作可以读取 conversations store。

验收：

- [x] 新建、切换、删除、重命名会话正常。
- [x] 会话标题自动更新和手动标题保护正常。
- [x] 切换会话时草稿联动正常。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

风险：

- 会话和草稿、图片、生成任务都有交叉依赖。
- 删除会话需要同时清理草稿并刷新存储用量。

## 阶段六：迁移 Generation Store

目标：迁移生成任务、提交消息、重试消息和图片客户端调用。

建议新增：

```text
src/stores/generationStore.ts
```

迁移状态：

- [x] generation jobs
- [x] `pendingJobCount`
- [x] `pendingJobCountByConversation`
- [x] `isGenerating`
- [x] `activeConversationPendingJobs`
- [x] `canSend`

迁移动作：

- [x] `submitMessage`
- [x] `retryMessage`
- [x] 文生图请求
- [x] 图片编辑请求
- [x] 生成成功写入图片库
- [x] 生成失败写入错误消息

组件调整：

- [x] `ChatComposer.vue` 直接读取 `canSend`、`isGenerating`。
- [x] `ConversationSidebar.vue` 读取每个会话的 pending job count。
- [x] `ChatWorkspace.vue` 读取当前 pending job count。

验收：

- [ ] 文生图正常。
- [ ] 引用图编辑正常。
- [ ] mask 编辑正常。
- [ ] 失败重试正常。
- [ ] 并发任务计数展示正常。
- [x] 页面挂载烟测通过。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

风险：

- 这是依赖最多的阶段，涉及 settings、composer、images、conversations。
- 需要避免循环 store 调用导致逻辑难读。
- 生成请求输入字段不能改变。

## 阶段七：反馈和弹窗 Store 评估

目标：视迁移后复杂度决定是否迁移反馈、确认框、toast、重命名弹窗等 UI 协调状态。

候选 store：

```text
src/stores/feedbackStore.ts
```

迁移候选：

- [x] notice toast
- [x] confirm dialog
- [ ] rename conversation modal
- [ ] rename image modal

建议：

`notice toast` 和 `confirm dialog` 已迁移到 `feedbackStore`，并让 `imagesStore`、`conversationsStore` 直接使用，减少通过 `useStudioViewModel` 注入提示/确认回调。

`rename conversation modal` 和 `rename image modal` 仍然只在页面级工作流里使用，暂时继续留在 `useStudioViewModel`。不要为了追求纯度而迁移。

验收：

- [x] `imagesStore` 不再通过 context 接收提示/确认回调。
- [x] `conversationsStore` 不再通过 context 接收提示/确认回调。
- [x] `useStudioFeedback` 作为兼容包装层保留。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build` 通过。

## 组件最终目标

迁移完成前两阶段后，`ChatWorkspace.vue` 中的 `ChatComposer` 调用应接近：

```vue
<ChatComposer
  ref="composerRef"
  :is-drag-active="isDragActive"
/>
```

`ChatComposer.vue` 内部直接使用 store：

```ts
const settings = useSettingsStore();
const composer = useComposerStore();
const generation = useGenerationStore();
const images = useImagesStore();
```

`ComposerEditorPanel.vue` 不再接收大量生成参数 props，而是直接读取 `settingsStore` 并调用对应 action。

## Store 间依赖建议

允许 store 间调用，但要保持方向清晰。

推荐依赖方向：

```text
generationStore
  -> settingsStore
  -> composerStore
  -> imagesStore
  -> conversationsStore

composerStore
  -> imagesStore

backup/restore orchestration
  -> settingsStore
  -> imagesStore
  -> conversationsStore
  -> composerStore
```

注意：

- 不要让所有 store 互相调用。
- 如果某个动作需要协调多个 store，可以先留在 `useStudioViewModel` 或建立明确的 orchestration composable。
- 复杂恢复流程可以暂时不放进任何单一 store。

## 测试策略

每个阶段至少执行：

```sh
pnpm typecheck
pnpm test
pnpm build
```

建议补充测试：

- settings store 的参数转换和校验测试。
- composer store 的草稿保存/恢复测试。
- images store 的附件、mask、删除行为测试。
- generation store 的 submit/retry 流程测试。

手动回归清单：

- [ ] 刷新后设置恢复。
- [ ] 切换会话后草稿恢复。
- [ ] 上传/粘贴/拖拽图片作为引用图。
- [ ] 文生图。
- [ ] 引用图编辑。
- [ ] mask 编辑。
- [ ] 图片库引用、删除、重命名、批量下载。
- [ ] 备份导出和恢复。
- [ ] 移动端侧边栏和图片库开关。

## 回滚策略

每个阶段单独提交。

推荐提交粒度：

```text
chore: add pinia
refactor: move generation settings to pinia
refactor: move composer state to pinia
refactor: move image state to pinia
refactor: move conversation state to pinia
refactor: move generation jobs to pinia
```

如果某阶段风险变大：

1. 保留已通过的前置阶段。
2. 回滚当前阶段提交。
3. 将未解决问题记录到本文档对应阶段。

## 开放问题

- `useStudioSettings` 是直接删除，还是保留为 settings store 的兼容 wrapper？
- `PromptInputBox` 是否应该保持纯受控组件，还是直接读 composer store？
- `MessageList` 是否应该直接读 images store，还是继续作为纯展示列表？
- 备份恢复流程是否需要独立 orchestration 层，而不是放进单个 store？
- Store 类型是否需要统一导出到 `src/stores/index.ts`？

## 推荐下一步

下一次实现建议只做阶段一和阶段二的一部分：

1. 安装并注册 Pinia。
2. 新建 `settingsStore`。
3. 迁移生成参数、labels、options 和参数 action。
4. 改 `ComposerEditorPanel` 直接读 settings store。
5. 保留 API key/Base URL 的设置弹窗接线，等第二个小步再处理。

这样可以优先消掉最刺眼的 `ChatComposer -> ComposerEditorPanel` 参数转传，同时把风险控制在生成参数这一块。
