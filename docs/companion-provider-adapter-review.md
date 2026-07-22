# Companion 多模型适配层审查

审查日期：2026-07-16

## 目的

本文记录当前 Companion 多 Provider 适配层的实现方式、已确认的设计决策、主要风险和建议整改顺序。

审查范围：

- Web 侧 `localCompanionImagesClient`
- Companion 图片路由与 multipart 解析
- Provider Adapter 契约和 Registry
- OpenAI、GLM、豆包、Qwen、Wan、Grok、Gemini Adapter
- Provider 能力回流
- 凭据、连接密钥、Origin 和 URL 下载边界

本文描述的是当前实现诊断，不替代各 Provider 的专项接入方案。安全信任模型以
[ADR 002](decisions/002-companion-security-boundary.md) 为准。

## 当前架构

Companion 对 Web 保持 OpenAI Images API 兼容形状，在 Companion 内部完成厂商协议翻译：

```text
Web generation params
  -> localCompanionImagesClient
  -> POST /images/generations 或 /images/edits
  -> route 边界校验和内部请求归一化
  -> registry 根据激活凭据选择 ProviderAdapter
  -> Adapter 翻译鉴权、字段、尺寸和图片输入
  -> 调用厂商接口
  -> Adapter 解析厂商响应
  -> 统一返回 data[0].b64_json
  -> Web 保存 ImageAsset 和 Blob
```

`ProviderAdapter` 负责：

- 声明文生图、编辑、mask、背景和输出格式能力。
- 声明尺寸约束与分辨率档位。
- 将统一请求翻译为厂商请求。
- 将 URL、内联 base64 或厂商特有响应归一化为 `b64Json`。
- 在能力依赖模型时，通过可选方法返回动态尺寸能力。

`/auth/status` 将当前 Adapter 的能力、尺寸约束和分辨率档位返回给 Web；
`settingsStore` 据此调整参数 UI。

## Provider 实现概览

| Provider | 请求方式 | 编辑 | 主要翻译 |
| --- | --- | --- | --- |
| OpenAI | Images API JSON / multipart | 支持 mask | 基本透传，统一解析 `b64_json` |
| GLM | `/images/generations` | 不支持 | 裁剪字段、规整尺寸、URL 下载转 base64 |
| 豆包 | `/images/generations` JSON | 支持，无 mask | 固定关闭水印，参考图转 data URL |
| Qwen | DashScope multimodal generation | 支持，无 mask | 消息 content 数组、URL 下载转 base64 |
| Wan | DashScope multimodal generation | 支持，无 mask | 模型相关尺寸能力、URL 下载转 base64 |
| Grok | `/images/generations` 和 `/images/edits` JSON | 支持，无 mask | 比例和分辨率字段、多图 data URL |
| Gemini | `generateContent` JSON | 支持，无 mask | `parts`、`inline_data`、图片生成配置 |

## 做得合理的部分

### Adapter 边界清晰

厂商特有的鉴权、尺寸换算、multipart、DashScope 响应解析和 URL 转 base64 都留在
Companion 内部，Web 不需要持续增加 Provider 分支。

### 统一结果形状

无论厂商返回 URL 还是内联图片，路由最终都返回 `data[0].b64_json`，可以复用现有
生成任务、图片存储和消息状态流程。

### 能力驱动 UI

Provider 能力和尺寸约束由 Companion 回流，避免 Web 写死所有厂商规则。Wan 已经通过
`getSizeConstraints` 和 `getResolutionOptions` 展示了按模型动态返回能力的正确方向。

### 基础本地安全措施

当前实现包含：

- 只监听 `127.0.0.1`
- Origin 白名单和非通配 CORS
- 连接密钥保护生成、状态和日志接口
- 请求体大小限制
- 上传图片数量和 MIME 初步限制
- 日志中的 Authorization、API Key 和 base64 脱敏
- 凭据文件和连接密钥文件使用 `0600` 权限

## 已确认的安全决策

凭据管理接口允许以下主体访问：

- 无 `Origin` 的本机 CLI 或本机进程
- loopback Origin
- Companion 配置中的受信 Origin，例如正式站点 `https://image.honlnk.com`

受信 Web Origin 可以读取和管理明文 Provider API Key。这是项目明确接受的信任模型，
不再视为实现缺陷。

该决定意味着官方 Web 站点是本地凭据的受信主体。站点 XSS、前端依赖供应链污染或部署
内容被篡改时，可能读取本地 Provider 凭据；项目接受这一剩余风险，并依靠严格 Origin
白名单、HTTPS、站点安全和 Companion 仅监听 loopback 来降低风险。

## 已完成整改

### Provider URL 下载网络边界

状态：已于 2026-07-16 修复，实现在
`companion/src/providers/urlToB64.ts` 和
`companion/src/providers/outboundAddressPolicy.ts`。

GLM、Qwen 和 Wan 返回图片 URL 后，Companion 仍会立即下载并转为 base64，但下载路径
已经改为受限 HTTPS 客户端：

- 只允许 HTTPS，拒绝带用户名或密码的 URL。
- 拒绝 loopback、RFC 1918 私网、CGNAT、link-local、云元数据常用地址、组播、文档和
  保留地址；覆盖 IPv4、IPv6、IPv4-mapped IPv6 以及 URL 规范化后的非常规 IPv4 写法。
- DNS 使用 `all: true` 解析；任一结果为非公网地址时整体拒绝。通过同一个受控
  `lookup` 把已校验地址交给实际 HTTPS socket，避免 DNS rebinding。
- 禁用自动重定向并逐跳处理 301、302、303、307、308；每一跳重新校验，默认最多 3 次，
  同时检测重定向循环。
- 只接受 PNG、JPEG 和 WebP；校验 `Content-Type`、`Content-Encoding` 和图片 magic
  bytes，防止 HTML 或其他内容伪装成图片。
- 同时检查 `Content-Length` 和流式读取的实际字节数，默认最大 32 MiB；超限立即销毁
  响应，不再使用无限制的 `arrayBuffer()`。
- 只重试明确的瞬时网络错误、HTTP 408、429 和 5xx；SSRF 策略失败、普通 4xx、文件类型、
  文件签名、大小和 TLS 证书错误不重试。

测试覆盖公网/私网 DNS、混合 DNS 结果、特殊 IP 写法、协议和 URL 凭据、三种图片签名、
响应头、流式超限、重定向、重试分类，以及 GLM/Qwen/Wan 对下载器的调用边界。

剩余取舍：

