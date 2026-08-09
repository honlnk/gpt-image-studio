# 重构审查报告 — 2026-07-27

> 范围：`honlnk/dev` 分支当前未提交的工作区改动（27 个修改/删除文件 + 17 个新增文件/目录，净 −1609 行）。
> 方法：分 5 个子智能体并行审查 `imagesApi` 拆分、新增 shared/services 工具模块、Companion provider 层、UI 组件重构、Store/ViewModel 重构，每个领域分别对照 `git diff`、新增文件、测试与调用点。
> 验证基线（首轮）：`pnpm typecheck` 0 错误；`pnpm test` 656/656 通过（51 个测试文件）。

---

## 复审记录（2026-07-27 第二轮）

用户按本文档修复后复审。验证基线：

- `pnpm typecheck` — 0 错误
- `pnpm typecheck:companion` — 0 错误
- `pnpm test` — **659/659 通过**（较首轮 +3，对应新增的 B8 测试用例）
- 无新增回归。

### 已修复（✅ 复审通过）

| # | 项目 | 复审证据 |
|---|------|----------|
| **A1** | `imagesApi/index.ts` 注释失真 | barrel 头部注释已重写，明确区分 `services/` 同级文件（sizeConstraints / promptRewriteGuard）与 `imagesApi/` 子目录文件，并标注同级文件的存在原因（避免反向耦合）。 |
| **A3** | `client.ts` 死 re-export | `client.ts` 由 304 行降至 285 行，现仅 `export` `generateImage`/`editImage` 两个函数；guard/size helper 仅按需 import 并在内部使用（72/79/105/126/257/260 行），无多余 re-export。 |
| **A4** | `normalizeStreamPartialImages` 重复 | 现仅在 `imagesApi/http.ts:89` 定义一次；`client.ts` 改为从 `./http.js` import，无重复定义。 |
| **B1** | `toPlainImageAsset` 重复 | `src/stores/imagesStore.ts` 本地副本已删除（−32 行），改为 `import { toPlainImageAsset } from "../services/messageSerialization"`（:11），4 个调用点（:151/167/238/306）改用 import 版本。grep 确认 `function toPlainImageAsset` 全仓仅 1 处定义。 |
| **B2** | `messageImageFormat` 重复 `imageExtension` | `messageImageFormat.ts` 的 `imageExtension(image?: ImageAsset)` 现委托 `shared/fileFormatters.imageExtension(image?.mimeType)`，并附文档注释说明签名差异（本地版接受可空 `ImageAsset`，shared 版接受 `mimeType?: string`）与保留本地包装的原因——MIME→扩展映射单一真相源。 |
| **B5** | `clipboard.ts` 抽取未全覆盖 | `ApiSettingsPanel.vue:77` 与 `PromptGuardSettingsPanel.vue:53` 均改为 `await copyTextToClipboard(...)`，不再直连 `navigator.clipboard.writeText`；两个组件均新增 `import { copyText as copyTextToClipboard }`。 |
| **B7** | `WEB_DEV_PORT` 死导出 | `src/shared/constants.ts` 的 `WEB_DEV_PORT` 已删除；grep `src/` 与 `companion/src/` 均无残留引用。 |
| **B8a** | `messageSerialization` edit 字段测试缺口 | 新增测试 `preserves edit fields (editSourceImageId / editMaskImageId) and runtime fields`（test:80），断言 `plain.editSourceImageId === "src-1"`、`plain.editMaskImageId === "mask-1"`（:97-98）。 |
| **B8b** | `imageEditRequest` mask 成功+source 缺失路径 | `throws when mask specified without source image`（test:136）现用真实 PNG blob 解析 mask（`resolveBlob: async () => new Blob(["x"], { type: "image/png" })`，:145），覆盖"mask 解析成功后再抛 source 缺失"路径。 |
| **B8c** | `blobConverters` 空 Blob 测试缺口 | 新增 `handles empty Blob (size === 0)`（test:53），覆盖 `btoa("")` 与无类型回退分支。 |
| **C1** | `gemini.ts` 未迁移到 `assertEditImageCount` | `gemini.ts` 新增 `import { assertEditImageCount }`，edit 入口的手写 `if (request.images.length === 0) throw ...` 替换为 `assertEditImageCount("Gemini", request.images.length)`（:92）。错误措辞随之统一为"图像编辑"。 |

