# GPT Image Studio 架构演进路线图

> 本文档是**架构形态演进**的纲领，与 [`roadmap.md`](./roadmap.md)（业务功能演进）相互独立。
> - `roadmap.md` 回答："产品还要做什么功能"
> - 本文档回答："整个项目要以什么形态交付、如何从当前形态一步步演进"
>
> 所有后续架构决策都应以本文档为准。一旦阶段目标变化，先更新本文档，再落地。

---

## 一、当前形态（基线）

| 维度 | 现状 |
|---|---|
| 前端 | 单体 Vue 3 SPA，独立部署（GitHub Pages） |
| 存储 | 全部 IndexedDB + 少量 localStorage，无后端 |
| 模型调用 | 二选一：浏览器直连（direct）/ 本地 Companion 代理（localCompanion） |
| Companion | Fastify loopback 薄代理，**零业务数据持久化**，仅管凭据/日志 |
| 桌面端 | Tauri v2 纯壳，前端完全不感知运行环境，行为同 Web |
| 集成能力 | 无（不可嵌入、不可独立组件化） |

**核心限制**：
- 浏览器存 API Key 不安全 → direct 模式只能做单 provider
- IndexedDB 抽象、容量受限、不可外部访问 → 数据无法跨设备/跨应用
- 前端无运行时抽象 → 无法区分"浏览器 / Tauri / 子应用"环境
- Companion 是无状态代理 → 没法承载真实业务数据

---

## 二、演进动机

四条独立的演进驱动力，对应四个阶段：

1. **可后端化**：让 Companion 从"代理"升级为"真实数据后端"，存储上 OSS、表结构上 DB——为上云做准备。
2. **可集成**：把前端做成可嵌入其他宿主项目（Vben 等）的子项目；把 Companion 做成可嵌入其他后端（RuoYi-Plus 等）的模块。
3. **可独立**：用 Tauri 打包成正经可安装 APP，**与云完全无关**，本地完整体验。
4. **可维护**：在整个演进过程中，保持前端业务代码（store / service / 组件）对"后端是什么"无感知。

> **关键洞察**：这四条驱动力共享同一个缺失的底座——**前端运行时与存储抽象层**。把这层补齐，四个阶段才能平滑衔接，否则每一步都要重写业务层。

---

## 三、阶段总览

```
阶段零（前置）       阶段一               阶段二                阶段三                阶段四
Companion 管理页  →  存储抽象层      →    Companion       →     服务化 +        →     APP 化
边界正本清源         （地基）              后端化                 可嵌入                （可独立）
                                          （真实数据）           （多用户 SaaS）

废弃 Web 项目的      direct: IndexedDB    direct: IndexedDB     服务器部署           APP 内置 Companion
/companion 页面，    companion: IndexedDB companion: SQLite     多用户 + SSO         + SQLite 本地
Companion 自带       （行为不变）          + 文件/OSS 图片       qiankun 前端嵌入     与云无关
独立管理页

                                        业务代码零改动 ◄────── 业务代码零改动 ◄────── 业务代码零改动 ◄───── 业务代码零改动
                                        （因为接口已经就位）   （只换 Storage 实现）  （加多租户层+打包）   （只换 Storage 实现）
```

| 阶段 | 一句话目标 | 主要工作量在哪 | 业务代码改动 |
|---|---|---|---|
| **零** | Companion 自带管理页，废弃 Web 项目的 `/companion` 页面 | Companion 加静态管理页 + Web 项目清理路由 | 小（清理 Web 项目违规页面） |
| **一** | 在前端引入 `StudioStorage` 抽象层 | 前端 service/store 重构 | 大（一次性） |
| **二** | Companion 从代理升级为真实数据后端（本机单用户） | Companion 后端新增存储路由 + 数据集管理 | 零（只换实现） |
| **三** | Companion 服务化（服务器多用户）+ 前端 qiankun 嵌入 | 多租户层 + 完整 SSO + 前端打包 + Docker 化 | 零（加多租户层，不改业务 schema） |
| **四** | Tauri APP 内置 Companion 能力 + 本地 SQLite（**暂不做详细计划**） | Tauri 壳 + Rust 侧存储 | 零 |

**核心原则**：阶段一是地基，**阶段二、三、四在前端业务层都应是"换实现不改接口"**。如果某个阶段被迫改动 store/service 的业务代码，说明阶段一的抽象设计有缺陷，需要回头补。

**阶段零的特殊性**：阶段零是历史欠账的补全，与架构演进的主线（存储抽象）正交。它的目的是在开始架构演进之前，先把 Companion 和 Web 项目之间的边界理清——Companion 的凭据管理回到 Companion 自己手里，Web 项目不再触碰 provider 凭据。这样后续阶段才能在一个边界干净的状态下推进。

---

## 四、阶段零：Companion 管理页边界正本清源（前置重构）

### 背景与动机

当前 Web 项目里有一个 `/companion` 路由页面（`src/pages/CompanionPage.vue`），它通过 `companionApi.ts` 直接读取 Companion 的 provider 凭据（`GET /credentials` 明文返回 apiKey）。这是当初开发时的调试权宜之计，但**违反了 `docs/companion.md` 里明确的"普通项目备份不导出 Companion 凭据"原则**，也违反了"Web 项目不触碰 provider 凭据"的产品边界。

在开始架构演进（阶段一及之后）之前，必须先把这个边界理清，否则后续阶段都会带着这个违规往前走。

### 目标

让 Companion 的凭据管理回到 Companion 自己手里：
- Companion 自带一个独立的 web 管理页，用户在浏览器访问 Companion 自己的地址（如 `127.0.0.1:19750/admin`）来管理 provider 凭据。
- Web 项目不再包含任何 provider 凭据管理 UI，`/companion` 路由页面废弃。
- Web 项目通过 `useCompanionConnection`（健康检查 + auth/status 探测）感知 Companion 的连接状态——这部分保留，因为它读的是"状态"不是"凭据"。

### 技术方案：Companion 自带轻量管理页

**技术栈**：原生 HTML + 原生 JavaScript（vanilla JS）+ 内联 CSS。**不引入任何框架**（不上 Vue/React，也不上 Alpine/Petite-Vue 这类轻量框架）。

**理由**：管理页功能简单（provider 凭据 CRUD + 连通性测试 + 日志查看），原生三件套完全够用，零依赖、零构建链、维护成本最低。

**产物形态**：
```
companion/
├── admin/                      ← 管理页源码（原生三件套）
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── src/
    └── routes/
        └── admin.ts            ← 静态资源 serve + 管理面专用路由
```

- `index.html` + `app.js`（预计几百行）+ `styles.css`，直接 fetch 调 Companion 自己的 `/credentials/*` 接口。
- Companion 启动时把 `admin/` 作为静态资源 serve 在 `/admin` 路径。
- 访问 `http://127.0.0.1:19750/admin` 即打开管理页。

### 访问控制（按部署形态区分）

| 部署形态 | 管理页是否启用 | 访问方式 |
|---|---|---|
| **本机 loopback（阶段二）** | ✅ 启用 | 用户直接访问 `127.0.0.1:19750/admin`，受 loopbackGuard 保护 |
| **服务器多用户（阶段三）** | ❌ 默认关闭 | 管理功能由主项目后台通过 Companion 的管理 API（`/admin/*`，平台级密钥鉴权）调用，不暴露 web 管理页避免攻击面 |

服务器模式下，主项目后台是 Companion 的"管理面客户端"——它通过 API 操作 Companion（如配置平台 OSS、查看用户用量、清理孤儿数据），用户在主项目后台 UI 里完成这些操作，看不到 Companion 自己的管理页。

### 关键工作

1. **Companion 侧**
   - 新增 `companion/admin/` 目录，编写原生三件套管理页
   - 新增 `companion/src/routes/admin.ts`，serve 静态资源 + 管理面专用路由（受 loopbackGuard 保护）
   - 管理页功能对齐当前 Web 项目 `/companion` 页面的能力：provider 凭据 CRUD、激活切换、连通性测试、日志查看

2. **Web 项目侧**
   - 废弃 `src/pages/CompanionPage.vue` 及其相关代码
   - 清理 `src/services/companionApi.ts` 中**只服务于管理页**的凭据读写方法（`listCompanionCredentials` / `addCompanionCredential` / `updateCompanionCredential` / `removeCompanionCredential` / `activateCompanionCredential` / `resetEmptyCredentialStore` / `restoreBackupCredentialStore`）
   - 保留健康检查、auth/status 探测、日志查看（如果 Web 项目仍需要展示 Companion 连接状态）
   - 清理 `src/App.vue` 里的 `/companion` 路由分支

### 验收标准