- 自定义 Provider/CDN 必须提供公网 HTTPS URL。
- URL 图片必须是 PNG、JPEG 或 WebP，且不得超过 32 MiB。
- 下载完成后仍需要在 32 MiB 边界内聚合 Buffer 并转换 base64，内存占用是有上限的，
  但不是零拷贝。

### Provider 取消传播与错误分类

状态：已于 2026-07-20 修复，实现在 `companion/src/providers/providerErrors.ts`、
`companion/src/providers/providerHttp.ts`、`companion/src/routes/images.ts`。

此前所有 provider 主请求的 fetch 都是裸调用，没有任何超时和取消机制；网络层异常
统一被一句 `UPSTREAM_DISCONNECT_MESSAGE`（"通常是提示词不合规，触发了内容审核策略"）
吞掉，导致 DNS 失败、TLS 错误、连接重置、真实的客户端断开全部显示成"提示词不合规"，
让用户改提示词修不了真实问题。本次整改分两件事：

**取消传播（review 第二批第 3 项的取消部分）**：

- 浏览器刷新/关页面时，Fastify 在 `req.raw` 上触发 `close` 事件。
- route 层 `withClientSignal` 监听该事件，构造 `AbortController`，在
  `!reply.raw.headersSent` 时调用 `abort()`，让 signal 一路传到 provider fetch，
  立即取消上游请求，释放凭据/连接。
- `ProviderAdapter.generate/edit` 接口加可选第三参 `{ signal?: AbortSignal }`，
  各 adapter 透传到 `postJson` / `postMultipart`；GLM/Qwen/Wan 还透传给 `urlToB64`
  下载器，避免 API 已返回后下载继续烧流量。
- finally 里 `off('close', listener)`，避免 EventEmitter 泄漏。
- `headersSent` 检查避免正常响应完成后误触发 abort。

**主请求超时按决策不实现**：生图任务（尤其 gpt-image-2）正常可能耗时 5+ 分钟，
设硬超时会误杀长任务；用户刷新浏览器即可触发取消传播，是更自然的取消入口。
`timeout` category 仍保留在分类表里，未来加超时机制不用改响应 shape。

**错误分类（review 第二批第 4 项）**：

- 新增 `providerErrors.ts`：按 errno / DOMException name / HTTP 状态分类成
  12 个 category（`aborted` / `timeout` / `dns` / `tls` / `reset` / `refused` /
  `network` / `http_4xx` / `rate_limited` / `http_5xx` / `content_policy` / `unknown`）。
- 删除 `UPSTREAM_DISCONNECT_MESSAGE` 这句误导文案。`reset` category 保留"可能是
  审核"的猜测——因为 ECONNRESET 确实是部分 provider 审核的真实表征——但局限到
  这一类，不再扩散到所有网络异常。
- HTTP 层 `buildHttpErrorFromResponse` 优先用上游 `error.message`，缺失时按
  category 给中文兜底文案（如"Provider 触发限流，请稍后重试"）。
- `content_policy` category 保留但不主动触发：当前没有 provider 真返回可识别的
  审核字段，留作未来检测真实审核响应的扩展位。
- route 502 响应体从 `{ error: string }` 扩成 `{ error: string, category? }`，
  Web 端 `localCompanionImagesClient.ts` 现有读取天然兼容（向后兼容），后续可按
  category 做差异化 UI（dns 引导检查 apiBaseUrl、rate_limited 退避重试等）。

**合并 multipart helper**：`openai.ts` 和 `openaiCompatible.ts` 此前有字节级重复
的 `fetch + try/catch` multipart 样板，本次借 `postMultipart` helper 顺手合并。

测试：新增 `providerErrors.test.ts`（47 个分类单元测试）、扩展 `images.test.ts`
（8 个 `withClientSignal` + `errorPayload` 单元测试）、扩展 `images.integration.test.ts`
（9 个端到端分类集成测试，覆盖 ENOTFOUND / ECONNREFUSED / AbortError / 4xx / 429 /
5xx 等场景）。9 处 adapter 测试的旧文案断言同步改为按 errno → category 断言。

### 凭据文件损坏不再静默视为空配置

状态：已于 2026-07-21 修复（P3-A），实现在 `companion/src/credentials.ts`、
`companion/src/routes/credentials.ts`、`companion/src/routes/auth.ts`、
`companion/src/main.ts`、Web 侧 `src/services/companionApi.ts` +
`src/features/companion/useCompanionConnection.ts`。

此前 `loadStore` 把 JSON 解析失败、结构不合法、entry 字段缺失全部吞进空 `catch {}`
返 `emptyStore()`，用户看到的现象是「所有 Provider 配置突然消失」——实际上是文件
坏了，不是真的没配置。更严重的是：后续任何 `addCredential`/`updateCredential` 等
「读-改-写」操作会 load 到空 store 后再 save，**把损坏的原始文件彻底覆盖**，数据
不可恢复。本次整改让损坏可诊断、数据不丢失、用户能立即恢复：

**损坏检测与备份**：

- `loadStore` 不再返空 store；JSON 不可解析或结构不合法时，先把损坏文件备份到
  `credentials.json.corrupt-{timestamp}.json`（rename，跨设备退回 copy+unlink），
  再抛 `CredentialStoreError`（`CRED_PARSE_FAILED` / `CRED_INVALID_STRUCTURE`，
  对齐 `ProviderCallError` 范式：自定义 Error 子类 + `this.name` + ES2022 `cause`）。
- `validateStore` 严格校验每个 entry 的 8 个字段（id/label/provider/apiBaseUrl/
  apiKey/model/createdAt/updatedAt）全部存在且为非空 string。任一缺失视为损坏——
  这些字段都由 `addCredential`/`updateCredential` 自动写入，缺失意味着文件被外部
  编辑过，这类文件风险高，宁可误判也不要漏过（项目凭据格式已强转，不存在遗留旧格式）。
- 孤儿 `activeId`（指向不存在的 entry）不视为损坏，load 时静默回退到首条
  （和 `removeCredential` 回退逻辑一致），记 warn 日志。
- 抛错而非返 result 类型：让「读-改-写」链路自然中止，route 层只在边界 catch 一次。

**route 层错误响应**：

- `/credentials` 所有 5 个 route handler 用 `handleStoreError(reply, fn)` 统一 catch
  `CredentialStoreError`，返 `500 + { error, corrupt: true }`；非 CredentialStoreError
  重新抛出交给 Fastify 默认处理器。