### 未处理（确认仍为 low / 预存遗留，不阻塞）

| # | 项目 | 现状 | 说明 |
|---|------|------|------|
| **A2** | `.js` 扩展名 import 风格不一致 | 仍在（imagesApi/ 内 12 处） | 纯风格问题，`moduleResolution: "Bundler"` 下无功能影响。可后续统一。 |
| **B3** | `StorageUsagePanel` 本地 `formatBytes` | 仍在（:30） | 预存；0 字节返回 "0 KB" 与共享版 "未知大小" 差异有意。 |
| **B4** | `urlSettings` 与 `settingsSerialization` 同名异义 | 仍在 | 预存；语义不同（校验器 vs 转换器；额外剥 `/v1`）。 |
| **B6** | `blobToDataUrl` O(n²) 拼接 | 仍在（blobConverters.ts:33-37） | 性能项，功能正确；可后续改分块 `btoa` 或 `FileReader`。 |
| **B9** | shared/services 边界语义 | 未改 AGENTS.md | informational。 |
| **C2** | 工厂路径 edit 守卫未迁移 | 仍在 openaiCompatible.ts | 路由层 images.ts:130-135 统一兜底，无正确性问题。 |
| **C3** | adapter edit 守卫接线无集成测试 | 未补 | `companion/src/providers/adapters/` 下无 *.test.ts。helper 已单测，接线未覆盖；low。 |
| **D1** | BaseModal 无 ESC/焦点管理 | 仍在 | 预存 a11y 缺口，非本次回归。 |
| **D2** | ConfirmDialog `dialog!` 耦合 BaseModal | 仍在 | low，当前正确。 |
| **D3** | `formatFileSize` 新增 GB 档 | 仍在 | 行为严格超集，可接受。 |

### 结论

用户针对"建议优先处理"清单的前 5 项全部完成（A1/A3/A4/B1/B2/B5/B7/B8×3/C1），且修复质量良好：复用单一真相源、删除重复定义、补齐关键测试分支、附文档注释解释保留包装的原因。**复审未发现任何由修复引入的新问题。** 剩余项均为预存遗留或 low 风格/性能/边界项，不阻塞本次提交。

---



## 总体结论

**重构是健康的、行为保持的（behavior-preserving），未发现任何关键或中等回归。** 公共 API 表面完整保留，所有调用方解析正常，类型检查与全套测试通过。下面列出的问题全部为**低严重度的代码质量 / 一致性 / 完整性问题**，不影响功能正确性，可作为后续清理项跟进。

---

## 问题清单

按严重度（均低）→ 领域 排序。每项给出位置、问题、影响。

### A. imagesApi 拆分（`src/services/imagesApi/`）

#### A1. `index.ts` 头部注释与实际目录结构不符 ｜ low
- **位置**：`src/services/imagesApi/index.ts:5-11`
- **问题**：barrel 注释把 `sizeConstraints.ts` / `promptRewriteGuard.ts` 描述为 `imagesApi/` 目录内文件（"内部已按职责拆为 …… imagesApi/types.ts"），但它们实际是 `src/services/` 下的同级文件（`src/services/sizeConstraints.ts`、`src/services/promptRewriteGuard.ts`）。
- **影响**：读者按注释会在错误位置查找；纯文档，无运行时/类型影响。

#### A2. 新模块内部使用 `.js` 扩展名 import，与项目其余部分风格不一致 ｜ low
- **位置**：`index.ts:23-25`、`http.ts:2`、`client.ts:20,24,28,32`、`responses.ts:13,17,22`、`streaming.ts:1-8`
- **问题**：`src/services/` 其余文件一律使用无扩展名相对 import（如 `settings.ts:8` `from "./promptRewriteGuard"`），而新拆分模块统一带 `.js` 后缀。
- **影响**：因 `tsconfig.json` 使用 `moduleResolution: "Bundler"`，类型检查通过且无功能影响；属风格不一致。仅当未来切换到更严格的 resolver 才会变为真实问题。