- ✅ Companion 自带管理页，`127.0.0.1:19750/admin` 可访问，功能对齐原 Web 项目 `/companion` 页面
- ✅ Web 项目不再包含任何 provider 凭据读写代码（grep 不到 `listCompanionCredentials` 等调用）
- ✅ Web 项目仍能感知 Companion 连接状态（健康检查、auth/status 正常工作）
- ✅ Web 项目原有的 Companion 模式生成/编辑功能不受影响（这些只走 `/images/*`，不碰凭据）
- ✅ Companion 管理页只在本机 loopback 下可访问，服务器模式（阶段三）默认关闭

### 本阶段不做

- ❌ 不引入任何前端框架（保持原生三件套）
- ❌ 不做服务器模式的管理页启用机制（留给阶段三）
- ❌ 不动 Companion 的认证机制（仍用 accessKey）
- ❌ 不动 Web 项目的存储层（那是阶段一的事）

---

## 五、阶段一：前端存储抽象层（地基）

### 目标

在前端引入一层 `StudioStorage` 接口，把所有"直接调 IndexedDB / localStorage"的代码收敛到接口背后。**运行时行为与当前完全一致**，但存储后端变得可替换。

### 关键工作

1. **定义 `StudioStorage` 接口**（`src/services/storage/types.ts`）
   - 收敛现有 `db.ts` 的 5 个泛型函数（list/get/put/delete/clear）
   - 收敛图片二进制（saveImageBlob/loadImageBlob/deleteImageBlob）
   - 收敛轻量配置（readConfig/writeConfig）
   - 收敛容量估算（estimateUsage）
   - store 名沿用现有 `STORE_NAMES`（未来直接对齐 SQLite 表名）

2. **提供三个实现**
   - `IndexedDbStorage`：搬迁现有逻辑，**唯一真实实现**
   - `CompanionStorage`：骨架（throw 未实现），等阶段二填充
   - `NativeStorage`：骨架（throw 未实现），等阶段四填充

3. **运行时检测与工厂**
   - `isTauriRuntime()` 检测能力（第一阶段只检测，不切换）
   - `resolveStorage()` 工厂，**第一阶段永远返回 IndexedDbStorage**

4. **改造现有代码走注入**
   - 6 个 domain service（conversations/messages/imageAssets/settings/conversationDrafts/analyticsEvents）加 storage 参数
   - 5 个 store（generationStore/conversationsStore/imagesStore/settingsStore/analyticsStore）通过 context 接收 storage
   - hydrate 流程（`useStudioRestore`）改用注入的 storage
   - 备份模块（`backups.ts`）改用注入的 storage
   - view-model（`useStudioViewModel`）按运行时 + connectionMode 装配 storage，**与 imageClient 平行**

### 验收标准

- ✅ `pnpm typecheck` / `pnpm typecheck:companion` 通过
- ✅ `pnpm test` 全绿
- ✅ direct 模式所有功能（生成、编辑、导入、备份、草稿等）行为与改造前完全一致
- ✅ DevTools → IndexedDB 内容与改造前一致
- ✅ `StudioStorage` 接口设计可同时承载 KV（IndexedDB 形态）与关系型（SQLite/后端 DB 形态）

### 本阶段不做

- ❌ 不改 Companion 后端代码
- ❌ 不实现 CompanionStorage / NativeStorage 的真实逻辑（只留骨架）
- ❌ 不改 Tauri 壳
- ❌ 不改 UI、不改路由、不改 connectionMode 语义
- ❌ 不引入运行时数据迁移

### 为后续铺路

- 阶段二只需把 `CompanionStorage` 骨架替换成 fetch 实现
- 阶段四只需把 `NativeStorage` 骨架替换成 invoke 实现
- **前端业务代码（store/service）从此对"数据存在哪"无感知**

---

## 六、阶段二：Companion 后端化（真实数据）

### 目标

让 Companion 从"无状态代理"升级为"真实数据后端"。Web 端切到 Companion 模式时，**整个存储机制都走 Companion**（不只是模型调用），为后续嵌入 RuoYi-Plus、APP 内化 Companion 能力做铺垫。

### 前置条件

- ✅ 阶段一完成（`StudioStorage` 接口已就位）

### 存储形态设计

**核心原则**：把所有内容落到本地，结构化数据走轻量嵌入式 DB，图片走文件系统或 OSS（用户可选）。不强行上重型后端 DB——那是阶段三嵌入宿主时的事。

#### 结构化数据：SQLite

会话、消息、图片元数据、设置、草稿、分析事件全部进 **SQLite**（`better-sqlite3`）。

- 单文件、同步 API、查询能力强、零运维。
- 表名沿用 `STORE_NAMES`（`conversations` / `messages` / `imageAssets` / `imageBlobs` / `settings` / `conversationDrafts` / `analyticsEvents`），与阶段一的接口契约对齐。
- DB 文件默认存 `~/.gpt-image-studio/studio.db`。
- **选型理由**：与阶段四 Tauri 的 SQLite 路径天然对齐，未来 APP 直接复用同一份 schema 和迁移逻辑。

> 注：原来 `imageBlobs` 这张表（IndexedDB 里的二进制 store）在 Companion 模式下**不再用于存图片本体**，图片走下方的存储位置选项。`imageBlobs` 概念被"存储位置 + blobKey"取代。

#### 图片二进制：三选一存储位置（用户在设置中选）

图片不进 SQLite，由用户选择落到哪里。三种存储位置（storage location）：

| 选项 | 图片存哪 | 谁选目录 | 存储形态 | 适用场景 |
|---|---|---|---|---|
| **A. 指定目录** | 用户自选的本地文件夹（如 `~/Pictures/GPT-Image-Studio/`） | 用户 | 真实图片文件（.png/.webp/.jpg，可直接打开） | 想随时用文件管理器查看/整理图片的用户 |
| **B. 默认二进制** | Companion 默认目录（`~/.gpt-image-studio/images/`） | 默认，用户无需选 | 不透明 Blob（文件名是无意义的 key，非可直接打开的图片名） | 不想操心目录、只要数据安全的用户 |
| **C. 阿里云 OSS** | 阿里云 OSS bucket | 用户配置 bucket / AccessKey / endpoint | 上传到 OSS，本地只存 URL 引用 | 想跨设备访问、或图片量大的用户 |

**设计要点**：
- A 和 B 都是文件系统存储，差别只在"目录是否可配 + 文件是否可直接打开"。内部走同一个 `FileSystemImageStore` adapter，只是配置不同。
- C 是独立的 `OssImageStore` adapter，当前**仅兼容阿里云 OSS**，其他图床（S3、七牛、腾讯云等）暂不考虑。
- 无论哪种位置，`ImageAsset.blobKey` 在元数据里仍是唯一引用——A/B 模式下 blobKey = 文件名，C 模式下 blobKey = OSS object key。
- 前端 `CompanionStorage.saveImageBlob / loadImageBlob` 不感知具体位置，由 Companion 根据 settings 里的 storageLocation 配置路由到对应 adapter。

### 数据集管理设计

**核心约束**：图片存储位置（A/B/C）可切换，且切换时整套数据（会话+消息+图片元数据+图片文件）要隔离。但元数据本身必须本地化——OSS 模式下图片在云端，元数据（db）仍在本地。因此 db 与图片位置解耦，**db 永远在 `~/.gpt-image-studio/`，db 内部要能区分不同存储位置对应的数据集**。

**采用方案：主 db + 业务 db 双层结构（D7）**

```
~/.gpt-image-studio/
├── studio.db                     ← 主 db：只存"数据集注册表"（极小，几条记录）
│   └── 表 dataset_registry:
│       id, label, storage_kind, storage_config, db_path, created_at, activated_at
├── datasets/
│   ├── <dataset-id-1>.db         ← 业务 db（每个数据集一个）
│   ├── <dataset-id-2>.db         ← 内部 schema = 现有 7 张表，无 dataset_id 字段
│   └── ...
├── images/                       ← 选项 B 的默认图片目录
├── credentials.json
└── access-key.json
```

**两层职责**：
- **主 db `studio.db`**：只有一张 `dataset_registry` 表，记录"系统里有哪些数据集、各自绑定的存储位置、业务 db 文件路径"。极小、极稳，即使某个业务 db 损坏也不影响 registry。
- **业务 db `datasets/<id>.db`**：每个数据集一个独立文件，内部 schema 就是现有 7 张表（`conversations` / `messages` / `imageAssets` / `imageBlobs` / `settings` / `conversationDrafts` / `analyticsEvents`），**不加 `dataset_id` 字段**——因为整个 db 就是数据集。