- `/auth/status` **不主动探测损坏**：`getActiveCredential` 内部 catch
  `CredentialStoreError` 返 null，让本路由走「无凭据」正常分支（ready:false + OpenAI
  默认能力）。损坏原因由 `/credentials` 的 500+corrupt 通道展示。
  - 取舍：曾考虑让 `/auth/status` 也返 `200 + corrupt:true` 做双保险，但真实运行测试
    发现——浏览器打开页面时 `/credentials` 和 `/auth/status` 几乎同时被调，先到的那个
    会把损坏文件备份走，后到的就拿不到损坏信号了（文件已不在）。双保险在真实时序下
    不成立，所以简化为单通道：损坏信号只在 `/credentials` 的 500+corrupt 里。
- `getActiveCredential` 内部 catch 让 `images` route 也走现有「无凭据返 503」路径，
  不需要每个调用方都处理损坏异常。

**Web 端最小改动**（本批只走通用错误通道，UI 重构见下一小节）：

- `listCompanionCredentials` 像 `addCompanionCredential` 那样读 response body 的
  `error` 字段，复用现有 `credError` 红字通道展示损坏原因（"凭据文件损坏，已备份到 X，
  请重新配置 provider"）。
- 真实运行测试发现：单纯靠 `credError` 红字不够——浏览器会连续发多次 `/credentials`，
  第一次拿到 500+corrupt 后第二次拿到 200 空列表，`credError` 被清空，用户看不到提示。
  解决方案在下一小节：内存事件缓存 + 独立异常面板 + 两个恢复动作。

**CLI 错误展示**：

- 6 个 credentials 子命令（list/show/add/edit/remove/activate）+ status 命令用
  `withCredentialStoreErrorCLI(fn)` 统一 catch，打印可读错误信息 + 设 `exitCode=1`，
  不崩栈。status 命令单独处理：凭据部分损坏时打印原因但不阻断后续服务/密钥状态输出。

测试：新增 `credentials.test.ts` 的「corruption handling」describe block（8 个单元测试：
JSON 不可解析、结构不合法、entry 缺字段、entry 空串字段、孤儿 activeId 回退、
addCredential 不覆盖备份、两个 code 值）；新增 `credentials.integration.test.ts`
（5 个集成测试：`/credentials` 返 500+corrupt、`/auth/status` 返 200+corrupt、
健康文件不触发 corrupt 字段）；`auth.test.ts` mock 同步覆盖 `listCredentials`。

剩余取舍：

- 备份文件堆积（用户反复触发损坏）不做自动清理，避免误删用户想保留的备份。
- `accessKey.ts` 的空 catch 不改——access key 损坏时 `loadOrCreateAccessKey` 自动
  重新生成（行为合理），不像 credentials 损坏会丢用户数据。

### 凭据损坏：内存事件缓存 + 独立异常面板 + 两个恢复动作

状态：已于 2026-07-22 修复，实现在 `companion/src/credentials.ts`、
`companion/src/routes/credentials.ts`、Web 侧 `src/services/companionApi.ts` +
`src/features/companion/useCompanionManagement.ts` + `src/stores/companionStore.ts` +
`src/components/settings/CompanionPanel.vue`。本批整改紧接上一节 P3-A，解决真实运行
测试中暴露的两个 UX 缺陷。

**缺陷一：损坏信号在并发请求下丢失（时序竞态）**

浏览器打开 Companion 管理页或工作区设置页时，`/credentials` 和 `/auth/status` 几乎
同时被调，且 Web 端 `loadCredentials` 可能在 watch / 重试等多处触发——实际不是一次
请求，是连续多次。P3-A 实现的「备份后移走损坏文件」让损坏信号在时间上是**一次性**的：

```
请求 1 → loadStore 发现文件坏 → 备份走 → 抛 CredentialStoreError → route 返 500+corrupt ✅
请求 2 → loadStore 发现文件不存在 → 写空 store → 抛 null → route 返 200 空列表 ❌（信号丢失）
```

`credError` 在 `loadCredentials` 开头被清空，请求 2 返回 200 后红字消失，用户只看到
「凭据未配置，点新增」，根本不知道文件坏了。真实测试中用户反馈「我好像没有看到任何
红字」即源自此问题。

解决方案：**进程级内存事件缓存**（`companion/src/credentials.ts`）。

- `loadStore` 备份后调用 `recordCorruptionEvent(message, backupPath)` 把事件存到
  模块级 `lastCorruptionEvent` 变量。
- `consumeCorruptionEvent()` 返回当前事件（**不清除**）——GET `/credentials` 在 store
  正常加载后调用，若存在未消费事件，仍返 500+corrupt 让每次刷新都能看到。
- `clearCorruptionEvent()` 显式清除——只在 `addCredential` 成功后调用，语义是
  「用户已重新配置 provider，损坏翻篇」。
- 进程重启后事件消失：重启场景下文件已是干净状态（被 P3-A 备份走或被 reset 清掉），
  不需要再提示历史损坏。

为什么事件只在 `addCredential` 而不是 `loadStore` 成功后清除：避免「用户首次损坏
→重启 companion→ 事件丢失 →但备份仍在文件系统」时丢失 UX 引导。`addCredential`
是用户**主动重新配置**的明确信号，更适合作为「翻篇」的触发点。

**缺陷二：损坏态下凭据/日志面板无意义但仍在显示**

P3-A 只加了红字提示，凭据列表（空）和日志面板照常显示。用户在损坏态下看到的画面
信息密度过高：连接状态 + 一行红字 + 空 API 凭据 + 空日志，且「新增凭据」按钮就放在
损坏原因旁边——容易诱导用户在没看红字的情况下点新增，错过「其实有备份可恢复」的
路径。

解决方案：**损坏态下 UI 重构**（`src/components/settings/CompanionPanel.vue`）。

- 损坏时**隐藏** API 凭据面板 + 日志面板（`v-if="companionOnline && !corruptEvent"`）。
- **保留**连接状态面板（companion 确实在线，这个信号是对的）。
- **新增**独立的红色边框「凭据异常」面板，紧跟连接面板下方，包含：
  - ⚠️ 标题 + 损坏原因（含备份路径，从 `/credentials` 的 500+corrupt 响应体透传）
  - 一行引导：「可以尝试从备份恢复，或重置成空配置后重新添加。」
  - 两个横排按钮：**从备份恢复**（次要样式）/ **重置成空配置**（红色边框 + 二次确认）
- 异常面板只在 `companionOnline && corruptEvent` 时渲染，正常状态完全不出现。

