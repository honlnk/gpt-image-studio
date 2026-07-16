# 本地 CLI Companion 方案

更新日期：2026-07-16

> 当前实现已经使用持久化连接密钥替代早期的一次性配对码和短期 session token。
> 受信 Origin 可以管理并读取普通 Provider API Key。本文后半部分保留部分历史分阶段
> 记录；当前安全决策以 [ADR 002](decisions/002-companion-security-boundary.md) 为准。

## 背景

GPT Image Studio 当前是一个本地优先 Web App。用户在网页中配置 OpenAI 兼容图片接口的 Base URL 和 API key，浏览器直接调用中转站或兼容接口，生成记录、图片 Blob、设置和备份都保存在当前浏览器本地。

这个方向继续保留。它是当前项目最快、最轻、成本最低的使用方式：

- 用户不需要安装额外程序。
- 项目不需要自建后端。
- 用户数据不经过 GPT Image Studio 的服务器。
- 对已经有中转站或兼容 Images API 的用户来说，上手路径最短。

这个模式的边界也很清楚：

- API key 保存在浏览器本地 IndexedDB，适合个人设备，不适合公共设备。
- 浏览器直连官网或部分接口会遇到 CORS。
- 用户需要信任自己配置的中转站，因为中转站会看到 prompt、引用图和生成结果。
- 它不适合直接承载 ChatGPT/Codex 账号登录、OAuth refresh token、系统 keychain 等更敏感能力。

因此，后续更复杂的账号能力不替换当前模式，而是作为“本地助手模式”新增。

## 产品决策

保留两种连接方式：

```text
基础模式：网页直连用户配置的 Base URL + API key
高级模式：网页连接本地 CLI companion
```

基础模式继续作为默认入口。它对应当前项目已有能力。

本地助手模式用于后续扩展：

- 用户安装本地 CLI companion。
- CLI 在本机保存 API key、OAuth token 或其它 provider 凭据。
- Vue 网页只和 `127.0.0.1` 上的本地服务通信。
- 受信 Origin 可以读取和管理普通 Provider API Key，但普通项目备份不导出 Companion
  凭据或连接密钥。

## 推荐仓库结构

第一阶段不需要新建独立仓库。建议先放在当前仓库中，避免前端和本地协议频繁跨仓同步。

短期结构：

```text
gpt-image-studio/
  src/
  companion/
  docs/
```

中长期如果项目继续变大，可以迁移为 monorepo：

```text
gpt-image-studio/
  apps/
    web/
    companion/
```

拆独立仓库的条件：

- companion 要被多个产品复用。
- companion 和 Web App 发布节奏明显不同。
- 需要开源一个部分、闭源另一个部分。
- 有独立维护者或独立安全发布流程。

## 架构草案

### 基础模式

```text
Vue Web App
  -> 用户配置的 API Base URL
  -> OpenAI 兼容 Images API
```

当前 `src/services/imagesApi.ts` 已经集中封装了图片生成和编辑请求。后续可以先把它抽象成 provider/client 层，但不需要改变当前用户体验。

### 本地助手模式

```text
Vue Web App
  -> http://127.0.0.1:<port>
  -> 本地 CLI companion
  -> OpenAI / Codex / 其它 provider
```

本地 CLI 负责：

- 登录。
- 凭据保存。
- token 刷新。
- 模型请求代理。
- 连接密钥和 Origin 权限校验。
- 日志脱敏。

Vue 负责：

- 检测本地助手是否运行。
- 使用连接密钥建立连接。
- 管理 Provider 凭据。
- 调用本地助手的图片生成和编辑接口。
- 展示结果并继续使用当前 IndexedDB 数据模型。

## 协议 MVP

当前图片协议继续保持 OpenAI Images API 兼容形状，不急着做 ChatGPT/Codex OAuth。

当前主要接口：

```text
GET  /health
GET  /auth/status
GET  /credentials/presets
GET  /credentials
POST /credentials
PUT  /credentials/:id
DELETE /credentials/:id
POST /credentials/:id/activate
POST /images/generations
POST /images/edits
GET  /logs/tail
```

### `/health`

用于网页检测本地助手是否安装并正在运行。

返回示例：

```json
{
  "app": "gpt-image-studio-companion",
  "version": "<companion package version>",
  "paired": true,
  "runMode": "serve"
}
```

### 连接密钥

