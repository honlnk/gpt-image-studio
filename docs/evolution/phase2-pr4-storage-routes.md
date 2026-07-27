# 阶段二 PR4：Companion 侧 /storage/* 路由 + 集成测试

> **状态：🚧 进行中**
>
> 依赖：PR1（db）+ PR2（imageStore）+ PR3（datasetRegistry）
>
> 目标：把前三层的存储能力通过 HTTP 暴露给前端 CompanionStorage。前端 fetch `${companionUrl}/storage/*` 完成全部 CRUD、图片二进制读写、配置读写、数据集管理。

## 1. 路由设计

### 鉴权决策（简化）

全部 `/storage/*` 路由走 **bearer accessKey**（数据面），在 authMiddleware 之后注册。

理由：阶段二本机单用户场景，用户连上 Companion 就持有 accessKey。数据集激活/切换虽算管理操作，但本机模式下没有跨租户风险。真正敏感的「不应跨域暴露」操作（OSS 凭据录入、平台级管理）走 `/admin/*` + loopbackGuard（PR5/PR8）。这样 PR4 只需一个 plugin，注册位置与 imagesRoutes 同级。

### 路由清单

| Method | Path | 功能 |
|---|---|---|
| GET | `/storage/datasets` | 列出全部数据集（视图） |
| GET | `/storage/datasets/active` | 获取当前激活数据集 + 存储位置信息 |
| POST | `/storage/datasets/activate` | 切换/创建数据集（body: storageKind/storageConfig/imageStoreKind） |
| DELETE | `/storage/datasets/:id` | 删除数据集（级联删 db 文件） |
| PATCH | `/storage/datasets/:id` | 重命名数据集（body: label） |
| GET | `/storage/:table` | 列出某表全部记录 |
| GET | `/storage/:table/:key` | 取单条 |
| PUT | `/storage/:table/:key` | upsert（body: value） |
| DELETE | `/storage/:table/:key` | 删单条 |
| DELETE | `/storage/:table` | 清空表 |
| POST | `/storage/blobs/:key` | 上传图片二进制（multipart，field: file + mimeType） |
| GET | `/storage/blobs/:key` | 下载图片二进制（返回 image/* 或 application/octet-stream） |
| DELETE | `/storage/blobs/:key` | 删图片 |
| GET | `/storage/blobs/:key/size` | 查图片字节大小（用于 estimateStoredBytes，避免全量下载） |
| GET | `/storage/config/:key` | 读配置项 |
| PUT | `/storage/config/:key` | 写配置项 |
| GET | `/storage/usage` | 容量估算（imageBytes + metadataBytes） |

`:table` 走 isBusinessTable 白名单校验（防注入）。

### 请求/响应契约

- 表 CRUD 的 value 直接是 JSON body（PUT 的 body = 业务对象本身，不是 `{ value: ... }` 包装）。
- 图片上传 multipart：field `file`（二进制）+ field `mimeType`（如 image/png）。
- 图片下载：`reply.header("Content-Type", mimeType).send(buffer)`。
- 配置读写：value 是 JSON body（任意类型）。
- 容量估算：`{ imageBytes, metadataBytes }`，metadataBytes 从业务 db 各表 SUM(length(value)) 算，imageBytes 从 imageStore.estimateBytes() 算。

## 2. 改造范围

### 新增文件
- `companion/src/routes/storage.ts` —— /storage/* 路由 plugin

### 改动文件
- `companion/src/server.ts` —— 注册 storageRoutes（authMiddleware 之后）+ 启动时调 ensureDefaultDataset
- `companion/src/storage/businessDb.ts` —— 新增 `estimateMetadataBytes(dbPath)` 辅助函数
- `companion/src/types.ts` —— 新增存储相关响应类型（可选，TS 类型对齐用）

## 3. 测试计划

`companion/src/routes/storage.test.ts`（集成测试，真实 Fastify + 真实 SQLite）：
- 表 CRUD：list 空、put/get 往返、upsert、delete、clear、隔离。
- 非法表名 400。
- 缺 bearer 401。
- 图片上传/下载/删除往返。
- 图片下载不存在返回 404。
- 配置读写。
- 数据集 activate 切换 + active 查询。
- 容量估算数值合理。
- ensureDefaultDataset 启动后 active 存在。

沿用 credentials.integration.test.ts 的隔离模式（Fastify + GPT_IMAGE_STUDIO_CONFIG_DIR tempDir）。

## 4. 验收门槛
- `pnpm typecheck:companion` + `pnpm test` 全绿
- 集成测试覆盖全部路由
- 现有功能不受影响