#### A3. `client.ts` 存在无人消费的死 re-export ｜ low
- **位置**：`src/services/imagesApi/client.ts:34-39`、`304-305`
- **问题**：`client.ts` re-export 了 `PROMPT_REWRITE_GUARD_PREFIX`、`applyPromptRewriteGuard`、`normalizePromptRewriteGuardText`、`apiSize`、`getCustomSizeError`、`validateBackground`、`DEFAULT_SIZE_CONSTRAINTS` 及若干 input 类型，但唯一的消费者 `index.ts` 仅从 `client.ts` import `editImage`/`generateImage`，guard 函数与 size 工具都直接从各自原模块 re-export。
- **影响**：`client.ts:34` 注释"便于既有调用方从 imagesApi 入口拿"具有误导性；死代码无害，可清理。

#### A4. `normalizeStreamPartialImages` 在两个文件中重复定义 ｜ low
- **位置**：`src/services/imagesApi/client.ts:298-302` 与 `src/services/imagesApi/responses.ts:189-193`
- **问题**：同一 helper 在两处逐字重复（含同样的 `Math.min(3, Math.max(0, Math.trunc(numeric)))` 钳制）。
- **影响**：当前行为完全一致，但正是本次重构旨在消除的漂移风险；可上提到 `http.ts` 或 `types.ts`。

---

### B. 新增 shared / services 工具模块

#### B1. `toPlainImageAsset` 仍存在重复定义（提取不彻底） ｜ low
- **位置**：新增 `src/services/messageSerialization.ts:46`；旧本地副本仍保留在 `src/stores/imagesStore.ts:349`
- **问题**：两者实现逐字相同（含 `clonePromptWordbanks` 用法）。`imagesStore.ts` 内部多处（`150,166,237,305`）仍调用本地私有副本，而 `generationStore.ts:26,464` 已 import 新的共享版本。
- **影响**：提取未完成，两份副本存在漂移风险。建议删除 `imagesStore` 本地副本并改为 import。

#### B2. `imageExtension` / `imageDownloadName` 在 `messageImageFormat.ts` 仍有本地副本 ｜ low
- **位置**：`src/components/chat/message-parts/messageImageFormat.ts:3-11`（未改动，预存）；新规范版在 `src/shared/fileFormatters.ts:41,48`
- **问题**：本次重构把 `imageLibraryFormatters.ts:16-22` 正确改为委托共享版本，但 `messageImageFormat.ts`（被 `ResultImageCard.vue:4,184` 使用）仍保留自己的 `imageExtension(image?: ImageAsset)` / `imageDownloadName(image?: ImageAsset)`。
- **影响**：MIME→扩展名映射出现两个真相源。注意签名不同（`image?: ImageAsset` 可空 vs 共享版 `image: ImageAsset` / `mimeType?: string`），合并需谨慎。属预存遗留，非本次引入。

#### B3. `StorageUsagePanel.vue` 保留本地 `formatBytes` ｜ low
- **位置**：`src/components/image-library/StorageUsagePanel.vue:30-40`；新共享版在 `src/shared/fileFormatters.ts:16` (`formatFileSize`)
- **问题**：新 `formatFileSize` 已被 `BatchImagesPanel.vue`、`imageLibraryFormatters.ts`、`ComposerAttachmentList.vue` 采用，但 `StorageUsagePanel.vue` 仍有本地 `formatBytes`，且 0 字节返回 `"0 KB"` 而非共享版的 `"未知大小"`。
- **影响**：存在两个字节格式化 helper；差异或为有意（存储面板用 "0 KB" 更有意义）。建议以注释声明为有意保留，或合并。

#### B4. `urlSettings.ts` 与 `settingsSerialization.ts` 存在同名异义函数 ｜ low（预存）
- **位置**：`src/services/urlSettings.ts:347` (`normalizeBackground`)、`:379` (`stripImagesApiPath`)；`src/services/settingsSerialization.ts:126,141`
- **问题**：`urlSettings.ts` 的 `normalizeBackground` 是字符串枚举校验器（非法返回 `undefined`），而共享版是 transparent→auto 转换器；`urlSettings.ts` 的 `stripImagesApiPath` 额外剥离 `/v1`（`:384`），共享版不剥离。**两者语义不同但同名**。
- **影响**：命名碰撞易致维护误判；共享版 `stripImagesApiPath` 缺失 `/v1` 剥离逻辑——若期望一致行为是 bug。属预存遗留，非本次引入。