Companion 启动时加载或生成持久化连接密钥。用户将连接密钥粘贴到 Web 设置中，Web
使用 `Authorization: Bearer <key>` 调用状态、图片代理和日志接口。

Provider 凭据管理接口采用受信 Origin 模型，不要求连接密钥。正式站点和显式允许的
开发 Origin 可以管理凭据；任意第三方网页不能通过 CORS 和 Origin 校验。

### `/auth/status`

返回本地助手是否已经配置凭据。

返回示例：

```json
{
  "provider": "openai",
  "mode": "api_key",
  "ready": true,
  "accountLabel": "local API key"
}
```

`/auth/status` 不返回真实 API Key，只返回当前 Provider、模型和能力信息。普通 Provider
API Key 由独立的 `/credentials` 接口向受信 Origin 提供。

### `/images/generations`

尽量保持 OpenAI Images API 兼容形状，便于前端少改。

请求包含：

- `model`
- `prompt`
- `size`
- `background`
- `output_format`

返回继续使用 `data[0].b64_json`，这样当前图片保存逻辑可以复用。

### `/images/edits`

继续支持 `FormData`：

- `model`
- `prompt`
- `image[]`
- `size`
- `background`
- `output_format`

第一版保持最多 16 张引用图的限制。

## 安全要求

本地助手不能只是一个裸露的 localhost 代理。最低要求：

- 校验 `Origin`，正式版默认只允许 `https://image.honlnk.com`。
- 开发版可以额外允许本地开发 origin，例如 `http://localhost:<port>`、`http://127.0.0.1:<port>`。
- 状态、图片代理和日志接口必须携带连接密钥。
- 凭据管理接口只允许本机调用方、loopback Origin 和白名单中的受信 Origin。
- 受信 Origin 可以读取和管理普通 Provider API Key。
- OAuth access token 和 refresh token 在正式接入前需要单独评估，不自动沿用普通 API Key 的决定。
- 日志不记录 Authorization、完整 prompt、图片 base64 或上传图片内容。
- 限制上传图片数量、大小和 MIME 类型。
- 下载 Provider 返回的图片 URL 时只允许 HTTPS，拒绝 URL 凭据、loopback、私网、
  link-local、云元数据、组播和保留地址。
- DNS 校验结果直接用于 HTTPS socket 建连；DNS 同时返回公网和非公网地址时整体拒绝，
  防止 DNS rebinding 或地址选择绕过。
- 手动处理图片 URL 重定向，每一跳重新校验，最多 3 次。
- 只接受 `image/png`、`image/jpeg` 和 `image/webp`，并校验文件 magic bytes 与
  `Content-Type` 一致。
- 图片响应流式读取，单张默认最大 32 MiB；超过声明或实际字节上限时立即中止。
- 只重试瞬时网络错误、HTTP 408、429 和 5xx，不重试安全策略、证书和普通 4xx 错误。
- 默认只监听 `127.0.0.1`，不要监听 `0.0.0.0`。
- CORS 只允许白名单 origin，不能使用 `Access-Control-Allow-Origin: *`。

后续如果支持文件系统、shell、浏览器自动化等更高权限工具，需要单独做权限模型，不能混在图片代理 MVP 里。

### Origin 白名单策略

本地助手需要区分开发版和正式版，避免用户从正式安装渠道下载的 companion 被任意本地开发页面或恶意网页调用。

建议策略：

```text
正式版默认白名单：
  https://image.honlnk.com

开发版默认白名单：
  https://image.honlnk.com
  http://localhost:<dev-port>
  http://127.0.0.1:<dev-port>
```

实现上可以通过构建渠道或环境变量控制：

```text
GPT_IMAGE_STUDIO_COMPANION_CHANNEL=stable
GPT_IMAGE_STUDIO_COMPANION_CHANNEL=dev
```

`stable` 渠道：

- 默认只允许正式站点 `https://image.honlnk.com`。
- 不自动允许任意 localhost 网页。
- 如确实需要临时调试，应要求用户显式启动调试模式，而不是默认开放。

`dev` 渠道：

- 允许正式站点和本地开发 origin。
- 可以通过命令行参数指定额外 origin，例如 `--allow-origin http://localhost:5173`。
- 启动时打印当前允许的 origin，方便开发排查。

额外 origin 配置必须保守：

- 不支持通配 `*`。
- 不支持裸域名模糊匹配。
- 不建议支持任意 `http://*.local`。
- 如果提供 `--allow-origin`，应只接受完整 origin，例如 `http://localhost:5173`。