**为什么这样设计**（对比另两个被否方案）：
- ❌ 方案"单 db + 所有表加 `dataset_id`"：会让 `StudioStorage` 接口的每次 `list(store)` 都得带 dataset 过滤，反向污染阶段一的接口设计，且 IndexedDB 实现（direct 模式）要假装有 dataset 概念。
- ❌ 方案"每个位置一 db，无注册表"：schema 同样零侵入，但数据集管理（查看/删除/重命名）要扫文件系统目录，不够干净。
- ✅ 采用的双层方案：**schema 零侵入**（业务表无 dataset_id），**接口零变化**（`StudioStorage.list(store)` 不变，只是底层连哪个业务 db 由数据集决定），**中央注册表**让数据集管理只需查主 db。

**数据集识别策略：按配置去重**
- 同一个存储配置（同一目录 / 同一 OSS bucket+prefix）始终复用同一个数据集，不重复创建。
- 用户先后两次选同一个目录 → 命中已有数据集 → 看到同一份数据（符合"切回原位置原数据还在"的预期）。
- 配置指纹规则（用于去重）：
  - `filesystem` 模式：`storage_kind + normalize(目录绝对路径)`。
  - `oss` 模式：`storage_kind + endpoint + bucket + prefix`（不含 AccessKey，避免凭证变更误判为新数据集）。

**切换流程**（以用户从 B 切到 A 指定 `/Users/x/Pics` 为例）：
1. Companion 计算新配置指纹 → 查 `dataset_registry` 是否已有匹配记录。
2. 命中 → 拿到已有 `db_path`；未命中 → 建 registry 记录 + 新建空业务 db。
3. 更新 `activated_at`，前端 reload（打开新业务 db）。
4. 业务 db 是空的 → 前端看到空数据集。
5. 用户后续切回 B → 同样流程，找到 B 对应的业务 db → 原数据可见。

**OSS 模式的特殊情况**：
- 业务 db 仍在本地（`~/.gpt-image-studio/datasets/<oss-id>.db`），只有图片在 OSS。
- OSS 配置（bucket/endpoint/prefix）存主 db 的 registry，AccessKey 存 `credentials.json`（与现有 provider 凭据同级别保护，不进项目备份）。
- 这样 OSS 数据集的"元数据本地、图片云端"边界清晰，未来即使 AccessKey 换了，数据集身份不变（指纹不含 AK）。

### 关键工作

1. **Companion 侧新增存储能力**
   - 在 `companion/src/routes/` 新增 `storage.ts` 路由，提供 7 张表的 CRUD
   - 引入 `better-sqlite3`，按 D7 双层结构组织：
     - 主 db `~/.gpt-image-studio/studio.db`（`dataset_registry` 表）
     - 业务 db `~/.gpt-image-studio/datasets/<id>.db`（7 张业务表）
   - 凭据管理（已有，`credentials.json`）保持不变
   - 新增图片存储 adapter 抽象：
     - `FileSystemImageStore`（覆盖选项 A、B）
     - `OssImageStore`（覆盖选项 C，仅阿里云 OSS）
   - 新增 `storageLocation` 设置项（A/B/C 三选一），存主 db 的 registry 而非业务表（避免被业务 db 切换影响）

2. **前端 `CompanionStorage` 实现填充**
   - 把骨架替换成 fetch 调用 `${companionUrl}/storage/*`
   - 图片二进制走 `${companionUrl}/storage/blobs/*`（multipart 上传、流式下载）
   - 配置（readConfig/writeConfig）走 Companion 的 settings 表（不再用 localStorage）
   - 设置页新增"存储位置"配置区，支持 A/B/C 三选一 + OSS 凭据录入

3. **运行时切换逻辑**
   - `resolveStorage` 在 Companion 模式下启用 `createCompanionStorage`
   - `watch(connectionMode)` 监听 direct ↔ Companion 切换，**整套数据 reload**（见下方"数据集隔离"决策）
   - `watch(storageLocation)` 监听 A/B/C 切换，**整套数据 reload**（见下方"数据集隔离"决策）
   - 顶栏 UI 区分"本地 IndexedDB / Companion 文件系统 / Companion OSS"等状态

4. **Companion 安全模型重设**
   - 现有 loopback + accessKey 模型适用于"单用户本机"
   - 一旦承载真实业务数据，需要重新考虑：容量配额、备份/恢复、并发写入
   - OSS 凭据属于敏感信息，存 Companion 本地（明文 + 0600，与现有 provider 凭据同级别），不进项目备份
   - 暂不引入多用户/账号系统（保留到阶段三之后）

### 关键决策：数据集隔离（选择机制，非迁移机制）

无论是 direct ↔ Companion 切换，还是 Companion 内 A/B/C 存储位置切换，都遵循**同一套数据集隔离原则**：

- **不主动迁移数据**。切换后，目标位置进入**空状态**，后续新内容全部按新位置存储。
- **不主动删除原数据**。切回原位置时，原来的数据都还在。
- **切换粒度是整套数据**：会话 + 消息 + 图片元数据 + 图片文件一起切，避免出现"消息指向别的位置的图片"的跨位置引用问题。

**为什么不做迁移**：
- 迁移是数据丢失/损坏的高风险区，不做迁移 = 不会丢数据。
- "我换了地方，所以这里是空的"比"正在迁移，请稍候"更符合用户直觉。
- 用户可以随时切回原位置找回数据，试错成本为零。

**UX 表现**：
- 切换前给确认提示："切换到 [新位置] 后，当前内容将不可见（不会删除），新内容会存到 [新位置]。切回 [当前位置] 可找回原有内容。"
- 切换后短暂 loading（reload 数据）。

> 这条决策是 D1"两套独立数据源"的延伸：D1 讲的是 direct vs Companion 的隔离，这里把它推广到 Companion 内部不同存储位置的隔离。统一为一个原则——**每个存储位置维护自己独立的数据集，互不迁移、互不污染**。

### 验收标准

- ✅ Companion 模式下，所有 CRUD 操作真实落到 SQLite + 图片存储位置
- ✅ Companion 关闭/重启后，数据仍在
- ✅ direct ↔ Companion 切换后，看到的数据集正确隔离（各自独立、不互相污染）
- ✅ A/B/C 存储位置切换后，看到的数据集正确隔离（同上）
- ✅ 切回原位置/原模式，原数据完整可见
- ✅ direct 模式行为不受影响（兼容性回归）
- ✅ OSS 模式下，图片真实上传到 OSS，本地只存引用
- ✅ Companion 后端的备份/恢复机制独立可用（不依赖前端 ZIP 导出）

### 本阶段不做

- ❌ 不上多用户/账号系统
- ❌ 不做 Companion 与 IndexedDB 的双向同步（数据集隔离，不迁移）
- ❌ 不做 A/B/C 之间的数据迁移（数据集隔离，不迁移）
- ❌ 不改 Companion 的技术栈（仍是 Node/TS + Fastify）
- ❌ 不兼容非阿里云 OSS 的图床（S3、七牛、腾讯云等暂不考虑）

### 为后续铺路

- Companion 已具备完整后端能力（存储 + provider 代理）→ 阶段三可平滑升级为服务器多用户服务
- D7 双层结构（主 db + 业务 db）→ 阶段三多租户隔离直接复用，业务 db schema 零改动（见 D9）
- 存储接口已验证可承载真实业务 → 阶段四的 NativeStorage 可照抄接口契约
- SQLite schema 已就位 → 阶段四 Tauri APP 直接复用同一份建表/迁移逻辑
- 图片存储 adapter 抽象（FileSystem / Oss）已就位 → 阶段四 APP 模式下可复用 FileSystem adapter

---

## 七、阶段三：服务化与可嵌入（多用户 SaaS 形态）

### 目标

把项目从"单机本地工具"升级为"可部署到服务器、多用户共享的 SaaS 后端 + 可嵌入宿主前端页面的子应用"：
- **后端**：Companion 从本机 loopback 升级为可远程访问的网络服务，支持多用户，对接宿主用户体系
- **前端**：用 qiankun 嵌入到 Vben 等宿主项目的页面中

### 关键认知：后端"服务化"而非"嵌入化"

> **重要决策调整**：后端不做"物理嵌入到某个宿主项目"的重构（不拆 package、不包装成 SpringBoot controller、不混部 Node 子进程）。Companion 作为**独立服务**部署，通过标准 HTTP/JSON API 与宿主（如 RuoYi-Plus）对接。
>
> 理由：服务边界应反映产品边界。Companion 是独立产品，就应是独立服务。强行物理嵌入是反模式——技术栈绑死、部署耦合、升级困难、收益却很小（独立服务能做同样的事）。这是标准的微服务架构思路（康威定律）。
>
> 前端值得做 qiankun 嵌入，因为那是运行时 UI 组合（松耦合、成本低、价值高）；后端不值得，因为那是代码级物理耦合（紧耦合、成本高、价值低）。