**两个恢复端点**（`companion/src/routes/credentials.ts`）：

- `POST /credentials/restore-backup` → `restoreLatestBackup()`：扫描 `CONFIG_DIR`
  下所有 `credentials.json.corrupt-{ts}.json`，按时间戳排序取最近一个，解析 + 严格
  校验通过后覆盖 `credentials.json`，**成功后删除该备份**（避免下次再损坏时恢复到
  已恢复过的旧备份），其他历史备份保留。
- `POST /credentials/reset-empty` → `resetEmptyStore()`：写一个合法的空 store
  （`{entries:[], activeId:null}`）+ 清除事件，语义是「放弃损坏历史，回到首次使用
  状态」。备份文件保留（用户可能后悔，想手动恢复）。

两个端点失败时都走 `handleStoreError` 返 500+corrupt，事件保留，异常面板不消失。

**corrupt 信号从 API 层透传到 composable**：

`listCompanionCredentials` 此前 catch 后只 `throw new Error(message)`，丢失了
`corrupt: true` 标记。改造为用 `Object.assign(new Error(msg), { corrupt: true })`
在 Error 实例上附加 `corrupt` 属性——不破坏现有返回类型（仍是
`Promise<CompanionCredentialsListResponse>`），只在非 ok 时让 Error 带 extra 属性。
`useCompanionManagement.loadCredentials` catch 时读 `error.corrupt` 决定 set
`corruptEvent`（异常面板）还是 `credError`（普通加载错误）。

**恢复失败时原地反馈，不跳走**：

`resetCredentialStore` / `restoreCredentialBackup` 失败时不 throw 到外面，而是把
错误信息覆盖到 `corruptEvent.value.message`——保持 `corruptEvent` 非空，用户继续看到
异常面板，但 message 变成「恢复失败：备份文件 X 仍无法解析，可改用重置成空配置」。
这样用户能在**原地**继续尝试另一个按钮，不需要刷新或重新触发损坏。

**端到端手动验证（真实 companion + 浏览器）**：

| 场景 | 实际行为 | 是否符合预期 |
| --- | --- | --- |
| 正常状态 | 凭据面板 + 日志面板正常显示，无异常面板 | ✅ |
| 损坏后刷新 | 凭据/日志面板消失，红色异常面板出现 + 两个按钮 | ✅ |
| 「从备份恢复」对坏备份 | 失败 + 原地提示「仍无法解析…可改用重置成空配置」 | ✅ |
| 「重置成空配置」 | 弹二次确认 → 确认 → 异常面板消失，列表变空 | ✅ |
| 新增凭据后 | 异常面板消失，凭据列表显示新增项 | ✅ |

剩余取舍：

- **多备份选择不做**：默认恢复最近一个。多备份场景下用户想找更早的备份，可直接进
  `~/.gpt-image-studio/` 目录手动操作。
- **备份列表查看 UI 不做**：同上，目录可直接看。
- **不持久化 corruptEvent 到 localStorage**：刷新页面时通过重新 GET `/credentials`
  拿 companion 的内存事件即可——companion 进程不重启的话事件还在。这样也避免了
  「Web 端缓存了事件但 companion 已重启 / 文件已被外部修复」时的状态不一致。

## 剩余主要问题

### P1：Grok 和 Gemini 分辨率字段契约错位

Web 在生成和编辑请求中发送 `companion_resolution`。

生成路由将未知字段放入 `request.extra`，因此 Adapter 收到的是：

```ts
request.extra.companion_resolution
```

Grok 和 Gemini Adapter 实际读取：

```ts
request.extra.resolution
```

编辑路由则把未知 multipart 字段放入 `editExtra`，同时将 `extra` 固定为空对象。因此：

- Grok 和 Gemini 文生图看不到 UI 选择的分辨率。
- Grok 和 Gemini 图片编辑同样看不到分辨率。
- Adapter 单测直接构造 `extra.resolution`，没有覆盖真实 Web 到 Adapter 的契约。

建议：

- 将 `resolution` 提升为 `OpenAIImageRequest` 的显式标准字段。
- 路由兼容读取旧的 `companion_resolution`。
- 生成和编辑统一使用同一个内部字段。
- 增加 Web 形状请求经过 route 后的集成测试。

#### 已完成整改：统一 resolution 字段契约

状态：已于 2026-07-18 修复，实现在 `companion/src/providers/types.ts`、
`companion/src/routes/images.ts`，提交 `62e2344`。

**核心改动**：

- `OpenAIImageRequest` 新增显式 `resolution?: string` 字段（此前只在 `extra` 里逃逸）。
- 路由层 `toGenerateRequest` / `toEditRequest` 从请求体 `companion_resolution` 和
  multipart `fields.companion_resolution` 统一提取到 `request.resolution`——
  **生成和编辑走同一个内部字段**，不再有 generate/edit 两条路径的分裂。
- 路由层兼容历史字段名 `companion_resolution`（Web 侧 `buildParams` 仍然发的是这个名字，
  companion 侧负责翻译，避免要求 Web 同步改）。
- Grok 和 Gemini Adapter 从读 `request.extra.resolution` 改为读 `request.resolution`，
  拿到 UI 选择的分辨率。

**新增端到端契约测试**：`companion/src/routes/images.integration.test.ts` 覆盖 Grok /
Gemini 从 Web 真实请求形状（JSON / multipart）→ route 提取 → Adapter 收到
`request.resolution` 的完整链路，用非默认分辨率值断言，route 漏提取字段时测试失败。

这一节是后续「已知字段契约收敛」（下一节）的铺垫——本次只是把 `resolution` 从逃逸口袋
里捞出来，而下一节把「Web ↔ Companion 字段漂移」作为系统性风险彻底解决。

### P1：输出格式能力与真实图片类型没有闭环

部分 Adapter 声明支持 PNG、JPEG 或 WebP，但没有把 `request.outputFormat` 翻译为对应的
厂商参数。`response_format=b64_json` 只决定响应传输方式，不等于图片文件格式。

统一结果 `OpenAIImageResult` 只有 base64，没有真实 MIME。Web 随后根据用户选择的
`outputFormat` 创建 Blob 和 `ImageAsset.mimeType`。如果厂商返回的真实字节格式不同，
图片会被错误标记，导出扩展名和备份元数据也可能错误。

建议：

- 为 `OpenAIImageResult` 增加 `mimeType`。
- 优先从厂商响应或 data URL 读取 MIME。
- URL 下载路径同时校验响应头和文件 magic bytes。
- 对只支持固定格式的 Provider，只向 Web 声明真实可控的格式。
- Web 保存时使用结果 MIME，而不是直接信任请求参数。