#### B5. `clipboard.ts` 抽取未应用到全部调用点 ｜ low
- **位置**：`src/shared/clipboard.ts:8`（新）；`src/components/settings/PromptGuardSettingsPanel.vue:53`、`src/components/settings/ApiSettingsPanel.vue:77`
- **问题**：新 `copyText` 提供 Clipboard API + textarea 回退（适配非安全上下文 / Tauri webview），但上述两个组件仍直接调用 `navigator.clipboard.writeText`（无回退）。
- **影响**：抽取价值被未转化的调用点削弱；新文件本身无 bug。

#### B6. `blobToDataUrl` 字符串拼接为 O(n²) ｜ low（性能）
- **位置**：`src/shared/blobConverters.ts:29-31`
- **问题**：`binary += String.fromCharCode(...)` 在循环中逐字符拼接，对多 MB 图片（应用上限 20MB）性能 quadratic。`base64ToBlob`（`:10-18`）正确写入预分配 `Uint8Array`，无此问题。
- **影响**：功能正确但大图较慢；建议分块 `btoa` 或用 `FileReader.readAsDataURL`。

#### B7. `src/shared/constants.ts` 的 `WEB_DEV_PORT` 是死导出 ｜ low
- **位置**：`src/shared/constants.ts:16`
- **问题**：`WEB_DEV_PORT = 8888` 定义并导出但**无任何消费者**。Companion 的 CORS 白名单（`companion/src/securityConfig.ts:15-16`）独立硬编码 `"http://127.0.0.1:8888"` / `"http://localhost:8888"`，不从 Web 包读取此常量（两者是独立包）。注释称"用于 Companion CORS 白名单"但实际未接通。
- **影响**：死代码；要么接通要么删除。

#### B8. 测试覆盖小缺口（均 low，行为正确）
- `imageEditRequest.ts`：`resolveImageEditRequest` 中"mask 成功解析但 source 缺失"的路径（`:97-105` 先解析 mask，`:116` 再抛 source 错误）未被测试直接覆盖；现有 `imageEditRequest.test.ts:136-148` 用通用 PNG 占位，未走 mask 解析成功分支。行为正确。
- `messageSerialization.ts`：`toPlainMessage` 复制 `editSourceImageId` / `editMaskImageId`（`:40-41`），但测试从未设置/断言这两字段；若日后被误删，测试仍会绿。
- `blobConverters.ts`：缺少空 Blob（`size === 0`）测试，会走到 `btoa("")` 与无类型时 `application/octet-stream` 回退分支。

#### B9. `shared/` vs `services/` 边界语义被模糊（提示，非问题） ｜ informational
- **位置**：`src/services/sizeConstraints.ts`、`src/services/promptRewriteGuard.ts`、`src/services/generationLabels.ts`
- **现状**：AGENTS.md 规定 `src/services/` 是 IndexedDB/IO 层，但这三个新模块是纯校验/字符串工具，无 IO。因 import 方向约束（`imagesApi` barrel 不能从 `shared/` 反向 import），放在 `services/` 可接受，`imagesApi/index.ts:5-6` 注释亦已说明。
- **建议**：在 AGENTS.md 补一句"`shared/` = 对 services 无类型依赖；`services/` = IO 层 + 被 IO 层依赖的纯工具"，澄清新边界语义。

---

### C. Companion provider 层

#### C1. `gemini.ts` 未迁移到共享 `assertEditImageCount` ｜ low（已修复，见复审记录）
- **位置**：`companion/src/providers/adapters/gemini.ts:91-93`
- **问题**：`editGuards.ts` 头部注释明确目标是收敛各 adapter 的"0 张图抛错 / 过多图抛错"样板，`qwen.ts`、`wan.ts` 已迁移，但 `gemini.ts:91-93` 仍手写 `if (request.images.length === 0) throw new Error("Gemini 图片编辑需要至少一张参考图。")`，措辞也略有不同（"图片编辑" vs 共享版的"图像编辑"）。
- **影响**：正是抽取旨在消除的不一致；Gemini 属不同 adapter 家族（editConstraints 可能不声明 maxImages），但零图守卫形状相同，可调用 `assertEditImageCount("Gemini", request.images.length, undefined)`。属外观/可维护性问题，非 bug。
- **修复**：复审时已修复，`gemini.ts` 已 import 并使用 `assertEditImageCount("Gemini", ...)`。