## 凭据策略

当前策略：

- Companion 支持多条 Provider 配置和激活切换。
- CLI 和受信 Web Origin 都可以管理 Provider 配置。
- Provider API Key 保存在 Companion 本地配置文件中。
- 普通项目备份不导出 Companion 凭据。
- 系统 keychain 仍为后续能力。
- ChatGPT/Codex OAuth 仍需单独评估。

ChatGPT/Codex OAuth 不作为第一版本地助手目标。它涉及 OAuth token sink、refresh token 轮换、账号额度、Codex app-server 或 Codex backend 路由等更复杂边界，需要在本地助手基础稳定后再做。

## 前端改造方向

### 设置模型

新增连接模式：

```ts
type ConnectionMode = "direct" | "localCompanion";
```

设置可以逐步演进为：

```ts
type AppSettings = {
  connectionMode: ConnectionMode;
  apiKey: string;
  apiBaseUrl: string;
  localCompanionUrl?: string;
  model: string;
  defaults: GenerationParams;
  storageMode: "indexeddb";
};
```

兼容策略：

- 旧设置没有 `connectionMode` 时，默认为 `"direct"`。
- 备份仍然不导出 `apiKey`。
- 本地助手的配对 token 是否导出需要单独评估，第一版建议不导出。

### API client

把当前图片请求拆成连接层：

```text
src/services/imagesApi.ts
src/services/directImagesClient.ts
src/services/localCompanionClient.ts
```

或者先保留一个文件，只在内部分支：

```ts
if (settings.connectionMode === "localCompanion") {
  return generateViaLocalCompanion(...);
}

return generateViaDirectApi(...);
```

等本地助手协议稳定后再拆文件。

## Companion CLI MVP

建议命令：

```text
gpt-image-studio login
gpt-image-studio serve
gpt-image-studio status
gpt-image-studio logout
```

第一版行为：

- `login`：提示用户输入 API Base URL 和 API key，保存到本地。
- `serve`：启动 `127.0.0.1` HTTP 服务。
- `status`：显示服务状态、配置的 provider 和连接密钥。
- `logout`：清除本地凭据。

技术栈建议先用 Node.js + TypeScript。这样可以复用前端项目的类型、校验逻辑和包管理方式。

## 分阶段计划

### 阶段一：保持当前 Web-only 模式稳定 ✅ 已完成

- 继续完成当前架构重构。
- 保持 `imagesApi.ts` 作为唯一图片请求入口。
- 补充 `imagesApi`、备份导出、设置迁移相关测试。
- 在设置页继续明确提示 API key 本地保存和中转站信任边界。

### 阶段二：协议和设置预留 ✅ 已完成

- 新增 `connectionMode`，默认仍为 `direct`。
- 抽出图片 client 接口。
- 新增本地助手检测 UI，但可以先隐藏或标记为实验。
- 起草本地助手 HTTP 协议类型。当前类型分别保留在 Web App 和 companion 内部，不发布共享协议包。

### 阶段三：本地助手 API key 代理 MVP ✅ 已完成（历史实现）

本阶段记录的是最初的一次性配对码和 session token 方案，后续已由持久化连接密钥替代。

- ✅ 新增 `companion/`（pnpm workspace monorepo 结构）。
- ✅ 实现 `serve` 命令（Fastify HTTP 服务，监听 `127.0.0.1:19750`）。
- ✅ 实现 `/health` 端点。
- ✅ 实现 `/pair/start` 和 `/pair/confirm`（6 位配对码 + session token）。
- ✅ 实现 token 校验中间件。
- ✅ 前端配对 UI（在线检测、配对码输入、已连接/断开状态）。
- ✅ 实现 `login`、`status`、`logout` 命令（凭据管理）。
- ✅ 实现 `/auth/status`。
- ✅ 实现 `/images/generations` 和 `/images/edits`（图片代理）。
- ✅ 前端 `localCompanionImagesClient` 对接真实请求。

### 阶段四：基础安全加固 ✅ 已完成（历史实现）

本阶段中的配对 token 和 session 文件描述属于旧方案；当前实现使用连接密钥文件。