#### 已完成整改：MIME 闭环（结果携带真实图片类型）

状态：已于 2026-07-18 修复，实现在 `companion/src/providers/imageSignature.ts`、
各 Adapter、Web 侧 `localCompanionImagesClient.ts`，提交 `62e2344`。

**核心改动**：

- 新增 `companion/src/providers/imageSignature.ts`：magic bytes 嗅探工具，识别
  PNG / JPEG / WebP / GIF 的文件头签名（此前 Provider 下载链路里曾探测过真实类型，
  但探测完就丢弃，导致这个能力隐形）。
- `OpenAIImageResult` 新增 `mimeType: string` 字段，作为统一结果的强制字段。
- 各 Adapter 按"可信度从高到低"的优先级填 `mimeType`：
  1. **厂商直接提供**：Gemini 从 `inlineData.mimeType` 读取（此前主动丢弃）。
  2. **base64 字节嗅探**：OpenAI / 豆包 / Grok 在 base64 解码后用 `imageSignature`
     嗅探真实类型（厂商返回的 `response_format=b64_json` 只决定传输方式，不等于真实
     图片格式）。
  3. **URL 下载**：GLM / Qwen / Wan 的 `urlToB64` 在下载后嗅探字节、校验响应头，
     把真实 MIME 一路透传回来（此前探测后丢弃）。
- Web 侧 `localCompanionImagesClient.ts` 优先用结果 `mimeType` 创建 Blob 和
  `ImageAsset.mimeType`，回退到请求参数 `outputFormat`（兼容 browser direct 模式
  拿不到结果 MIME 的情况）。

**价值**：

- 消除「用户选 PNG，厂商返回 JPEG 字节，文件被错误标记成 .png」的元数据偏移。
- 导出 ZIP 和备份的扩展名现在与真实字节一致。
- URL 下载路径同时用响应头 + magic bytes 双校验，能拦截伪装成图片的 HTML / 其他
  二进制（也是 SSRF 防御的一部分）。

**测试覆盖**：新增 `imageSignature.test.ts`（覆盖 4 种图片签名 + 边界情况）；
扩展 `localCompanionImagesClient` 测试（此前零覆盖）；Gemini / GLM / Grok / Qwen /
OpenAI / 豆包 adapter 测试同步断言 `mimeType` 字段。

### P1：multipart 校验与解析口径不一致

图片路由先把整个 multipart 二进制 body 转为 latin1，再用正则统计 `image` part 和检查
MIME；随后 `parseMultipart` 重新解析，并把任何带 `filename`、且名称不是 `mask` 的 part
都加入图片数组。

结果是：

- 任意名称的文件 part 可能绕过前置数量和 MIME 校验，却被解析为引用图。
- 图片二进制中偶然出现类似 header 的文本时可能产生误判。
- 校验结果和 Adapter 实际收到的数据不一定一致。

建议先结构化解析，再基于解析结果执行一次校验：

- 只允许 `image`、`image[]` 和 `mask` 文件字段。
- 拒绝未知文件字段。
- 校验图片数量、空文件、单文件大小、总大小和 MIME。
- mask 必须唯一且为 PNG。

#### 已完成整改：结构化解析后再校验 multipart

状态：已于 2026-07-18 修复，实现在 `companion/src/providers/multipart.ts`、
`companion/src/routes/images.ts`，提交 `37e1c09`。

**核心问题**：此前 multipart 处理分两步，校验对象和 Adapter 收到的对象不是同一个：

1. `validateEditMultipart` 先把整个二进制 body 转 latin1 字符串，用正则
   `name="image(?:\[\])?"` 统计图片 part 数量、检查 MIME；
2. 随后 `parseMultipart` 重新解析，把**任何带 filename 且名称不是 mask** 的 part
   都加入图片数组。

后果：任意名称的文件 part（如 `name="foo"`）会绕过前置的图片数量和 MIME 校验，
却被解析为引用图；图片二进制中偶然出现类似 header 的文本也会让 latin1 正则产生
误判。**校验口径 ≠ 实际收到的数据**。

**修复方案**：先结构化解析，再对解析结果执行**一次**校验。

- 编辑路由调整执行顺序：`parseMultipart` 先把二进制拆成 `ParsedEditBody`
  （`images[]` + `mask?` + `fields{}`），解析阶段就拒绝未知文件字段——
  `name !== "image" && name !== "image[]" && name !== "mask"` 直接返
  `{ message: "不支持的文件字段：${name}" }`。
- `validateEditMultipart` 的签名从 `(body: Buffer, security)` 改为
  `(parsed: ParsedEditBody, security)`，校验对象就是 Adapter 即将收到的对象，
  不可能再出现"校验过但 Adapter 收到的不一样"。
- 新增校验项（此前 latin1 正则覆盖不到）：
  - **空文件检测**：`file.blob.length === 0` → 返「图片 part 不能为空」。
  - **mask 唯一性**：`parseMultipart` 解析阶段检测第二个 mask 直接报错
    （「mask 只能有一个」）。
  - **缺失 Content-Type**：保留为空字符串交给统一校验，返明确错误
    （此前 fallback 到 `application/octet-stream`，会绕过 MIME 白名单）。
- 解析阶段同时做 header `Content-Type` 清洗（`split(";", 1)[0]` 去掉 charset
  参数），保证 `validateEditMultipart` 看到的 MIME 与白名单比较时格式一致。

**价值**：

- 校验对象和 Adapter 收到的数据**严格一致**，不再有"校验过但被绕过"的窗口。
- mask 必须唯一 + 必须 PNG 的能力契约在解析阶段就拦截，不会到 Adapter 才报错。
- 未知文件字段被拒绝，防止恶意构造的 part 名绕过数量限制。

**测试覆盖**：扩展 `companion/src/routes/images.test.ts`（57 个测试增量），
覆盖未知文件字段、空文件、重复 mask、缺失 Content-Type、数量上限等场景。

### P1：能力字段在 Web 与 Companion 之间缺少契约约束

Web 发出的"已知字段"要正确到达 Adapter，依赖两份需要手工同步的字段清单：

- Web 侧 `localCompanionImagesClient.ts` 的 `buildParams` 固定发出
  `size` / `companion_resolution` / `background` / `output_format`。