#### C2. 工厂路径（`openaiCompatible.ts`）的 edit 守卫未被迁移，且未在注释中声明 ｜ low（信息性）
- **位置**：`companion/src/providers/editGuards.ts:14-17`（注释）vs `companion/src/providers/openaiCompatible.ts:307,377`
- **问题**：`editGuards.ts` 注释正确指出工厂（deepinfra/glm/doubao）自管守卫，但工厂守卫未被改动，仍抛不同消息（`"${config.id} 图生图需要至少一张参考图。"`），且不强制 `maxImages`。
- **影响**：无正确性问题——`images.ts:130-135` 在路由层为所有 provider 统一强制 `maxImages`。仅提示：抽取在工厂边界有意停止，若追求跨 provider 错误措辞完全一致需进一步处理。

#### C3. `assertEditImageCount` → `MAX_EDIT_IMAGES` 接线无直接集成测试 ｜ low
- **位置**：`companion/src/providers/adapters/qwen.ts:97`、`wan.ts:120`
- **问题**：`editGuards.test.ts` 隔离测试了 `assertEditImageCount`，但无测试断言 `qwenAdapter.edit`/`wanAdapter.edit` 在传入 > `MAX_EDIT_IMAGES` 张图时实际抛错。若有人误改 `MAX_EDIT_IMAGES` 接线，现有 adapter 测试（mock 了 `urlToB64`，未驱动 edit 路径越过守卫）不会发现。
- **影响**：共享 helper 测试充分；接线未覆盖。代码简单风险低，但属本次重构核心改动的覆盖缺口。

#### C4. `storeRouteWrapper.ts` 审查通过 ｜ ✅ 无问题
- 导出 `handleStoreError`（从 `credentials.ts` 原样迁出）与新 HOF `withStoreErrorBoundary(reply, fn)`，封装重复的 try/catch。`credentials.ts` 全部 6 个 store 变更路由已采用；`CredentialStoreError` import 正确从 `credentials.ts` 移到 wrapper。
- **安全**：wrapper 纯为错误边界糖，不触及 auth；loopback 守卫（`loopback.ts`）仍通过 `credentials.ts:44` 注册的 `onRequest` 钩子包裹所有 credential 路由；不记录任何 secret/prompt/base64（仅转发 `CredentialStoreError` 的 `error.message`）；监听 `127.0.0.1` 是 `server.ts` 的绑定关注点，不受影响。

#### C5. 5 个 provider adapter 行为一致性审查通过 ｜ ✅ 无问题
- 全部遵循同一模式：`parseSizeInput(...)` → 检查 `parsed.auto` → 检查 `parsed.width/height === undefined` → `finalizeSize(...)`。
- 各 adapter 间的差异（不同 `basePixelsStrategy`、DashScope 用 `*` 分隔、`alignToStepAtLeastMin` vs `alignToStep`、GLM/Wan/Qwen 像素压缩循环）均为合理的 provider 特性差异，正确保留。
- **共享逻辑提取完整**：grep 确认无 adapter 残留本地 `alignToStep`/`clamp`/`toDashScopeSize`/`dimensionsFromRatio`，全部 import 自 `sizeUtils.ts`；三种 `basePixelsStrategy` 忠实复现原公式。
- **无回归**：`dimensionsFromRatio("0:0") → {0,0}` 仍流到 `finalizeSize(0,0)`（钳到 min），与重构前一致；`shrinkLongestSideByStep` 提取保留 `width >= height` 平局规则；无丢失的尺寸翻译、edit 支持或轮询逻辑（qwen/wan 同步无轮询）。
- **测试质量**：`editGuards.test.ts`（6 例，覆盖零图/限内/超限/undefined maxImages 两分支/label 透传）、`sizeUtils.test.ts`（22 例，覆盖 `parseSizeInput` 全形态、三种策略的 `dimensionsFromRatio`、`alignToStep` 含 banker's rounding 边界、两种 clamp、`shrinkLongestSideByStep`、`toDashScopeSize`），断言具体数值，质量良好。

---

### D. UI 组件重构（BaseModal 等）