### 前置条件

- ✅ 阶段一完成（`StudioStorage` 接口已就位）
- ✅ 阶段二完成（Companion 已是完整后端：SQLite + 存储 adapter + 7 张业务表 + D7 数据集管理）

### 多租户隔离：复用阶段二 D7 的红利

阶段三最大的设计收益——**阶段二 D7 的"主 db + 业务 db 双层结构"天然适合升级为多租户**，业务表 schema 完全不动。

```
阶段二（单用户本机）：
~/.gpt-image-studio/
├── studio.db                      ← dataset_registry: id, storage_config, db_path, ...
└── datasets/
    └── <dataset-id>.db            ← 业务 db（7 张表，无 user_id 字段）

阶段三（多用户服务器）：
<server-data-dir>/
├── studio.db                      ← 升级后的主 db
│   ├── users                      ← 新增用户表
│   └── dataset_registry           ← 加 user_id 外键，指向 users
└── users/
    └── <user-id>/
        └── datasets/
            └── <dataset-id>.db    ← 业务 db schema 完全不变！（沿用阶段二的 7 张表）
```

**为什么这样设计**（对比被否的多租户方案）：
- ❌ 方案"共享库 + user_id 字段过滤"：所有业务表要加 `user_id`，每次查询带过滤，等于把 D7 否定的字段方案换个名字重来，破坏 schema 零侵入原则。
- ❌ 方案"每用户独立实例/PG schema"：运维复杂，偏离 SQLite 路径。
- ✅ 采用方案：**用户隔离下沉到"文件目录 + 主 db 注册表"层面**，业务 db 的 7 张表 schema 从阶段二到阶段三完全不动。这是 D7 设计的真正价值——它不只解决了"存储位置切换"，还顺手解决了"多租户隔离"。

业务 db 按用户隔离的物理路径：`<server-data-dir>/users/<user-id>/datasets/<dataset-id>.db`。

### 认证对接：完整 SSO（含单点登录、单点登出、令牌刷新）

阶段三实现**生产级 SSO**，不是基础形态。三个能力全部覆盖：

#### 1. 单点登录（SSO）

- 宿主（如 RuoYi-Plus）是身份提供者（IdP），负责完整的用户管理：注册、登录、权限、组织架构。
- 登录成功后，宿主签发 JWT，前端把 JWT 放在 `Authorization: Bearer` 头里发给 Companion。
- Companion 是资源服务器（RS），只验证 JWT（验签 + 过期检查），**不管理账号**，不做注册/登录/找回密码。
- JWT 的 `sub` 字段携带 `user_id`，可选 `display_name` claim（避免 Companion 反查宿主拿显示名），Companion 用 user_id 定位用户的业务 db。
- JWT 验签密钥通过环境变量配置（宿主和 Companion 共享同一对称密钥，或宿主提供公钥给 Companion 做非对称验签）。

#### 2. 单点登出（SLO）—— 需要后端间通信

JWT 是无状态的，Companion 拿到 JWT 验签通过就放行，**它不知道宿主那边用户已经登出**。所以必须宿主主动通知。

**机制**：宿主在用户登出时，调用 Companion 的吊销端点：

```
POST /admin/revoke
Authorization: Bearer <平台级管理密钥>   ← 区别于用户 JWT，这是 Companion 的管理凭证
Content-Type: application/json

{
  "user_id": "xxx",          // 按用户吊销（登出/封禁）
  "jwt_jti": "xxx"           // 可选：按单个 JWT 吊销（粒度更细）
}
```

Companion 收到后，把该 user_id（或 jti）加入**内存级吊销黑名单**，后续带该 user_id/jti 的 JWT 立即拒绝。黑名单只需保留到 JWT 原本过期的时间（过期后自然失效，可清理）。

**覆盖场景**：
- 用户主动登出 → 宿主调 `/admin/revoke`
- 用户被管理员封禁 → 宿主调 `/admin/revoke`
- 用户改密码 → 宿主调 `/admin/revoke`（让旧 JWT 失效，强制重新登录）

一个端点解决多个安全场景。Companion 的吊销黑名单是内存级的（重启清空，但 JWT 也会很快过期，风险可控）。

#### 3. 令牌刷新

- JWT 设较短有效期（如 30 分钟 ~ 1 小时），过期前前端静默刷新。
- 刷新是**前端 → 宿主**的调用（带 refresh token），不经过 Companion。
- 宿主签发新 JWT，前端拿到后更新请求头。
- Companion 不参与刷新流程，只认 JWT 有效性。

### 后端间通信契约

阶段三需要两个后端通信的场景，**全部走标准 HTTP/JSON，不共享数据库**（D12）：

| 场景 | 方向 | 端点 | 触发时机 |
|---|---|---|---|
| **用户/JWT 吊销** | 宿主 → Companion | `POST /admin/revoke`（平台级密钥鉴权） | 用户登出/封禁/改密 |
| **OSS STS 凭证** | Companion → 宿主 | `GET /api/sts/upload-token`（宿主自定义，平台级密钥鉴权） | 用户上传图片时，Companion 拿临时凭证上传 OSS |

**OSS STS 凭证机制**（D13）：
- 平台 OSS 的长期 AccessKey **只存宿主**，Companion 永远不持有。
- 用户上传图片时，Companion 调宿主的 STS 签发接口，拿到**短期临时凭证**（STS Token，有效期 15 分钟~1 小时）。
- Companion 用临时凭证上传到 OSS，凭证过期后自动重新获取。
- 宿主可随时停止签发新凭证，立即收回该用户的上传能力（比持有长期 AK 安全得多）。

**平台级管理密钥**：
- Companion 的 `/admin/*` 端点用单独的管理密钥鉴权（区别于用户 JWT）。
- 这个密钥通过环境变量配置（`ADMIN_API_KEY`），只有宿主知道。
- 宿主调 Companion 的管理端点时带 `Authorization: Bearer <ADMIN_API_KEY>`。

### 关键工作

#### 后端服务化

1. **Companion 监听地址改造**
   - 阶段二监听 `127.0.0.1`（loopback），阶段三改为可配置监听地址（`0.0.0.0:<port>` 或 unix socket）
   - 生产环境前置反向代理（nginx），负责 TLS 终止、限流、日志

2. **认证中间件升级（完整 SSO）**
   - 现有 accessKey（loopback 信任模型）替换为 JWT 验证中间件
   - 新增 `/auth/me` 端点，返回 JWT 解析出的 user 信息（供前端确认登录态）
   - 新增 `/admin/revoke` 吊销端点（平台级密钥鉴权），支持用户级和 JWT 级吊销（实现 SLO）
   - 实现内存级吊销黑名单（带 TTL 自动清理）
   - 保留 accessKey 作为本机管理模式（CLI/运维场景），与 JWT 并存

3. **多租户层接入**
   - 主 db 新增 `users` 表，定位为"本地数据归属索引"：`id`(来自 JWT) / `display_name`(来自 JWT claim) / `created_at`。**不存密码/邮箱/权限**，不与宿主用户表强一致
   - 用户首次带 JWT 来访问时懒创建 user 记录 + 建数据目录，不需要宿主预先通知
   - `dataset_registry` 加 `user_id` 外键
   - 业务 db 路径改为按用户隔离：`users/<user-id>/datasets/<dataset-id>.db`
   - 所有 storage 路由在打开业务 db 前，先从 JWT 拿 user_id 定位用户目录

4. **OSS 归属调整：平台统一 OSS + STS 凭证机制**
   - 阶段二的"选项 C：用户自配 OSS"改为"平台统一 OSS"
   - 平台配置一个 OSS bucket，所有用户的图片传到同一 bucket，按 `users/<user-id>/datasets/<dataset-id>/<blobKey>` 划分前缀
   - **长期 AccessKey 只存宿主**，Companion 调宿主的 STS 签发接口拿临时凭证（15 分钟~1 小时有效期），用完自动续期
   - 宿主可随时停止签发新凭证，立即收回用户上传能力
   - 选项 A/B（本地文件系统）在服务器模式下仍可用（存服务器磁盘），但通常服务器模式默认用 OSS

5. **CORS / 安全模型重设**
   - 阶段二的 CORS 白名单（loopback + 固定 origin）改为按部署配置（允许宿主域名）
   - loopbackGuard（凭据管理路由的本机信任）在服务器模式下收紧或关闭
   - 引入速率限制、请求体大小限制（防滥用）

#### Docker 化部署