- Companion 侧 `routes/images.ts` 的 `KNOWN_GENERATE_FIELDS` 和 `KNOWN_EDIT_FIELDS`
  白名单必须包含这些字段名，否则字段会落入 `request.extra` / `editExtra`，
  而 Adapter 又去读 `request.<knownField>` —— 字段名对不上时该能力静默失效。

这两处没有任何类型、常量或测试约束它们一致。`resolution` 字段契约错位
（上一节）就是这两份清单 historically 没对齐导致的直接后果。这不是单一 bug，
而是系统性风险：后续任何新增的能力字段（如 `style` / `seed` / `negative_prompt`）
都会面临「Web 加字段 → Companion 加白名单 → Adapter 读取」三处手工同步的问题，
任一环节遗漏都会表现为能力静默失效，且无测试能在 CI 阶段拦截。

这在后续大批量新增 Provider 时会反复踩坑：每接入一个暴露新能力维度的 Provider，
都要同时改动三处无关联的代码，且漏改不会报错。

建议：

- 用一份共享常量定义 Web 与 Companion 之间的标准字段名集合
  （例如 `companion/shared/knownFields.ts`，或 Companion 导出后 Web 引用）。
- `KNOWN_GENERATE_FIELDS` / `KNOWN_EDIT_FIELDS` 与 `OpenAIImageRequest` 的已知字段
  从同一份常量派生，避免两份手写清单。
- 增加「Web 真实请求形状 → Adapter 收到的结构化请求」的端到端契约测试，
  覆盖每个已知字段，确保任一环节漏改在 CI 失败。
- 长期方向：把 `extra` / `editExtra` 之外的已知字段都建模为 `OpenAIImageRequest`
  上的显式类型化字段（如本次的 `resolution`），`extra` 只保留真正透传型字段
  （`quality` / `stream` 等），减少"逃逸口袋"。

#### 已完成整改：已知字段契约收敛（软共享 + 端到端契约测试）

状态：已于 2026-07-20 修复。实现在：

- `companion/src/shared/knownFields.ts`（Companion 侧单一源）
- `src/types/companion.ts` 的 `COMPANION_GENERATE_FIELDS` / `COMPANION_EDIT_FIELDS`（Web 侧镜像）
- `src/types/companionKnownFields.contract.test.ts`（两端对齐契约测试）
- `companion/src/routes/images.integration.test.ts`（覆盖每个已知字段的端到端契约）

**方案选择：软共享（镜像常量 + 契约测试），不引入 Web 对 companion 包的构建依赖。**

理由：Companion 走 tsc + NodeNext，Web 走 Vite，让 Web 直接 import companion 包会引入
跨构建系统的依赖耦合，为一个字符串常量数组付出这个工程代价不划算。软共享保留两份
清单，但通过契约测试把「无声漂移」转化为「CI 报错」——这正是本节原本痛点
（"无测试能在 CI 阶段拦截"）的直接修复。

三处手工同步现在的 CI 保护：

1. **Web 加字段** — `buildParams` 用 `satisfies Partial<Record<CompanionGenerateField, string>>`
   做编译期约束，硬编码字段名不在白名单里会编译失败。
2. **Companion 加白名单** — `companionKnownFields.contract.test.ts` 读 companion 源文件，
   断言 Web 镜像常量与 Companion `KNOWN_*` 字段集合完全一致；任一端漏改，CI 失败。
3. **route 提取字段 → adapter 读取** — `images.integration.test.ts` 的 `it.each` 覆盖
   每个已知字段，从 Web 真实请求形状（JSON / multipart）经 route 到 OpenAI adapter
   上游请求的完整链路；用非默认值断言，route 漏提取字段时测试失败。

取舍与剩余风险：

- 契约测试用正则提取 companion 源文件里的 `as const` 数组，格式变更（改成对象键、
  移除 `as const` 等）需要同步更新测试正则。这是软共享的固有代价，也是「两端同步」
  承诺的一部分。
- 本节"长期方向"（把所有已知字段建模为 `OpenAIImageRequest` 的显式类型化字段，
  `extra` 只保留真正透传型字段）仍未落地。当前 `quality` / `stream` 等仍走 extra
  透传，是合理的设计——它们不需要 adapter 翻译。只有当未来某字段需要 route 提取
  但又不想加进白名单时，才需要推进这个长期方向。

### P2：上游主请求没有超时和取消传播

各 Adapter 的主 `fetch` 没有传入 `AbortSignal`。上游长时间不返回时，Companion 请求会
持续占用连接；Web 用户取消请求或离开页面，也不会终止上游生成。

建议封装统一的 `providerFetch`：

- 生成和编辑使用明确超时。
- 将客户端断开传播到 Adapter。
- 区分超时、DNS、TLS、连接重置和 HTTP 上游错误。
- 只在有明确审核错误码时提示内容审核，不把所有网络错误都归因于提示词。

#### 已完成整改：取消传播与错误分类

状态：已于 2026-07-20 修复。详见上文「已完成整改 → Provider 取消传播与错误分类」。

- **取消传播**已实现：route 层 `withClientSignal` 监听 Fastify `req.raw.close`，
  构造 AbortController，signal 一路透传到 provider fetch 和 URL 下载器；
  `headersSent` 检查避免误触发；finally 解绑 listener 防 EventEmitter 泄漏。
- **主请求超时按决策不实现**：生图任务（尤其 gpt-image-2）正常可能耗时 5+ 分钟，
  设硬超时会误杀长任务；用户刷新浏览器即可触发取消传播，是更自然的取消入口。
  `timeout` category 仍保留在分类表里，未来加超时机制不用改响应 shape。
- **错误分类**已实现：新增 `providerErrors.ts`，按 errno / DOMException / HTTP 状态
  分成 12 个 category；删除误导文案 `UPSTREAM_DISCONNECT_MESSAGE`；route 502 响应
  体扩展为 `{ error, category? }` 向后兼容。

### P2：未知 Provider 静默回退 OpenAI

Registry 对缺少 Provider 字段和未知 Provider ID 都回退到 OpenAI Adapter。兼容历史凭据
缺少字段是合理的，但拼写错误或已删除的 Provider 也会被当作 OpenAI 请求发送。

建议：

- 仅在 Provider 字段缺失时回退 OpenAI。
- 保存凭据时校验 Provider ID 必须已注册。
- 运行时遇到明确但未知的 ID 时返回配置错误。

#### 已完成整改：未知 Provider 显式报错

状态：已于 2026-07-22 修复，实现在 `companion/src/providers/registry.ts`、
`companion/src/routes/credentials.ts`、`companion/src/routes/images.ts`、
`companion/src/routes/auth.ts`。