#### D1. `BaseModal` 缺焦点管理 / ESC 关闭（预存 a11y 缺口，非回归） ｜ low
- **位置**：`src/components/ui/BaseModal.vue:1-78`
- **问题**：`BaseModal` 处理 `mousedown.self` 背景关闭与 `aria-modal`/`aria-labelledby`，但**无焦点陷阱、无首焦点元素 autofocus、无 ESC 关闭**。这在重构前的三个对话框中本就如此（旧 `ConfirmInputModal`/`RenameDialog` 也从未调用 `.focus()` 或设 `autofocus`）。
- **影响**：**非本次引入的回归**。BaseModal 头部注释声明目标是"合并骨架而不改行为"，保持一致。但本次审查任务前提假设"BaseModal 处理焦点/ESC"——实际并未。键盘用户在任一对话框按 ESC 无反应。可作后续改进项。

#### D2. `ConfirmDialog` 依赖 `dialog!` 非空断言，耦合 BaseModal 内部实现 ｜ low
- **位置**：`src/components/ui/ConfirmDialog.vue:32,35,50,57`
- **问题**：`BaseModal` 仅在 `isOpen` 真值时通过 `<slot />` 渲染，`ConfirmDialog` 传 `:is-open="Boolean(dialog)"`。slot 内模板用 `dialog!.title` 等，非空断言**当前正确**（`BaseModal` 的 `v-if="isOpen"` 守卫了 slot），但脆弱——依赖 BaseModal 把 slot 放在 `v-if` 内这一实现细节。
- **影响**：若 BaseModal 未来改为无条件渲染 slot（如为 transition 包裹），运行时会抛错；类型检查无法捕获。`ConfirmInputModal`/`RenameDialog` 用扁平 props 无此问题。

#### D3. `formatFileSize` 新增 GB 档（行为严格超集） ｜ low
- **位置**：`src/shared/fileFormatters.ts:16-25`（被 `imageLibraryFormatters.ts:29-31`、`BatchImagesPanel.vue:38` 使用）
- **问题**：旧 `fileSize`：falsy→"未知大小"，<1MB→KB，其余 MB。新 `formatFileSize` 同样处理 + 新增 `≥1GB → "X.XX GB"` 分支。
- **影响**：对单张 `ImageAsset` 达 1GB 不现实，实际输出不变；输出格式是严格超集（大尺寸更准确），无消费者解析这些显示串。可接受，记录为有意的语义扩展。

#### D4. UI 重构其余项审查通过 ｜ ✅ 无问题
- **BaseModal 采用一致性**：`ConfirmDialog`、`ConfirmInputModal`、`RenameDialog`、`SettingsModal` 均正确采用；`ImagePreviewModal` 正确**不**采用（BaseModal 头部注释说明原因：全屏沉浸式查看器，关闭需防拖拽误触，靠 `pointerDownOnSelf`/`didDrag` 守卫）——有意的、已文档化的排除。
- **Props/emits/slots 全部保留**：四个对话框公共契约不变。已对照调用方校验（`StudioShell.vue:90-125`、`SettingsModal.vue:316`、`BatchOperationsPanel.vue:461`、`AnalyticsPanel.vue:124`），无需更新任何调用方。
- **背景关闭语义等价**：旧 `@mousedown.self` → 新 `handleBackdrop`（`event.target !== event.currentTarget` 检查 + `closeOnBackdrop` 门），行为等价；默认 `closeOnBackdrop: true` 与旧三方对话框一致。
- **z-index 一致**：`SettingsModal` 传 `z-class="z-50"`（与旧 `z-50` 一致）；三个小对话框用 BaseModal 默认 `z-60`（与旧 `z-60` 一致）。
- **禁用态/校验保留**：`ConfirmInputModal` 保留 `canConfirm = inputValue === confirmText`；`RenameDialog` 保留 `canConfirm = Boolean(normalizedValue.value)`（trim）；`ConfirmDialog` 的 `tone === 'danger'` 按钮配色不变。
- **PromptGuardSettingsPanel import 迁移**：`PROMPT_REWRITE_GUARD_PREFIX` 改从 `../../services/promptRewriteGuard` 引入；`imagesApi/index.ts` barrel 仍 re-export 它，其余从 `imagesApi` 引入的消费者不受影响。
- **Scoped CSS 合规**：本次触及的 11 个文件均未引入新的 `<style>` 块；BaseModal 纯工具类；仓库内仅有的 scoped 样式（`EditMaskModal.vue:630`、`PendingGenerationCard.vue:68`）为预存且未改动。符合 AGENTS.md §Styling。

