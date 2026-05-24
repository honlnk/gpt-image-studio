# 本地 CLI Companion 方案

更新日期：2026-05-24

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
- 网页永远不读取、不保存、不导出本地助手里的真实凭据。

## 推荐仓库结构

第一阶段不需要新建独立仓库。建议先放在当前仓库中，避免前端和本地协议频繁跨仓同步。

短期结构：

```text
gpt-image-studio/
  src/
  companion/
  packages/
    protocol/
  docs/
```

中长期如果项目继续变大，可以迁移为 monorepo：

```text
gpt-image-studio/
  apps/
    web/
    companion/
  packages/
    protocol/
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
- 本地配对和权限校验。
- 日志脱敏。

Vue 负责：

- 检测本地助手是否运行。
- 发起配对。
- 调用本地助手的图片生成和编辑接口。
- 展示结果并继续使用当前 IndexedDB 数据模型。

## 协议 MVP

第一版只支持当前已有图片功能，不急着做 ChatGPT/Codex OAuth。

建议接口：

```text
GET  /health
POST /pair/start
POST /pair/confirm
GET  /auth/status
POST /images/generations
POST /images/edits
```

### `/health`

用于网页检测本地助手是否安装并正在运行。

返回示例：

```json
{
  "app": "gpt-image-studio-companion",
  "version": "0.1.0",
  "paired": true
}
```

### `/pair/start` 和 `/pair/confirm`

首次连接必须配对。不能让任意网页自动调用本机服务。

可选流程：

1. 网页请求 `/pair/start`。
2. CLI 在终端或本地浏览器页面显示一次性配对码。
3. 用户在网页输入配对码。
4. 网页调用 `/pair/confirm`。
5. CLI 返回短期 session token。

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

不要返回真实 API key、access token、refresh token。

### `/images/generations`

尽量保持 OpenAI Images API 兼容形状，便于前端少改。

请求包含：

- `model`
- `prompt`
- `size`
- `quality`
- `background`
- `output_format`

返回继续使用 `data[0].b64_json`，这样当前图片保存逻辑可以复用。

### `/images/edits`

继续支持 `FormData`：

- `model`
- `prompt`
- `image[]`
- `size`
- `quality`
- `background`
- `output_format`

第一版保持最多 16 张引用图的限制。

## 安全要求

本地助手不能只是一个裸露的 localhost 代理。最低要求：

- 校验 `Origin`，正式版默认只允许 `https://gpt-image.honlnk.com`。
- 开发版可以额外允许本地开发 origin，例如 `http://localhost:<port>`、`http://127.0.0.1:<port>`。
- 首次使用必须配对。
- 每个请求必须带配对后的 session token。
- 不允许网页读取 API key、OAuth access token 或 refresh token。
- 日志不记录 Authorization、完整 prompt、图片 base64 或上传图片内容。
- 限制上传图片数量、大小和 MIME 类型。
- 默认只监听 `127.0.0.1`，不要监听 `0.0.0.0`。
- CORS 只允许白名单 origin，不能使用 `Access-Control-Allow-Origin: *`。

后续如果支持文件系统、shell、浏览器自动化等更高权限工具，需要单独做权限模型，不能混在图片代理 MVP 里。

### Origin 白名单策略

本地助手需要区分开发版和正式版，避免用户从正式安装渠道下载的 companion 被任意本地开发页面或恶意网页调用。

建议策略：

```text
正式版默认白名单：
  https://gpt-image.honlnk.com

开发版默认白名单：
  https://gpt-image.honlnk.com
  http://localhost:<dev-port>
  http://127.0.0.1:<dev-port>
```

实现上可以通过构建渠道或环境变量控制：

```text
GPT_IMAGE_STUDIO_COMPANION_CHANNEL=stable
GPT_IMAGE_STUDIO_COMPANION_CHANNEL=dev
```

`stable` 渠道：

- 默认只允许正式站点 `https://gpt-image.honlnk.com`。
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

第一阶段：

- 只支持用户在本地 CLI 中配置 OpenAI 兼容 API key。
- CLI 本地保存凭据。
- Web App 不再保存这类本地助手凭据。

后续阶段：

- 支持更多 OpenAI 兼容 provider。
- 支持系统 keychain。
- 支持 provider 级 profile。
- 再评估 ChatGPT/Codex OAuth。

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
- `status`：显示服务状态、配置的 provider、是否已配对。
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
- 起草 `packages/protocol` 的共享类型。

### 阶段三：本地助手 API key 代理 MVP ✅ 已完成

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

### 阶段四：安全加固 🚧 下一阶段

- Origin 白名单。
- 配对 token 过期和重置。
- 请求大小限制。
- 日志脱敏。
- 本地凭据加密或系统 keychain。
- 安装、升级和卸载说明。

### 阶段五：更多 provider 和 OAuth

- 支持多个 provider profile。
- 支持 provider 选择和模型能力探测。
- 评估 ChatGPT/Codex OAuth。
- 如果做 Codex OAuth，参考 OpenClaw 的 token sink、refresh lock、auth profile order 和 app-server auth bridge 思路，但不要把 token 暴露给网页。

## 验收标准

基础模式继续满足：

- 不安装 companion 也能继续使用当前中转站模式。
- 备份不导出 API key。
- 用户数据仍然只保存在当前浏览器和用户选择的中转站。

本地助手 MVP 满足：

- 网页能检测本地助手是否运行。
- 首次连接必须配对。
- 网页不能读取本地助手保存的 API key。
- 本地助手能代理 `gpt-image-2` 文生图。
- 本地助手能代理带引用图的编辑请求。
- 关闭本地助手后，网页能给出清晰提示并允许切回基础模式。

## 暂不做

- 不在纯前端中直接实现 ChatGPT/Codex OAuth。
- 不把 OAuth refresh token 存到 IndexedDB。
- 不让网页读取本地 CLI 的真实凭据。
- 不在第一版 companion 中加入文件系统、shell 或浏览器控制能力。
- 不强制用户安装 companion，基础模式继续保留。