**核心改动**：

- `resolveAdapter` 签名从 `ProviderAdapter` 改为 `ProviderAdapter | null`：
  - 已知 id → 返对应 adapter（不变）。
  - 未知 id（拼写错 / 已删除 / 还没实现）→ 返 **null**，由调用方决定如何报错。
  - 字段缺失（`config.provider === undefined`）→ 仍回退 openai（兼容老 `credentials.json`，
    符合本节建议）。注意 `validateStore` 已强制 entry.provider 非空，此分支实际是防御性兜底。
- 删除原 `console.warn + REGISTRY[DEFAULT_PROVIDER_ID]` 静默回退——那会让 `/auth/status`
  上报错的 capability（误导 UI），images route 用错的请求形状发到用户的 apiBaseUrl。
- 新增 `isRegisteredProvider(id)` 辅助函数，供 credentials 写入校验复用（语义比
  `listProviderIds().includes` 更清晰）。
- **写入端校验**：`validateInput` 新增检查——明确传了 provider 但不在注册表里 → 返
  400 + 错误信息含已注册列表。`provider` 字段缺失（undefined）不校验，走 addCredential
  内部的"缺失 → openai"默认分支。
- **运行时拦截**：images generate/edit route 检测到 null adapter 时返 **503 + 明确错误**
  （"凭据配置的 provider X 未注册，请检查或重新配置。已注册的有：a, b, c"），
  **不再发请求到上游**——避免用错的请求形状打到用户的 apiBaseUrl 造成难懂的上游错误。
- **`/auth/status` 降级**：检测到 null adapter 时返 **200 + ready:false**（和"无凭据"
  分支形状一致），让 Web UI 走"未就绪"渲染。不在 `/auth/status` 加 error 字段——这是
  连接健康检查端点，Web 等它决定连接是否在线，加 error 字段会要求 Web 新增展示通道，
  且会绕过已建好的 `/credentials` + `corruptEvent` 异常展示体系。真正的"配置错误"提示
  由 images route 在用户真发起请求时返 503 给出。

**取舍**：

- **不引入 `ProviderId` 联合类型**：`provider` 字段保持 `string`，由 `isRegisteredProvider`
  在运行时校验。理由：避免跨包类型耦合（companion 走 tsc+NodeNext，Web 走 Vite），和
  「已知字段契约收敛」选择软共享的理由一致。
- **不改 CLI `promptCredentialInput`**：CLI 已经用 `PROVIDER_PRESETS` 数字选项约束，
  无法产生未知 id，不需要改。
- **不动 `toProviderConfig` 的 `creds.provider ?? "openai"` 防御性兜底**：保留作为
  防御性死代码（测试 `images.integration.test.ts` 仍依赖它）。真正拦截点在 resolveAdapter。

**测试覆盖**：

- 新增 `companion/src/providers/tests/registry.test.ts`（10 个测试）：覆盖已知 id 返
  adapter、未知 id 返 null、`undefined` 走默认、`isRegisteredProvider` 正反例、
  遍历 `listProviderIds()` 确认每个注册 id 都能解析（防未来加 provider 时遗漏注册）。
- 扩展 `credentials.integration.test.ts`（10 → 13 个测试）：新增 POST 未知 provider 返
  400 + 已注册列表、POST 不传 provider 走默认 openai、PUT 改成未知 provider 返 400。
- 扩展 `images.integration.test.ts`（34 → 36 个测试）：新增 generate / edit 两条路径
  在未知 provider 下返 503、fetch 不被调用（验证上游请求不发出去）。

### P2：能力协议没有表达参考图限制

当前通用能力只表示是否支持编辑，没有表示：

- 最大参考图数量
- 最大单图和总字节数
- 是否只使用第一张图
- 文生图和编辑是否具有不同分辨率能力
- 能力是否依赖具体模型

Qwen 和 Wan 只能在 Adapter 内部延迟报错；豆包当前直接使用第一张参考图，会静默忽略
其余输入。Web 无法在用户发起请求前给出正确限制。

建议增加类似字段：

```ts
type ProviderCapability = {
  generate: true;
  edit: boolean;
  mask: boolean;
  maxReferenceImages: number;
  maxReferenceBytes?: number;
};
```

模型相关能力继续使用动态方法返回，不要对同一 Provider 的所有模型声明同一组档位。

> 取舍记录（2026-07-18）：不在 Companion 的全局 `securityConfig` 中设置统一的单图或
> 总参考图字节上限。不同 Provider/模型的图片大小限制可能不同，当前 Web 侧的 20 MiB
> 引用图限制也是 GPT-image-2 的既有规则，不能直接推广到所有模型。后续应把
> `maxReferenceBytes` / `maxTotalReferenceBytes` 作为 Provider/模型能力的一部分，随
> `ProviderEditConstraints` 和 `/auth/status` 回流；在此之前 Companion 只保留整体请求体
> 的通用安全上限，不把 32 MiB/48 MiB 当作 Provider 能力。

### P3：凭据文件损坏被静默视为空配置

~~`loadStore` 在 JSON 解析失败或结构不合法时直接返回空 Store。用户看到的现象会像是所有
Provider 配置突然消失，且缺少可诊断日志。~~

~~建议保留损坏文件，记录脱敏错误，并向 CLI/Web 返回“凭据文件无法读取”的明确状态，
不要自动把数据损坏表现为首次使用。~~

已完成（2026-07-21），详见上文「已完成整改：凭据文件损坏不再静默视为空配置」。

### P3：公共设施存在维护漂移

- `taskPoller` 当前没有 Provider 使用，注释仍描述 Wan 等异步流程。
- 多个 Adapter 的 `DEFAULT_*_BASE_URL` 常量没有实际参与 URL 构造。
- `describe()` 当前价值有限。
- DashScope 错误解析先返回 `message`，导致 `code: message` 组合分支不可达。

这些问题不会立即造成严重故障，但会增加后续维护者判断真实协议的成本。

## 建议整改顺序

### 第一批：修复真实请求契约

1. ~~统一 `resolution` 字段。~~ 已完成。
2. ~~为 Grok/Gemini 增加 route 级集成测试。~~ 已完成。
3. ~~让结果携带真实 MIME，并修正能力声明。~~ 已完成。
4. ~~结构化 multipart 后再校验。~~ 已完成。
5. ~~收敛 Web 与 Companion 之间的已知字段定义（共享常量 + 端到端契约测试），
   消除两份手写字段清单的漂移风险。~~ 已完成（2026-07-20，软共享方案，
   详见上文「已完成整改：已知字段契约收敛」）。