---

### E. Store / ViewModel 重构

#### E1. 重构审查全部通过 ｜ ✅ 无问题

**generationStore**：仅提取纯 helper，未删除任何状态机逻辑：
- ~95 行内联 edit-request 解析（参考图 blob 加载、20MB 上限、mask PNG/尺寸校验、源图校验）→ `src/services/imageEditRequest.ts`（`resolveImageEditRequest`），在 `generationStore.ts:507` 调用；错误串与校验顺序逐字保留。
- Label/filename helper → `src/services/generationLabels.ts`；`toPlainMessage`/`toPlainImageAsset` → `src/services/messageSerialization.ts`（字段对字段相同，含 `clonePromptWordbanks`）；`base64ToBlob` 改从 `src/shared/blobConverters.ts` 引入。
- **Job 生命周期完整**（`generationStore.ts:140-251` submitMessage、`382-495` runImageRequest）：创建 user+assistant 消息 → `saveMessage(toPlainMessage(...))` 持久化 → 派发 `imageClient.generate`/`.edit`（按 `referencedImageIds.length` 分支）→ 成功创建 `ImageAsset` + `saveImageBlob`/`saveImageAsset` + `markJobSuccess` → 失败 `markJobError` + 设 errorMessage。`retryMessage`/`generateAnother`/`refreshGeneratedImage`/`rerunMessageGeneration` 全保留。
- **Abort/cancel**：generationStore 重构前后均无 abort/cancel 处理（位于 `imagesApi/` 的 HTTP 层），不变。
- **Streaming preview**：`partialPreviewUrls`/`updatePartialPreview`/`clearPartialPreview`/`getPartialPreviewUrl` 及 `onPartialImage` 接线（`generationStore.ts:385-393`）完整保留。
- **消息写串行化**：`messageSaveQueues`（`Map<string, Promise>` 链）在 `generationStore.ts:84, 694-710` 完整保留。
- **会话写队列**（AGENTS.md 强调）：本就不在 generationStore，位于 `conversationsStore.ts:30,193-201`（`persistConversation` 内的 `conversationWriteQueue`）；generationStore 仍通过 `input.value.persistConversation(...)`（`generationStore.ts:220`）路由，viewmodel 将其接到 `conversations.persistConversation`（`useStudioViewModel.ts:230`）。端到端串行化保证保留。

**settingsStore**：所有模块级纯 helper（wordbank get/set、prompt-guard history normalize/add/clone、favorite-prompt clone、background normalizer、`displayApiBaseUrl`/`stripImagesApiPath`、`MAX_PROMPT_REWRITE_GUARD_HISTORY`）原样上提到 `src/services/settingsSerialization.ts` 并 import 回来；store 的响应式 state/getters/actions 不变。
- **无序列化形状变化**：`settings.ts`（IndexedDB 持久化服务）仅把 `PROMPT_REWRITE_GUARD_PREFIX`/`normalizePromptRewriteGuardText` 的 import 源从 `./imagesApi` 换到 `./promptRewriteGuard`（两者经 `imagesApi/index.ts` barrel re-export 同样的常量）；持久化的 `AppSettings` 对象形状一致。
- **调用方形状不变**：`currentSettings()`、`currentSizeConstraints`、`applySettings` 等不变；typecheck 确认所有消费者通过。`companionUrl` 默认值从字面量 `"http://127.0.0.1:19750"` 改为 `COMPANION_DEFAULT_URL`（`shared/constants.ts:13`，求值为同一字符串），行为等价。