6. **Companion Docker 化**
   - 编写 `Dockerfile`，构建出可发布的 Companion 镜像
   - 镜像发布到 DockerHub（如 `honlnk/gpt-image-studio-companion`）
   - 数据持久化走 volume 挂载（`/data` → 宿主机目录），包含 SQLite 文件和图片文件
   - 全部配置走环境变量，零配置文件：

     ```yaml
     # 用户侧 docker-compose.yml（部署文档会给出完整模板）
     services:
       companion:
         image: honlnk/gpt-image-studio-companion:latest
         ports: ["19750:19750"]
         volumes: ["companion-data:/data"]
         environment:
           - JWT_SECRET=xxx              # 与宿主共享的 JWT 验签密钥
           - JWT_PUBLIC_KEY=xxx          # 或非对称验签的公钥（二选一）
           - ADMIN_API_KEY=xxx           # 平台级管理密钥（宿主调 /admin/* 用）
           - MAIN_APP_URL=http://ruoyi:8080   # 宿主地址（用于 STS、用户查询）
           - MAIN_APP_API_KEY=xxx        # Companion 调宿主接口的凭证
           - DATA_DIR=/data              # Companion 自己的数据库/图片存储位置
         restart: unless-stopped
     ```

   - 用户拉镜像 → 填环境变量 → `docker compose up -d` → 跑起来。配置即用。
   - **不连宿主数据库**（D12），所有用户/OSS 信息走 JWT + API。

7. **Web 项目 Docker 化（可选分发）**
   - Web 项目已有 Docker 构建，同样发布到 DockerHub（如 `honlnk/gpt-image-studio-web`）
   - 提供两种前端分发模式（见下方"前端分发"）

#### 前端子项目化（qiankun）

8. **打包配置改造**
   - Vite 输出 UMD / ESM 双格式，暴露 `mount` / `unmount` 生命周期
   - 资源路径改相对路径，去掉绝对 `/` 前缀（关键：否则从 CDN 加载的 JS 里请求 `/assets/xxx.js` 会变成请求宿主的资源，404）
   - CSS 隔离（Shadow DOM 或 scoped 策略，避免污染宿主样式）
   - 路由适配：history vs hash 模式可配置（嵌入态用 hash，独立态用 history）

9. **运行环境感知**
   - 检测是否运行在 qiankun 容器内（`__POWERED_BY_QIANKUN__`）
   - 嵌入态下，从宿主注入配置（Companion 服务地址、JWT token、用户信息）
   - 嵌入态的 `connectionMode` 固定为 `localCompanion`（指向服务器 Companion），不允许 direct（凭据安全由平台负责）
   - 独立态下行为同阶段二

10. **依赖收敛**
    - Vue/Pinia 等运行时依赖可改 external（由宿主提供）或独立打包
    - 避免与宿主的 Vue 实例冲突（qiankun 的 JS 沙箱已处理大部分情况）

11. **认证态联动**
    - 嵌入态下，登录态由宿主管理，前端从宿主拿 JWT 注入 fetch 请求头
    - JWT 过期前静默刷新（前端调宿主 refresh 接口），不自己实现登录
    - JWT 刷新失败（如用户已在宿主登出）时，跳转宿主登录页

#### 前端分发模式（D14）

提供两种前端分发方式，用户按需选择：

12. **默认：CDN 嵌入（免部署）**
    - 宿主直接通过 qiankun 加载 `https://image.honlnk.com`（GitHub Pages）的构建产物
    - **用户不需要自己部署前端**，零运维，自动更新
    - 前置条件：`image.honlnk.com` 的 CORS 允许宿主域名、构建产物已做 qiankun 兼容改造、资源路径全部相对化
    - 风险：GitHub Pages 有流量/带宽限制，若实际使用中受限，降级到自部署模式

13. **可选：自部署（私有化）**
    - 用户从 DockerHub 拉 Web 项目镜像（`honlnk/gpt-image-studio-web`），部署到自己的 nginx
    - 适用于内网/私有化/对 CDN 不信任的场景
    - 前端代码开源，用户也可自行 build 部署

#### 交付物：部署文档

14. **同步产出部署教程**（`docs/deployment-guide.md` 或类似）
    - **Companion 部署**：Docker 拉取、环境变量配置（JWT 密钥、管理密钥、宿主地址等）、数据卷配置、nginx 反代示例、与宿主的对接步骤
    - **前端嵌入**：宿主如何注册 qiankun 子应用、配置入口 URL（CDN 或自部署）、处理路由冲突、传递 JWT 的方式
    - **宿主侧改造指引**：需要宿主开发的接口清单（STS 签发、登出 webhook 调用）、JWT claim 约定、共享密钥配置
    - **故障排查**：常见问题（CORS、资源 404、JWT 验签失败、数据隔离验证方法）

### 验收标准

- ✅ Companion 可通过 Docker 部署到服务器，配置即用（拉镜像 + 填环境变量 + 启动）
- ✅ 宿主签发的 JWT 能被 Companion 正确验证，user_id 正确隔离数据
- ✅ **完整 SSO 验证**：用户在宿主登出后，Companion 立即拒绝该用户的 JWT（SLO 生效）
- ✅ 用户改密码/被封禁后，旧 JWT 立即失效（吊销机制生效）
- ✅ JWT 过期前静默刷新成功，用户无感知
- ✅ 不同用户的数据完全隔离（A 用户看不到 B 用户的任何数据）
- ✅ OSS 上传走 STS 临时凭证，长期 AK 不出现在 Companion 配置中
- ✅ 前端可通过 CDN（image.honlnk.com）或自部署两种方式嵌入宿主
- ✅ 前端嵌入态从宿主获取配置和 JWT，不需要用户单独登录 Companion
- ✅ 前端独立运行模式（非 qiankun）行为不受影响（兼容性回归）
- ✅ 业务 db schema 与阶段二完全一致（多租户零 schema 改动验证）
- ✅ 部署文档完整，按文档操作可从零部署成功

### 本阶段不做

- ❌ 不把 Companion 物理嵌入宿主项目（不做 package 拆分/SpringBoot 包装/Node 子进程混部）
- ❌ 不连宿主数据库（D12）
- ❌ 不在 Companion 实现注册/登录/找回密码（由宿主 IdP 负责）
- ❌ 不支持每用户自配 OSS（平台统一 + STS，简化运维和提升安全）
- ❌ 不做用户间的数据共享/协作（纯隔离，协作是更后续的事）
- ❌ 不重写 provider 适配器（Node/TS 实现复用）

### 为后续铺路

- 前端打包格式已支持独立/嵌入两种形态 → 阶段四的 Tauri 可复用嵌入形态的运行环境感知能力
- Companion 已具备完整服务化能力（监听、认证、多租户）→ 阶段四 APP 内化时可按需裁剪（APP 是单用户，去掉多租户层即可）
- 多租户的"用户隔离下沉到文件目录"设计 → 阶段四 APP 单用户场景直接退化为单层目录

---

## 八、阶段四：APP 化（可独立安装）

> **当前状态（2026-07）**：阶段四距离落地尚远，**暂时不进入实施**。本节保留下方已构思的完整设计作为长期愿景和决策锚点，等阶段一、二、三推进到合适程度后再启动。阶段一已预留 `NativeStorage` 接口骨架，确保未来 APP 模式有接入位置。

### 目标

把项目打包成正经的、可安装到本地的 APP。**APP 与云服务完全无关**，所有数据在本地，体验完整。

### 核心定位（重要）

> APP 模式下，**不再是"浏览器壳 + 外部 Companion"**，而是"**内置 Companion 全部能力** + 本地数据库"。
>
> 因为摆脱了浏览器限制，APP 可以：
> - 直接操作本地文件系统（用户可见的图片目录）
> - 用更合适的数据库（SQLite）替代 IndexedDB
> - 安全地本地存储多 provider 凭据（不再有浏览器泄漏风险）
> - 完全离线工作，与任何云服务无关

**Companion 的最终命运**：阶段二是"独立服务"，阶段三是"嵌入宿主"，阶段四是"被 APP 内化"。Companion 的核心逻辑（provider 适配、存储、协议翻译）最终以某种形式（Rust 重写 / Node sidecar / 前端直连）**合并进 APP**。

### 前置条件

- ✅ 阶段一完成（`NativeStorage` 接口契约已定义）
- ✅ 阶段二完成（存储接口已经过真实业务验证）
- ⚠️ 阶段三不一定是前置（APP 可以不依赖子项目化能力）

### 关键工作

1. **运行时环境检测与注入**
   - 前端 `isTauriRuntime()` 检测（`window.__TAURI_INTERNALS__`）
   - 在 `src/main.ts` 前置注入 runtime 标识
   - 根据 runtime 选择 storage 实现与 imageClient 行为