- ✅ Origin 白名单配置化。正式渠道默认只允许 `https://image.honlnk.com`，开发渠道允许本地开发 origin，并支持显式 `--allow-origin`。
- ✅ 配对 token 过期和重置。session 默认 30 天过期，`unpair` 可清除配对，不影响 API 凭据。
- ✅ 请求大小限制。JSON 和 multipart 编辑请求有独立 body limit，并限制编辑引用图数量与图片 MIME 类型。
- ✅ 日志脱敏。服务日志脱敏 Authorization、API key 和图片 base64 字段，不记录请求 body。
- ✅ 凭据和 session 文件权限收紧为 `0600`。

### 阶段四补充：发布文档 ✅ 已完成

- ✅ 安装、升级和卸载说明。

### 阶段五：后台服务管理 ✅ 已完成

目标是让普通用户不必长期占用一个终端窗口，同时仍然保留 `serve` 作为前台调试模式。

已新增命令：

```text
gpt-image-studio start
gpt-image-studio stop
gpt-image-studio restart
gpt-image-studio logs
```

命令行为：

- `serve`：继续作为前台运行模式，日志直接输出到当前终端，适合开发和排错。
- ✅ `start`：后台启动 companion 服务，写入 PID 文件和日志文件。
- ✅ `stop`：读取 PID 文件，只停止 companion 自己启动的后台进程，不按端口粗暴杀进程。
- ✅ `restart`：先 `stop`，再 `start`。
- ✅ `logs`：查看本地运行日志，默认显示当天日志最后 100 行。

本地状态文件：

```text
~/.gpt-image-studio/companion.pid
~/.gpt-image-studio/logs/companion-YYYY-MM-DD.log
```

PID 文件建议保存：

```json
{
  "pid": 12345,
  "port": 19750,
  "channel": "stable",
  "logFile": "~/.gpt-image-studio/logs/companion-2026-05-25.log",
  "startedAt": "2026-05-25T10:00:00.000Z"
}
```

日志行为：

- `start` 后台进程将 stdout/stderr 追加写入当天日志文件。
- `logs --lines 200` 查看最后 200 行。
- `logs --follow` 持续跟随日志。
- `logs --date YYYY-MM-DD` 查看指定日期日志。
- 每次 `start` 时自动删除 7 天前的 companion 日志。

首次配对体验（历史行为，当前已由连接密钥流程替代）：

- 如果已经存在有效 session，`start` 后台启动成功后直接退出。
- 如果没有有效 session，`start` 启动后台服务后不立刻退出，而是在当前终端等待首次配对完成。
- 用户在网页设置中点击「开始配对」后，终端显示日志里的 6 位配对码。
- 用户在网页端输入配对码并配对成功后，`start` 输出成功提示并退出，后台服务继续运行。
- 如果用户按 `Ctrl+C` 中断等待，后台服务继续运行；用户可以通过 `logs` 查看后续日志，或重新执行 `start` 继续等待配对。

状态增强：

- ✅ `status` 显示后台服务 PID、端口、channel、日志文件路径和启动时间。
- ✅ 如果 PID 文件存在但进程已不存在，提示 stale PID 并建议重新 `start`。

阶段五暂不做：

- 暂不接入 macOS launchd、Windows Service 或 Linux systemd。
- 暂不做开机自启。
- 暂不按端口停止未知进程，避免误杀其它本地服务。

### 阶段六：更多 provider 和 OAuth

- 支持多个 provider profile。
- 支持 provider 选择和模型能力探测。
- 后置：支持系统 keychain。
- 评估 ChatGPT/Codex OAuth。
- 如果做 Codex OAuth，参考 OpenClaw 的 token sink、refresh lock、auth profile order 和 app-server auth bridge 思路，但不要把 token 暴露给网页。

## 验收标准

基础模式继续满足：

- 不安装 companion 也能继续使用当前中转站模式。
- 备份不导出 API key。
- 用户数据仍然只保存在当前浏览器和用户选择的中转站。

本地助手 MVP 满足：

- 网页能检测本地助手是否运行。
- 用户通过连接密钥连接受保护接口。
- 只有白名单中的受信 Origin 可以管理本地 Provider API Key。
- 本地助手能代理 `gpt-image-2` 文生图。
- 本地助手能代理带引用图的编辑请求。
- 关闭本地助手后，网页能给出清晰提示并允许切回基础模式。

## 暂不做

- 不在纯前端中直接实现 ChatGPT/Codex OAuth。
- 不把 OAuth refresh token 存到 IndexedDB。
- 不允许任意第三方网页读取 Companion 凭据。
- 不在第一版 companion 中加入文件系统、shell 或浏览器控制能力。
- 不强制用户安装 companion，基础模式继续保留。
