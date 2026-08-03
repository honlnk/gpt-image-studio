# 阶段三 PR9：图片加载性能优化（缓存头 + 懒加载 + 加载态占位）

> 状态：🚧 进行中
> 前置：PR7/PR8（嵌入态 demo 联调中发现 OSS 图片加载慢）
> 关联决策：D6（图片存储 adapter）、D11（OSS STS）

## 1. 背景与问题

PR7/PR8 demo 联调时观察到：嵌入态（5599）图片加载明显慢于独立态（8888）。实测定位（容器内直接计时 + curl 并发测试）排除 qiankun/CORS/Docker 转发，根因是 **OSS 图床的云端拉取链路**：

1. **无 HTTP 缓存**：`GET /storage/blobs/:key` 响应没有任何缓存头，每次刷新都从 OSS 全量重拉（演示数据集 ~11MB/次）。
2. **启动全量并发**：前端 `hydrateImagePreviews` 对全部图片 `Promise.all` 并发 `loadBlob`，共享的 OSS 下行带宽（实测聚合 ~10MB/s）被打满，每张都慢；且 `imageAssets` 等全部下载完才赋值，图片"憋"到最后一次性出现。
3. **加载中被误显示为"已删除"**：`ResultImageCard`/`ImageCard` 只看 `previewUrl` 是否为空，hydrate 期间所有图片都显示"图片已删除"占位，误导用户。

## 2. 方案

### 2.1 Companion：blob GET 加缓存头

`companion/src/routes/storage.ts` 的 `GET /storage/blobs/:key` 响应加：

```
Cache-Control: private, max-age=31536000, immutable
```

- **安全性**：blobKey 是每张图生成时的 UUID、内容不可变（新图 = 新 key），长缓存 + immutable 安全。
- **private**：路由带鉴权且按用户数据集隔离，不允许共享缓存（CDN/代理）存储。
- **效果**：浏览器二次加载直接 disk cache，只有首次加载走 OSS。对 OSS/文件系统两种后端、独立/嵌入两种形态都有收益。

### 2.2 前端：预览懒加载（状态机 + 优先级队列）

`src/stores/imagesStore.ts`：

- **状态机**：`previewStates: Record<id, "loading" | "error">`。idle = 无记录，loaded = `previewUrl` 存在（不记录，与 `previewUrl` 同为运行时附加信息）。不改 `ImageAsset` 类型。
- **优先级队列**：FIFO + `inFlight`，并发上限 `PREVIEW_MAX_CONCURRENT = 2`。OSS 带宽共享，并发越高每张越慢；IndexedDB 本地读毫秒级，低并发无感。
- **`ensurePreviewLoaded(id)`**：单张加载入口，去重（loaded/loading/排队中跳过），error 可重试。加载成功逻辑含原 hydrate 的缺宽高回读（`readImageDimensions` + `saveAsset` 落盘）。
- **`prioritizePreviews(ids)`**：插队队首。
- **自动优先级**：`configureImagesStore` 注册 `activeConversationId` watch（重复 configure 先停旧 watch），切会话时新会话图片按 createdAt 降序插队——对齐"聊天区从最下面（最新）逐层向上加载"。
- **hydrate 改造**：`hydrateImagePreviews` 不再 `await loadBlob`，只装配 metadata 并 `queueMicrotask` 推迟 prioritize 当前会话图片（微任务是因为调用方 restore 在函数返回后才赋值 `imageAssets`，立即 pump 会因 `imageById` 找不到记录把 id 当失效跳过）。启动不再被图片下载阻塞。

### 2.3 组件层：按需触发 + 三态占位

| 组件 | 触发方式 | 占位 |
|---|---|---|
| `ResultImageCard`（聊天区） | `onMounted` + watch `imageId` | 骨架"加载中…" / "加载失败 点击重试" / "图片已删除"（asset 不存在或无 blobKey）三态 |
| `ImageCard`（图片库） | **IntersectionObserver 自观察**（rootMargin 200px 预取），进入视口才请求 | 转圈 / `!` 重试 / `img`（idle） |
| `ImagePreviewModal` | 打开时 watch `image.id` immediate 触发 | 大图加载中占位；下载按钮仅在 previewUrl 存在时渲染 |
| `ComposerAttachmentList` | `watchEffect` 扫附件触发（草稿恢复场景） | 缩略图转圈占位 |

图片库懒加载用 IntersectionObserver 而非 DOM 分页（"只渲染前 20 个"）：IO 等价限制请求量（首屏可见数 ≈ 20），但不引入分页状态，计数/过滤/选中逻辑零改动。每张卡片自观察（root=null 视口），对过滤切换导致的列表重建天然健壮。

### 2.4 已评估不做

- **真·渐进式渲染**（图片从上往下逐行显现）：是浏览器对 progressive JPEG 原生 `<img>` 流式解码的能力。当前链路 fetch 完整 blob → `createObjectURL`，拿不到中间态；要做需改鉴权让 `<img>` 直连（query token/签名 URL），是大改。缓存头 + 懒加载后收益边际。
- **图片库 DOM 分页**：见 2.3，IO 等价且零侵入。

## 3. 改造清单

| 文件 | 改动 |
|---|---|
| `companion/src/routes/storage.ts` | blob GET 加 Cache-Control 头 |
| `companion/src/routes/storage.test.ts` | 缓存头断言 |
| `src/stores/imagesStore.ts` | 状态机 + 队列 + ensure/prioritize + hydrate 改造 + activeConversationId watch |
| `src/stores/imagesStore.test.ts` | 新增 9 用例（去重/并发上限/插队/error 重试/hydrate 不拉 blob/切会话插队） |
| `src/features/backup/useStudioRestore.ts` | hydrate 调用点适配（同步、不再阻塞） |
| `src/components/chat/message-parts/ResultImageCard.vue` | 触发加载 + 三态占位 |
| `src/components/image-library/ImageCard.vue` | IO 自观察懒加载 + 三态缩略占位 |
| `src/components/studio/ImagePreviewModal.vue` | 打开时确保加载 + 加载态 |
| `src/components/chat/ComposerAttachmentList.vue` | 附件触发加载 + 缩略占位 |

## 4. 验收门槛

- [x] `pnpm typecheck` 通过
- [x] `pnpm test` 全绿（web 1198：1189 + 新增 9；companion 734）
- [x] blob GET 响应带 `Cache-Control: private, max-age=31536000, immutable`（两个 Companion 实测）
- [ ] 手动验收：清空缓存刷新 → UI 立即渲染 + 骨架占位；当前会话最新图片最先出现；图片库滚动时新入视口的图片才发请求；二次刷新全部 disk cache
- [ ] 加载中不再显示"图片已删除"；真删除仍显示"已删除"

## 5. 实施记录

（合并后填写）