2. **Tauri 壳能力扩展**
   - `desktop/src-tauri/` 加 `tauri-plugin-sql`（SQLite）+ `tauri-plugin-fs`
   - `lib.rs` 注册 `invoke_handler`，暴露存储命令
   - `capabilities/default.json` 放开 fs/sql 权限（仅限 APP 数据目录）

3. **`NativeStorage` 实现**
   - 把骨架替换为 `invoke("storage_put", { store, value })` 等调用
   - SQLite 建表，表名 = `STORE_NAMES`，字段对齐 `studio.ts` 类型（**直接复用阶段二已定义的 schema**）
   - 图片存储：APP 模式下默认走阶段二的 `FileSystemImageStore`（选项 A/B 形态），存 APP 数据目录下的图片文件夹。OSS 选项（C）在 APP 模式下通常不启用（APP 与云无关），但接口仍保留以备特殊场景。

4. **APP 内置 Companion 能力**
   - **方案 A（Rust 重写）**：把 Companion 的 provider 适配逻辑用 Rust 重写，APP 直接调原生 HTTP 客户端。最重，但启动最快、最纯净。
   - **方案 B（Node sidecar）**：把 Companion 作为 Tauri sidecar 内嵌，APP 启动时拉起。复用现有 Node/TS 代码，但需解决 Node 二进制打包 + notarization。
   - **方案 C（前端直连）**：APP 模式下放弃 Companion，前端直接调 provider（凭据存 SQLite，安全）。最轻，但丢失多 provider 管理能力。
   - **方案选择延后**：阶段四启动时再定，不影响阶段一/二/三推进。

5. **多 provider 凭据管理**
   - APP 模式下凭据存 SQLite（加密存储，可考虑 OS keychain）
   - 前端 provider 管理 UI 在 APP 模式下启用（direct 模式下仍单 provider）

6. **APP 模式下 imageClient 行为**
   - 强制走"内置 provider 调用"路径（不再有 direct/companion 二选一）
   - 多 provider 切换、凭据管理完全在 APP 内部完成

### 验收标准

- ✅ APP 安装后可离线启动，所有数据在本地
- ✅ APP 内可配置多个 provider 并切换
- ✅ APP 关闭重启后数据完整
- ✅ APP 数据与 Web 端数据完全隔离（两套独立数据源原则）
- ✅ APP 卸载后本地数据可清理（或保留，由用户决定）

### 本阶段不做

- ❌ 不做云同步（APP 与云完全无关）
- ❌ 不做账号系统（APP 是纯本地）
- ❌ 不做自动更新（这是更后续的工程，见 `roadmap.md` 中的 desktop 后置项）
- ❌ 不强制 macOS/Windows/Linux 全平台（先做主力平台）

### 决策延后项

- Companion 内化方案（A/B/C）→ 阶段四启动时定
- 是否引入 OS keychain 加密凭据 → 阶段四启动时定
- 是否支持 APP ↔ Web 数据互导（手动备份恢复）→ 阶段四启动时定
- APP 管理页的形态（取决于内化方案，见 D13）→ 阶段四启动时定

---

## 九、贯穿全程的核心抽象

这四个抽象是阶段一之后所有演进的基础，必须从一开始就设计好：

### 1. `StudioStorage` 接口

存储后端的统一抽象。承载 KV（IndexedDB）和关系型（SQLite/后端 DB）两种形态。

```
list / get / put / delete / clear       ← 通用 CRUD
saveImageBlob / loadImageBlob / deleteImageBlob  ← 图片二进制
readConfig / writeConfig                ← 轻量配置
estimateUsage                           ← 容量估算
backend: "indexeddb" | "companion" | "native"    ← 后端标识
```

**三个实现**：IndexedDbStorage（阶段一）/ CompanionStorage（阶段二）/ NativeStorage（阶段四）

### 2. `ImageClient` 接口（已存在）

模型调用的统一抽象。已有 direct + localCompanion 两个实现，运行时按 connectionMode 分叉。

**阶段四演进**：新增 APP 模式分支（强制走内置 provider，不连外部 Companion）。

### 3. 运行时检测

```
isTauriRuntime()    → 是否在 Tauri webview 内
isQiankunRuntime()  → 是否在 qiankun 子应用容器内
connectionMode      → direct / localCompanion
```

三者组合决定 storage 与 imageClient 的装配。

### 4. Provider 适配层（Companion 侧）

已存在 9 个 provider adapter。**关键约束**：所有 provider 特定逻辑（DashScope 解析、豆包任务轮询等）必须留在 Companion，前端只感知 capability。

**阶段四风险**：如果选方案 A（Rust 重写），这层要重新实现，工作量大。

---

## 十、关键决策记录

这些决策已经确认，后续演进以此为准。如需变更，先更新本节。

### D1: 数据集隔离（阶段二，贯穿全程）

**任何**存储位置/模式的切换都不迁移数据、不删除原数据，切换时整套数据（会话+消息+图片元数据+图片文件）reload。

涵盖两种切换场景：
- **direct ↔ Companion 切换**：IndexedDB 数据集与 Companion 数据集互相独立。
- **Companion 内 A/B/C 存储位置切换**（见 D6）：每个存储位置维护自己独立的数据集。

**理由**：避免数据同步地狱。不做迁移 = 不会丢数据，用户可随时切回原位置找回内容。

### D2: APP 与云完全无关（阶段四）

APP 是纯本地程序，不连任何云服务。所有数据在本地，体验完整。

**理由**：APP 的核心价值是"摆脱浏览器限制 + 离线可用"。引入云会破坏这个定位。

### D3: Companion 保持 Node/TS 技术栈（阶段二、三）

阶段二、三不重写 Companion，沿用 Fastify + TypeScript，复用现有 9 个 provider adapter。

**理由**：复用已有代码，降低风险。Rust 重写（如需要）延后到阶段四的方案 A 评估。

### D4: APP 内置 Companion 全部能力（阶段四）

APP 不是"浏览器壳 + 外部 Companion"，而是"内置 Companion 能力 + 本地数据库"。具体内化方案延后决定。

**理由**：摆脱浏览器限制后，没有理由再保留外部 Companion 的运行模型。

**理由**：摆脱浏览器限制后，没有理由再保留外部 Companion 的运行模型。

### D5: 前端业务代码对后端无感知（贯穿全程）

store / service / 组件代码不允许直接调 IndexedDB / fetch / invoke。必须通过 `StudioStorage` 或 `ImageClient` 接口。

**理由**：保证阶段二、三、四在前端业务层"换实现不改代码"。

### D6: 图片存储位置三选一（阶段二）

Companion 模式下，图片存储位置由用户在设置中选择，三种选项：
- **A. 指定目录**：用户自选本地文件夹，存真实图片文件（可直接打开）。
- **B. 默认二进制**：Companion 默认目录（`~/.gpt-image-studio/images/`），存不透明 Blob（文件名是无意义 key）。
- **C. 阿里云 OSS**：上传到 OSS，本地只存引用。**仅兼容阿里云 OSS**，其他图床暂不考虑。

A 和 B 共用 `FileSystemImageStore` adapter（仅目录配置和文件命名策略不同），C 用独立的 `OssImageStore` adapter。切换存储位置遵循 D1 数据集隔离原则。

**理由**：兼顾"想直接看图片文件"和"不想操心目录"两类用户，并预留上云路径（OSS）但不无限扩展图床支持。

### D7: 数据集管理——主 db + 业务 db 双层结构（阶段二）

Companion 模式下，多数据集（对应不同存储位置）的元数据管理采用双层结构：
- **主 db `~/.gpt-image-studio/studio.db`**：只有一张 `dataset_registry` 表，记录所有数据集的注册信息（id / 存储配置 / 业务 db 路径 / 激活时间）。
- **业务 db `~/.gpt-image-studio/datasets/<id>.db`**：每个数据集一个独立文件，内部 schema = 现有 7 张表，**不加 `dataset_id` 字段**。

数据集识别按配置去重（同一目录/同一 OSS 配置复用同一数据集，不重复创建）。OSS 数据集的业务 db 仍在本地，只有图片在云端。

**理由**：
- **schema 零侵入**：业务表不加 `dataset_id`，阶段一的 `StudioStorage` 接口（`list/get/put/...`）完全不变，只是底层连哪个业务 db 由激活的数据集决定。这保护了 D5（前端业务代码对后端无感知）。
- **中央注册表**：数据集管理（查看/删除/重命名）只需查主 db，不用扫文件系统。
- **物理隔离 + 删除干净**：删一个数据集 = 删一个业务 db 文件 + 删 registry 记录，不会影响其他数据集。
- **OSS 解耦清晰**：元数据本地、图片云端的边界明确，AccessKey 变更不影响数据集身份（指纹不含 AK）。
- **多租户可演进**：阶段三的多租户隔离可复用本结构，业务 db schema 完全不动（见 D9）。