### 第二批：收紧 Companion 出站网络

1. ~~实现受限 URL 下载器。~~ 已完成。
2. ~~增加响应大小和类型限制。~~ 已完成。
3. ~~增加统一 Provider 主请求超时和取消传播。~~ 已完成（2026-07-20，取消传播部分；
   主请求超时按决策不实现，详见上文「已完成整改：Provider 取消传播与错误分类」）。
4. ~~改进 Provider 主请求的网络错误分类。~~ 已完成（2026-07-20）。

### 第三批：完善能力协议

1. 增加最大参考图数量和大小。
2. 将 Gemini 等 Provider 改为模型动态能力。
3. ~~未知 Provider 改为显式配置错误。~~ 已完成（2026-07-22，详见上文「已完成整改：未知 Provider 显式报错」）。
4. 补充各 Provider 的端到端契约测试。

其中“参考图大小”应按 Provider/模型分别配置，不能用一个全局字节数覆盖所有模型。

## 测试基线

2026-07-16 审查时：

- `pnpm typecheck:companion` 通过。
- `pnpm test` 通过，共 35 个测试文件、319 个测试。
- `pnpm typecheck` 因本机依赖目录缺少 `qrcode` 模块而失败，不是 Companion 类型错误。

现有测试对 Adapter 内部翻译覆盖较多，但跨越 Web 参数、HTTP route 和 Adapter 的端到端
契约测试不足。后续测试重点应从“手工构造 Adapter 理想输入”转向“使用 Web 实际请求形状”。

2026-07-20 已知字段契约收敛后：

- `pnpm typecheck:companion` 通过。
- `pnpm test` 通过，共 41 个测试文件、432 个测试。
- `pnpm typecheck` 仍有 5 个 `SizeRatio` 预存在错误（与本次整改无关）。
- 新增 `companionKnownFields.contract.test.ts`（3 个测试）兜底 Web↔Companion 常量漂移。
- `images.integration.test.ts` 从 13 个测试扩展到 25 个，覆盖每个已知字段的
  generate / edit 两条路径。

2026-07-20 Provider 取消传播与错误分类后：

- `pnpm typecheck:companion` 通过。
- `pnpm typecheck` 通过（已修复此前预存在的 5 个 `SizeRatio` 测试错误）。
- `pnpm test` 通过，共 42 个测试文件、496 个测试。
- 新增 `providerErrors.test.ts`（47 个测试）：覆盖 errno / DOMException name /
  TLS code / Node fetch 包装 cause / HTTP 状态码的全部分类路径。
- 扩展 `images.test.ts`（9 → 17 个测试）：新增 `withClientSignal` 的 4 个场景
  （断开触发 abort、正常完成不误触发、headersSent 后不触发、listener 不泄漏）
  与 `errorPayload` 的 4 个 shape 断言。
- 扩展 `images.integration.test.ts`（25 → 34 个测试）：新增端到端分类集成测试，
  覆盖 ENOTFOUND / ECONNREFUSED / AbortError / 400 / 401 / 429 / 500 / 503 等
  场景的 category 字段断言。
- 9 处 adapter 测试断言从硬编码文案改为 `category` 字段断言，避免文案微调再连锁改测试。

2026-07-21 凭据文件损坏处理（P3-A）后：

- `pnpm typecheck:companion` 通过。
- `pnpm typecheck` 通过。
- `pnpm test` 通过，共 43 个测试文件、510 个测试。
- 扩展 `credentials.test.ts`（13 → 21 个测试）：新增「corruption handling」
  describe block，覆盖 JSON 不可解析、结构不合法、entry 缺字段/空串、孤儿 activeId
  回退、addCredential 不覆盖备份、两个 code 值（`CRED_PARSE_FAILED` /
  `CRED_INVALID_STRUCTURE`）。
- 新增 `credentials.integration.test.ts`（5 个测试）：`/credentials` 返 500+corrupt、
  `/auth/status` 损坏时优雅降级返 200+ready:false、健康文件正常。
- 端到端手动验证（真实 companion + curl）：损坏文件被备份、POST /credentials 不覆盖
  损坏文件、CLI provider list/status 显示可读错误、恢复后新配置正常生效、备份保留。

2026-07-22 凭据损坏：内存事件缓存 + 异常面板 + 恢复端点后：

- `pnpm typecheck:companion` 通过。
- `pnpm typecheck` 通过。
- `pnpm test` 通过，共 43 个测试文件、527 个测试。
- 扩展 `credentials.test.ts`（21 → 33 个测试）：新增「event cache persistence」
  （事件在多次 consume 间保留、addCredential 后清除、模块重载后消失）和
  「recovery actions」（resetEmptyStore 写空 store 清事件、restoreLatestBackup
  成功恢复最近备份并删除该备份、无备份时抛错、备份也损坏时抛错且原状不变）。
- 扩展 `credentials.integration.test.ts`（5 → 10 个测试）：新增 `/credentials`
  重复请求持续返 500+corrupt（验证事件缓存）、`addCredential` 后 corrupt 信号消失、
  POST `/credentials/reset-empty` 成功后 GET 返 200 空列表、
  POST `/credentials/restore-backup` 成功后 GET 返恢复的列表、恢复失败时事件保留。
- 端到端手动验证（真实 companion + 浏览器）：损坏后凭据/日志面板消失 + 红色异常面板
  出现 + 两个按钮可见；「从备份恢复」对坏备份失败时原地提示；「重置成空配置」
  弹二次确认后成功清空；新增凭据后异常面板消失。

2026-07-22 未知 Provider 显式报错后：

- `pnpm typecheck:companion` 通过。
- `pnpm typecheck` 通过。
- `pnpm test` 通过，共 44 个测试文件、542 个测试。
- 新增 `companion/src/providers/tests/registry.test.ts`（10 个测试）：覆盖已知 id
  返 adapter、未知 id 返 null、`undefined` 走默认、`isRegisteredProvider` 正反例、
  遍历 `listProviderIds()` 确认每个注册 id 都能解析。
- 扩展 `credentials.integration.test.ts`（10 → 13 个测试）：新增 POST 未知 provider
  返 400、POST 不传 provider 走默认、PUT 改成未知 provider 返 400。
- 扩展 `images.integration.test.ts`（34 → 36 个测试）：新增 generate / edit 两条路径
  在未知 provider 下返 503、fetch 不被调用。