**useStudioViewModel** → `useStudioDrafts.ts`：干净的委托，无重复：
- 全部 draft CRUD（`createDefaultDraft`/`createLegacyDraft`/`currentConversationDraft`/`applyConversationDraft`）、debounce 保存（`scheduleSaveActiveDraft`/`saveActiveDraft`，250ms）、切换串行队列（`draftSwitchQueue`）、变更 watcher、URL override、会话 select/create/delete 的 draft 协调均迁出，逻辑逐行等价。
- **`draftSwitchQueue`（快速切换会话的竞态守卫）保留**于 `useStudioDrafts.ts:86,212-225`：相同 promise 链模式、相同 `.catch(onStorageError)` 吞错、相同 save→select→load→apply 序列。
- **有意保留在 viewmodel**（内联注释已说明）：`clearConversationDraft`（被 `useStudioConversations` 经 `clearDraft` 参数使用且依赖 `images`/`composerState`，迁出会形成 drafts↔conversations↔images 环）；`selectConversationWithDraft` 周边的 analytics 追踪（viewmodel 包装 `drafts.selectConversationWithDraft` 以便 `setContext`+`track` 在排队 select 前同步触发）。
- **无重复**：`applyGenerationParams` 仅存在于 `useStudioDrafts.ts:147`，viewmodel 经 `drafts.applyGenerationParams` 消费。
- **`copyText` 提取**到 `shared/clipboard.ts` 行为等价，且更健壮：新版把 `navigator.clipboard.writeText` 包在 try/catch 中并在 reject 时回退到 textarea 路径（旧版仅在 `writeText` 不存在时回退），严格更优。

**companionApi / backups / settings 小 diff**：
- `companionApi.ts`：魔法数 `3000`（health 超时）替换为 `COMPANION_HEALTH_TIMEOUT_MS`（=3000），注释同步引用常量；运行时行为一致。
- `backups.ts`：单一 import 源替换（`./imagesApi` → `./promptRewriteGuard`），无逻辑/格式变化。
- `settings.ts`：同 backups.ts 的 import 源替换，无持久化形状变化。

---

## 汇总表

| # | 领域 | 严重度 | 类型 | 是否本次引入 |
|---|------|--------|------|--------------|
| A1 | imagesApi | low | 文档失真 | 是 |
| A2 | imagesApi | low | 风格不一致 | 是 |
| A3 | imagesApi | low | 死代码 | 是 |
| A4 | imagesApi | low | 重复定义 | 是 |
| B1 | 工具模块 | low | 提取不彻底 | 是 |
| B2 | 工具模块 | low | 重复定义 | 否（预存） |
| B3 | 工具模块 | low | 重复定义 | 否（预存） |
| B4 | 工具模块 | low | 命名碰撞 | 否（预存） |
| B5 | 工具模块 | low | 抽取未全覆盖 | 是 |
| B6 | 工具模块 | low | 性能 | 是 |
| B7 | 工具模块 | low | 死代码 | 是 |
| B8 | 工具模块 | low | 测试缺口 | 是 |
| B9 | 工具模块 | info | 边界语义 | 是 |
| C1 | Companion | low | 迁移不彻底 | 是 |
| C2 | Companion | low/info | 范围边界 | 是 |
| C3 | Companion | low | 测试缺口 | 是 |
| D1 | UI | low | a11y 缺口 | 否（预存） |
| D2 | UI | low | 实现耦合 | 是 |
| D3 | UI | low | 行为扩展 | 是 |
| E1 | Store/VM | ✅ | — | — |

**关键回归**：0 项。
**中等问题**：0 项。
**低问题**：18 项（其中 6 项为预存遗留，非本次引入；1 项为 informational）。

## 建议的后续清理优先级

1. **B1**（删除 `imagesStore` 本地 `toPlainImageAsset`，改 import 共享版）——最直接的漂移风险消除。
2. **A4 / B2**（消除 `normalizeStreamPartialImages` 与 `messageImageFormat` 的重复）——本次重构本应消除的重复。
3. **B7**（删除死导出 `WEB_DEV_PORT` 或接通）——死代码。
4. **A3 / C1**（清理 `client.ts` 死 re-export；`gemini.ts` 迁移到 `assertEditImageCount`）——完成未竟的抽取。
5. **B8 / C3**（补测试：`messageSerialization` 的 edit 字段、`imageEditRequest` 的 mask 成功+source 缺失路径、adapter edit 守卫接线）——加固本次重构的核心改动。
6. **A1 / B9**（更新 `imagesApi/index.ts` 注释与 AGENTS.md 的 shared/services 边界说明）——文档准确性。

其余 low 项（A2 风格、B3/B4/B5 预存、B6 性能、C2 工厂边界、D1 a11y、D2 耦合、D3 行为扩展）可在后续迭代中酌情处理，均不阻塞本次提交。