### D8: 后端服务化而非物理嵌入（阶段三）

阶段三的后端**不**做"物理嵌入到某个宿主项目"的重构（不拆 package、不包装成 SpringBoot controller、不混部 Node 子进程）。Companion 作为**独立服务**部署，通过标准 HTTP/JSON API 与宿主（如 RuoYi-Plus）对接。

**理由**：服务边界应反映产品边界。Companion 是独立产品，就应是独立服务。物理嵌入是反模式——技术栈绑死、部署耦合、升级困难、收益却很小。这是康威定律的应用。前端值得做 qiankun 嵌入（运行时 UI 组合、松耦合），后端不值得（代码级物理耦合、紧耦合）。

### D9: 多租户隔离——复用 D7 的文件目录隔离（阶段三）

服务器多用户场景下，用户数据隔离**复用 D7 的双层结构**，业务 db schema 完全不动：
- 主 db 新增 `users` 表，`dataset_registry` 加 `user_id` 外键。
- 业务 db 物理路径改为按用户隔离：`<server-data-dir>/users/<user-id>/datasets/<dataset-id>.db`。
- 业务 db 内部的 7 张表**不加 `user_id` 字段**——用户隔离下沉到文件目录 + 主 db 注册表层面。

**否决方案**：共享库 + `user_id` 字段过滤（会破坏 D7 的 schema 零侵入原则，让所有业务表查询带过滤条件，反向污染 StudioStorage 接口）。

**理由**：这是 D7 设计的延伸红利。阶段二为"存储位置切换"设计的双层结构，阶段三只需在主 db 加一个 `user_id` 维度，就顺手解决了多租户隔离。业务代码（store/service）零改动。

### D10: 完整 SSO——单点登录 + 单点登出 + 令牌刷新（阶段三）

阶段三实现**生产级 SSO**，三个能力全部覆盖，不是基础形态：

1. **单点登录（SSO）**：宿主（IdP）签发 JWT，前端带 JWT 访问 Companion（RS），Companion 验签放行。Companion 不管理账号。
2. **单点登出（SLO）**：宿主用户登出/封禁/改密时，调 Companion 的 `/admin/revoke` 端点（平台级密钥鉴权），Companion 把该 user_id/jti 加入内存级吊销黑名单，后续请求立即拒绝。**这是必须的后端间通信**——JWT 无状态，Companion 否则无法知道宿主那边已登出。
3. **令牌刷新**：JWT 设短有效期（30 分钟~1 小时），过期前前端静默调宿主 refresh 接口拿新 JWT，Companion 不参与刷新。

**理由**：基础 SSO（只做单点登录）有三个安全缺口——JWT 过期后的刷新、用户登出后的 SLO、改密/封禁后的吊销。这三个缺口在企业场景下都是必须补的，否则用户在宿主登出后仍能访问 Companion（安全洞）。完整 SSO 用一个 webhook 端点（`/admin/revoke`）同时解决 SLO 和吊销，代价可控。

### D11: 服务器模式 OSS 平台统一 + STS 凭证机制（阶段三）

阶段三服务器多用户模式下，OSS（存储选项 C）改为**平台统一配置 + STS 临时凭证**：
- 平台配置一个 OSS bucket，所有用户的图片传到同一 bucket，按 `users/<user-id>/datasets/<dataset-id>/<blobKey>` 划分前缀隔离。
- **长期 AccessKey 只存宿主**，Companion 永远不持有。Companion 调宿主的 STS 签发接口拿临时凭证（15 分钟~1 小时有效期），用完自动续期。
- 宿主可随时停止签发新凭证，立即收回用户上传能力（比 Companion 持有长期 AK 安全得多）。
- 阶段二的"用户自配 OSS"在服务器模式下不再启用。

**理由**：服务器模式下用户不应承担存储配置负担，平台统一管理更合理。STS 机制让 Companion 即使被入侵也不会泄露 OSS 主密钥，符合最小权限原则。需要宿主开发一个 STS 签发接口作为代价。

### D12: Companion 不连宿主数据库（阶段三）

Companion **不直连宿主（如 RuoYi-Plus）的数据库**。所有跨服务的信息交换走 JWT + HTTP API：
- 用户身份：通过 JWT 的 `sub` claim 传递，Companion 懒创建本地 user 记录。
- 用户显示名：通过 JWT 的 `display_name` claim 传递（或首次访问时调宿主 API 查询并缓存）。
- OSS 凭证：通过 STS API 临时获取。
- 用户删除等事件：通过 webhook 通知。

**理由**：
- **部署解耦**：Companion 不需要配宿主 DB 连接信息，Docker 部署配置更简单（只需 API 地址和密钥）。
- **故障隔离**：Companion 挂了不影响宿主 DB，反之亦然。
- **安全**：Companion 没有宿主 DB 的访问权，攻击面更小。
- 代价：宿主要有 user 删除等事件的 webhook 通知能力（标准做法）。

### D13: Companion 自带管理页，废弃 Web 项目的凭据管理（阶段零，前置）

Companion 自带独立的 web 管理页（原生 HTML + vanilla JS + 内联 CSS，零框架依赖），用户访问 `127.0.0.1:19750/admin` 管理 provider 凭据。Web 项目的 `/companion` 路由页面废弃，不再触碰 provider 凭据。

- 本机 loopback 模式（阶段二）：管理页启用，受 loopbackGuard 保护。
- 服务器多用户模式（阶段三）：管理页默认关闭，管理功能由宿主后台通过 Companion 的 `/admin/*` API（平台级密钥鉴权）调用。
- APP 模式（阶段四，暂不实施）：管理页形态取决于 Companion 内化方案，启动时再定。

**理由**：当前 Web 项目的 `/companion` 页面通过 `GET /credentials` 明文读取 Companion 的 provider apiKey，违反了"普通项目备份不导出 Companion 凭据"的产品边界。这是历史调试权宜之计，必须在架构演进开始前正本清源。原生三件套够用，不引入框架以保持零维护成本。

### D14: 前端双模式分发——CDN 嵌入 + 自部署（阶段三）

前端提供两种分发方式：
- **默认：CDN 嵌入**。宿主直接通过 qiankun 加载 `https://image.honlnk.com`（GitHub Pages）的构建产物，用户免部署前端，自动更新。前置条件：CORS 允许宿主域名、构建产物 qiankun 兼容、资源路径相对化。
- **可选：自部署**。用户从 DockerHub 拉 Web 项目镜像部署到自己的 nginx，适用于内网/私有化场景。

**理由**：CDN 嵌入对中小用户最友好（零运维），自部署覆盖私有化需求。两种模式共用同一份构建产物（qiankun 兼容改造后同时支持独立运行和嵌入）。CDN 模式若遇 GitHub Pages 限制，可平滑降级到自部署。

---

## 十一、阶段依赖图

```
   ┌──────────────────┐
   │ 阶段零：Companion │
   │ 管理页边界正本清源│  ← 历史欠账补全，与存储演进正交，最先做
   │ （前置重构）      │
   └────────┬─────────┘
            │
            ▼
   ┌─────────────────┐
   │  阶段一：存储    │
   │  抽象层（地基）  │
   └────────┬────────┘
            │
     ┌──────┼──────────────┐
     ▼      ▼              ▼
  ┌───────────────┐ ┌─────────┐ ┌─────────────┐
  │ 阶段二：       │ │         │ │ 阶段四：     │
  │ Companion 后端 │ │  可并行 │ │ APP 化       │
  │ 化（真实数据） │ │         │ │（暂不实施）  │
  └───────┬───────┘ └─────────┘ └──────┬──────┘
          │                              │
          │  Companion 已是完整后端       │
          ▼                              │
  ┌───────────────┐                      │
  │ 阶段三：       │                      │
  │ 服务化 + 可嵌入│                      │
  │ （多用户 SaaS）│                      │
  └───────────────┘                      │
                                         │
          （阶段三非阶段四前置） ◄─────────┘
```

**依赖关系**：
- **阶段零** → 所有阶段的**最前置**（先把 Companion/Web 边界理清，再开始架构演进）
- **阶段一** → 阶段二、三、四的**硬前置**
- **阶段二** → 阶段三的**硬前置**（Companion 必须先成为完整后端才能服务化）
- **阶段四** → 只依赖阶段一（不依赖阶段二、三），但阶段二的存储接口验证会让阶段四更稳

**可并行**：阶段二完成核心后，阶段三（服务化 + 前端嵌入）和阶段四（APP）可以并行推进。阶段四当前暂不实施，但设计内容已保存在第八章作为长期愿景；阶段一会预留 `NativeStorage` 接口骨架确保未来可接入。

**阶段零的特殊性**：阶段零与存储演进主线正交，理论上可以和阶段一并行，但建议**先做阶段零**——在一个边界干净的状态下开始架构演进，避免后续阶段带着违规代码往前走。

---

## 十二、风险与未决问题

### 跨阶段风险

| 风险 | 影响 | 缓解策略 |
|---|---|---|
| `StudioStorage` 接口设计承载不了所有后端形态 | 阶段二/四被迫改业务代码 | 阶段一启动前做接口设计 review，对照 SQLite / 后端 DB / OSS 三种后端验证可行性 |
| Companion 从"代理"变"后端"后，安全模型跟不上 | 阶段二出现数据泄漏/并发问题 | 阶段二启动前先做安全模型设计（多项目隔离、并发、配额） |
| 阶段四 Companion 内化方案选错 | 阶段四工作量爆炸 | 把方案 A/B/C 评估作为阶段四启动后的第一件事，不预设（阶段四当前暂不实施） |
| 前端代码在演进中意外产生对特定后端的耦合 | 抽象层失效 | 阶段一完成后建立 lint 规则：禁止 store/service 直接 import IndexedDB/fetch/invoke |

### 未决问题（待对应阶段启动时决策）

- [ ] 阶段零：Companion 管理页的具体功能清单（对齐当前 `/companion` 页面的哪些功能，日志查看是否保留等）
- [ ] 阶段零：Web 项目清理 `/companion` 页面后，Companion 连接状态在 Web 项目里如何展示（保留精简的状态徽标？）
- [ ] 阶段二：业务 db 的 SQLite schema 细节（字段类型、索引、迁移版本管理；双层结构 D7 已定，但 7 张表的具体 DDL 未定）
- [ ] 阶段二：`dataset_registry` 的 schema 细节（字段、配置指纹的归一化规则）
- [ ] 阶段二：选项 A（指定目录）的目录合法性校验和权限边界（如禁止选系统目录、跨盘符等）
- [ ] 阶段二：OSS 凭据的录入/存储/校验流程细节（本机模式下 AccessKey 存 `credentials.json`，但前端录入 UX 和连通性测试未定）
- [ ] 阶段二：数据集管理 UI 的形态（是否在设置里提供"数据集列表/删除/重命名"入口）
- [ ] 阶段三：JWT 验签的具体加密方案（共享密钥对称 HS256 vs RSA 公私钥非对称 RS256；claim 字段约定）
- [ ] 阶段三：JWT 有效期与刷新策略的具体参数（有效期多长、refresh token 是否需要、静默刷新的触发时机）
- [ ] 阶段三：吊销黑名单的持久化策略（纯内存重启清空 vs 落盘，权衡安全性与性能）
- [ ] 阶段三：宿主需要开发的接口清单细化（STS 签发接口的具体契约、登出 webhook 的集成方式）
- [ ] 阶段三：数据集在多用户场景下的语义（仍按存储位置切换，还是每用户固定一个数据集）
- [ ] 阶段三：CDN 嵌入模式下 GitHub Pages 的流量/带宽限制是否实际构成问题，是否需要备选 CDN
- [ ] 阶段四（暂不实施，启动时再决策）：Companion 内化方案（Rust 重写 vs Node sidecar vs 前端直连）
- [ ] 阶段四（暂不实施，启动时再决策）：是否引入 OS keychain 加密凭据
- [ ] 阶段四（暂不实施，启动时再决策）：APP 数据与 Web 数据是否允许手动互导
- [ ] 阶段四（暂不实施，启动时再决策）：APP 管理页形态（取决于内化方案）

---

## 十三、与现有 roadmap 的关系

| 文档 | 关注点 | 阶段标记 |
|---|---|---|
| [`roadmap.md`](./roadmap.md) | **业务功能**演进（聊天 UI、图片编辑、备份、分析、提示词模式等） | 第一到第五阶段（已完成）+ 候选方向 |
| 本文档 | **架构形态**演进（存储、集成、打包、交付） | 阶段一到阶段四（待启动） |

两份文档正交：
- 业务功能可以在任何架构形态下迭代（如"提示词模式"在阶段一的 IndexedDB 和阶段二的 Companion 后端下都能工作）
- 架构演进尽量保持业务功能行为不变（阶段一/二的验收都包含"功能回归"）

**当业务功能与架构演进冲突时**：架构演进的"接口对齐"优先，业务功能的"实现方式"可调整，但"用户可见行为"不应变化。

---

## 附录：术语表

| 术语 | 含义 |
|---|---|
| **direct 模式** | 前端直连 OpenAI 兼容接口，凭据存浏览器，单 provider |
| **Companion 模式** | 前端连 Companion 服务，凭据存 Companion，多 provider。涵盖两种部署形态：阶段二的本机 loopback、阶段三的服务器远程 |
| **APP 模式** | Tauri 打包的桌面应用，内置全部能力，纯本地 |
| **StudioStorage** | 存储后端的统一抽象接口 |
| **ImageClient** | 模型调用的统一抽象接口（已存在） |
| **数据集隔离** | 任何存储位置/模式切换都不迁移、不删除原数据，切换时 reload（D1，涵盖 direct↔Companion、A/B/C 存储位置切换、以及多用户间的用户隔离） |
| **存储位置（storage location）** | Companion 模式下图片存储的三选一选项：A 指定目录 / B 默认二进制 / C 阿里云 OSS（D6） |
| **数据集（dataset）** | 一个存储位置对应的一整套独立数据（会话+消息+图片元数据+图片文件）。切换存储位置 = 切换数据集，遵循 D1 数据集隔离 |
| **主 db（studio.db）** | 只存数据集注册表（及阶段三的用户表），极小。本机模式在 `~/.gpt-image-studio/studio.db`，服务器模式在 `<server-data-dir>/studio.db`（D7） |
| **业务 db** | 每个数据集一个独立 SQLite 文件，内部 schema = 现有 7 张表，无 dataset_id/user_id 字段。本机模式在 `datasets/<id>.db`，服务器模式按用户隔离在 `users/<uid>/datasets/<id>.db`（D7/D9） |
| **配置指纹** | 用于数据集去重的归一化配置字符串。filesystem 模式 = 目录绝对路径，oss 模式 = endpoint+bucket+prefix（不含 AccessKey） |
| **FileSystemImageStore** | 图片存储 adapter，覆盖选项 A（指定目录，真实图片文件）和 B（默认目录，不透明 Blob） |
| **OssImageStore** | 图片存储 adapter，覆盖选项 C（阿里云 OSS） |
| **服务化（vs 嵌入化）** | Companion 作为独立服务部署，而非物理嵌入宿主项目代码（D8） |
| **多租户隔离** | 服务器多用户场景下，用户数据隔离复用 D7 的文件目录结构，业务 db schema 不动（D9） |
| **IdP / RS** | 身份提供者（宿主，签发 JWT）/ 资源服务器（Companion，验证 JWT）。SSO 的角色划分（D10） |
| **SSO** | 单点登录。阶段三实现完整形态：单点登录 + 单点登出（SLO）+ 令牌刷新（D10） |
| **SLO** | 单点登出（Single Logout）。宿主用户登出后，通过 webhook 通知 Companion 吊销该用户 JWT，避免残留会话（D10） |
| **STS 临时凭证** | Companion 调宿主接口拿到的短期 OSS 上传凭证（15 分钟~1 小时），替代长期 AccessKey，提升安全（D11） |
| **管理面 / 数据面** | 管理面 = provider 凭据/OSS 配置等管理操作；数据面 = 业务数据的读写。两者分离，Web 项目只走数据面（D13） |
| **吊销黑名单** | Companion 内存级维护的"已登出/已封禁 JWT"列表，带 TTL 自动清理，实现 SLO（D10） |
| **平台级管理密钥** | 区别于用户 JWT，是 Companion `/admin/*` 端点的鉴权凭证，只有宿主持有，通过环境变量配置 |
| **CDN 嵌入 / 自部署** | 前端两种分发模式。CDN 嵌入 = 直接用 image.honlnk.com；自部署 = 用户拉 Docker 镜像部署（D14） |
| **Companion 内化** | 阶段四把 Companion 能力合并进 APP 的过程 |
| **系统 keychain** | 操作系统级凭据加密存储（macOS Keychain / Windows Credential Manager / Linux Secret Service）。区别于当前的明文 + 0600 文件存储，仍未实现 |
