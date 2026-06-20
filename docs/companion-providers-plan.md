# Companion 多 Provider 翻译层开发方案

更新日期：2026-06-20

## 背景

现有架构：

```text
Web App ──OpenAI 形状请求──> Companion ──原样转发──> 单一 OpenAI 兼容中转站
```

- Web App 永远发 OpenAI Images API 形状的请求（`{ model, prompt, size, background, output_format }`，编辑走 `image[]` + `mask` 的 multipart）。
- Companion 是纯透传代理，`routes/images.ts` 收到什么就原样转发给 `credentials.apiBaseUrl`，响应直接透传回 Web，Web 从 `data[0].b64_json` 取图。

这套契约对 OpenAI / 各种 OpenAI 兼容中转站（packyapi 等）工作良好，但无法接入形状不同的国产图像 API（GLM、Qwen-Image、通义万相、豆包等）。

## 决策

把翻译层收进 companion，Web 侧尽量少改动。

```text
Web App ──OpenAI 形状请求(固定 gpt-image-2)──> Companion 翻译层 ──provider 专属形状──> 各厂商 API
                                  <──翻译回 OpenAI 形状(data[0].b64_json)──
```

- Web App 保持只兼容 OpenAI / gpt-image-2 形状，不引入多供应商、不引入多模型切换、不改 `imagesApi.ts` 的请求构造与响应解析。
- Companion 对外接口基本不变：`/images/generations`、`/images/edits` 仍是 OpenAI 形状请求体，仍返回 `data[0].b64_json`；唯一扩展是现有的 `/auth/status` 顺手多返回 provider 元信息（model + size 约束），见下。
- Companion 内部新增一层 provider adapter，根据当前 provider 把 OpenAI 形状请求翻译成对应厂商的形状，再把厂商响应翻译回 OpenAI 形状。
- Provider 选择和凭据配置完全在 companion CLI 侧完成，Web 永远不知道背后接的是哪家；但 Web 需要知道背后接的是什么模型及其参数约束，这些信息通过现有的 `/auth/status` 回流，不新增接口。

这是 ADR 002「Companion 安全边界」和 ADR 003「连接模式」的自然延伸：companion 本来就是「Web 与真实凭据之间的隔离层」，在隔离层里做协议翻译不破坏任何现有边界。

## 关键调研：国产图像 API 是三条独立的线

GLM、Qwen-Image、通义万相、豆包是三家公司、不同团队的独立产品，彼此没有从属关系。

| 产品                         | 公司 / 团队                                 | 接入平台                                 | 性质                                                        |
| ---------------------------- | ------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| **GLM-Image / CogView**      | 智谱（Zhipu）                               | 智谱开放平台 `open.bigmodel.cn`          | 文生图，GLM-Image 是 2026 年新旗舰，开源                    |
| **Qwen-Image**               | 阿里 · 通义千问团队                         | 阿里云百炼 / dashscope                   | 200 亿参数 MMDiT，Apache 2.0 开源，强项是复杂中英文文字渲染 |
| **通义万相（Wan / wanx）**   | 阿里 · 通义万相实验室（**独立于千问团队**） | 阿里云百炼 / dashscope                   | 写实、摄影级图像，支持图像编辑                              |
| **豆包 Seedream / SeedEdit** | 字节 · 火山方舟                             | 火山引擎方舟 `ark.cn-beijing.volces.com` | 文生图 + 图生图编辑                                         |

> Qwen-Image（千问团队）和通义万相（万相实验室）虽然都在阿里云百炼，但是两个独立团队的独立产品，API 模型名、能力侧重都不同，不能混为一谈。

### 首轮选 GLM 的理由

1. **开发者本人熟悉 GLM**：本项目就是在 GLM 辅助下开发的，开发者对 GLM 的 API 形状、文档结构、常见坑最熟悉，接入和排查成本最低。
2. **形状与 OpenAI 接近**：GLM 走智谱的 OpenAI 兼容路径（`/images/generations`），翻译层是「字段裁剪 + size 规整 + URL→b64 转换」。
3. **开源 + 文档公开**：智谱文档开放、社区资料多，踩坑成本低于火山方舟那种半封闭控制台。
4. **后续扩展红利**：GLM、豆包的 API 形状高度接近（都是 OpenAI 兼容 `/images/generations`，都返回 URL），做完 GLM adapter 后，豆包 adapter 基本是「改 sizeConstraints + 改 base url」的复制。

### GLM-Image 的 API 形状

GLM-Image 提供同步和异步两套接口：

- **同步接口** `POST /images/generations`：一次请求，长连接等待，生成完成后在同一个响应里返回图片。
- **异步接口** `POST /images/generations`（async）：提交后立即返回 `task_id`，客户端拿 `task_id` 轮询结果查询接口，任务完成后取回图片 URL。

```text
POST https://open.bigmodel.cn/api/paas/v4/images/generations
Authorization: Bearer <智谱 API Key>
Content-Type: application/json

{
  "model": "glm-image",
  "prompt": "...",
  "size": "1280x1280"
}
```

返回：

```json
{
  "data": [{ "url": "https://..." }]
}
```

本轮 GLM adapter 用**同步接口**（简单，companion 内部就是一个 fetch 等返回）。同时预留异步轮询基础设施（见「任务轮询基础设施」），供后续接通义万相等纯异步 provider 复用。

与 OpenAI Images API 的差异：

| 维度 | GLM-Image | OpenAI Images API（Web 当前发的） |
|------|-----------|----------------------------------|
| 端点 | `/images/generations` | `/images/generations`（一致） |
| 鉴权 | `Bearer` | `Bearer`（一致） |
| 请求体 | `{ model, prompt, size }` | `{ model, prompt, size, background, output_format }` |
| `size` 约束 | 软推荐 + 4 条硬规则（见下），格式 `宽x高`（小写 x） | `1024x1024`、`1536x1024`、`1024x1536`、`auto` |
| 返回 | `data[0].url` | `data[0].b64_json` |

翻译层要做的三件事：

1. **裁剪**：丢弃 GLM 不认的 `background` / `output_format`（不支持的取值报错）。
2. **size 规整**：按 GLM 的硬规则校验/规整，满足则直接透传。
3. **URL→b64**：GLM 返回 URL，companion fetch 下来转成 base64，再以 `data[0].b64_json` 形式还给 Web。该能力对所有「返回 URL」的 provider（GLM、豆包）通用。

### GLM size 约束

经查智谱官方 OpenAPI 规范（`docs.bigmodel.cn/openapi/openapi.json`），`CreateImageRequest.size` 字段是 `"type": "string"` 且没有 `enum` 约束。作为对照，同一规范里视频生成（CogVideoX）的 size 字段确实带 `enum` 数组。文档原文用词是「推荐枚举值」，明确是软推荐。

真正的硬约束（违反会报错）：

1. 宽和高必须是 **32 的倍数**
2. 每个维度在 **512–2048px** 范围内（软推荐下限 1024）
3. 宽 × 高 ≤ **4,194,304（2²²）** 像素
4. 分隔符用小写 `x`（文档说明文字里用 Unicode 乘号 `×`，但实际取值用 ASCII `x`）

这 4 条规则封装成 `sizeConstraints` 由 companion 上报给 web（见「provider 元信息回流」），web 端用它动态生成合法的尺寸选项、实时校验自定义尺寸。用户在前端只能在合法范围内选择，不会产生违规尺寸。

### 图片编辑（edits）

GLM 的图片编辑能力分散在两个模型、两套接口上，且都不是 OpenAI `images/edits` 形状：

- **GLM-Image（文生图模型）**：`/paas/v4/images/generations` 只支持文生图，没有 edits 端点，不支持参考图、不支持 mask。
- **GLM-4V-Plus（视觉模型）**：有「视觉修改」能力，但走 `chat/completions` 接口 —— 参考图作为 `image_url` 塞进 messages，编辑意图用自然语言指令表达，返回的是 chat message（可能含图片 URL），不是 `data[0].b64_json`。
- **mask 局部重绘**：智谱目前不支持。社区反馈国产模型主要靠自然语言指令做编辑，「编辑区域不稳定、指令理解不准」是已知痛点，没有 OpenAI 那种 mask 区域控制的 inpainting。

| 能力 | OpenAI edits（Web 发的） | GLM 能提供的 | 能否翻译 |
|------|----------------------|------------|---------|
| 全图编辑（无 mask） | multipart `image[]` + prompt | GLM-4V chat + `image_url` + 指令 | 能，但要把 edits 整体重写成 chat messages，并从 chat 返回里提取图片 URL |
| mask 局部重绘 | `image[]` + `mask` + `prompt` | 不支持 | 不能 |

结论：mask 局部重绘是确认的功能缺口（非待实测），Web 端带 mask 的编辑请求 companion 只能报错。全图编辑理论可做，但翻译成本高（chat vs images 两种形状 + 返回解析），且效果是自然语言驱动，质量不如 mask 精确。阶段三据此调整（见「分阶段计划」）。

## 目标

### 产品目标

- 用户在 companion CLI 配置 GLM（智谱开放平台）凭据后，Web 端无需任何改动即可生成图片。
- Web 端体验与连接 OpenAI 中转站时完全一致：同样的输入框、同样的参数、同样的生成/编辑/重试流程。
- 用户设的参数如果当前 provider 不支持，companion 返回明确错误，而不是静默丢弃。

### 技术目标

- Companion 对外接口契约基本不变（仍是 OpenAI 形状，仍返回 `data[0].b64_json`），仅 `/auth/status` 扩展 provider 元信息。
- 翻译层可扩展：第一个 provider（GLM）接通后，后续每加一个 provider 是线性成本（一个 adapter 文件 + 少量测试）。
- Provider 配置和切换完全在 companion CLI 完成。
- 现有安全边界全部保留：只监听 `127.0.0.1`、配对 token、Origin 白名单、日志脱敏、凭据 `0600`。

## 非目标

- 不改 `imagesApi.ts` 的请求构造/响应解析、生成/编辑/重试流程。`GenerationParams` 类型结构不动，但其中 size 相关的约束数据（步长/范围/像素上限）从写死改为 provider 驱动（见「provider 元信息回流」）。
- 不做 Web 端的多 provider / 多模型切换 UI（参数栏显示的是 companion 上报的 model，只读，不可选）。
- 不做「Web 端选择 provider」——provider 选择是 companion 侧的本地配置。
- 不做 Qwen-Image、通义万相、豆包（留作后续 provider adapter，本轮只接 GLM）。
- 本轮 GLM adapter 用同步接口（companion 内部是一个 fetch 等返回）；异步轮询作为通用基础设施预留（见「任务轮询基础设施」），但不在 GLM 链路启用。
- 不做服务端图片格式转码（PNG↔webp），若 provider 只返回某种格式，本轮直接接受（见「参数保真」）。
- 不做 OAuth、keychain、多 provider profile 持久化切换（本轮 provider 配置覆盖式写入即可）。

## provider 元信息回流

审查 web 端后发现两处与 provider 强耦合、且当前写死的地方：

1. **模型名**：`ComposerParameterBar.vue:29` 显示 `模型: {{ settings.model }}`，而 `settings.model` 恒为 `FIXED_IMAGE_MODEL`（gpt-image-2），与 companion 实际接入的模型无关。
2. **size 约束**：`settingsStore.ts` 里的 `SIZE_STEP`(16) / `MAX_CUSTOM_DIMENSION`(3840) / `MAX_CUSTOM_PIXELS`(8294400) 写死为 OpenAI 的值，GLM 需要的是另一套（32 / 2048 / 2²²）。
3. **参数栏 tag 选项**：`ComposerParameterBar.vue` 的「区域编辑」「背景」「格式」tag 始终显示全部选项，但不同 provider 支持的选项不同 —— GLM 不支持 mask 编辑、不支持透明背景、不支持 webp。当前是「设了不支持的值再报错」，应该改成「不支持的选项直接不显示」。

关键事实：web 端 size 本来就是「规则数据 + 通用逻辑」的数据驱动设计，不是写死的尺寸枚举：

```text
用户选 ratio(8种比例) + resolution(1k/2k/4k 目标像素)
  → dimensionsForRatio(): 按比例+目标像素算出 width×height
  → 对齐到 SIZE_STEP 的倍数
  → 钳制到 MAX_CUSTOM_DIMENSION / MAX_CUSTOM_PIXELS
getCustomSizeError(): 校验步长/范围/像素上限/长短边比
```

所有「规则」都是数据，逻辑（`dimensionsForRatio` / `getCustomSizeError`）是通用的。只是这些数据当前写死在 web 端、为 OpenAI/gpt-image 调的：

| 规则数据（当前写死） | OpenAI 值 | GLM 值 |
|------|-----------|--------|
| `SIZE_STEP`（对齐步长） | 16 | 32 |
| 单边范围 | 16–3840 | 512–2048 |
| `MAX_CUSTOM_PIXELS`（像素上限） | 8,294,400 | 4,194,304(2²²) |
| 长短边比上限 | 3 | 无（不限制） |
| 默认尺寸 | — | 1280x1280 |

### 设计：companion 上报，web 用现有逻辑跑

让 companion 通过 `/auth/status` 上报 model 和 sizeConstraints，web 端用同一套通用逻辑跑：

- 每个 provider 的 size 约束由 adapter 在 companion 侧声明（一处定义），通过 `/auth/status` 传给 web。
- web 端的 `SIZE_STEP` / `MAX_CUSTOM_DIMENSION` / `MAX_CUSTOM_PIXELS` 等常量从「写死」变成「从 companion 读取，direct 模式回退到 OpenAI 默认值」。
- `dimensionsForRatio` / `getCustomSizeError` 逻辑不动，只是参数来源变了。
- 用户在参数栏选尺寸时，web 端自动按当前 provider 的约束校验和计算，**生成前就避免违规尺寸**，而不是等 companion 报错。

约束前置到 UI 层，用户设不合规尺寸时 web 端直接提示（复用现有 `customSizeError`），companion 收到的请求天然合规，翻译层不用做二次规整逻辑。

### 信息流向

```text
companion credentials.json (provider + model)
  + adapter 声明的 sizeConstraints + capability
  → /auth/status 返回 { provider, model, sizeConstraints, capability, ready, accountLabel }
  → ApiSettingsPanel.checkStatus() 拿到 authStatus
  → 写回 settingsStore.model + size 约束 refs + capability refs
  → ComposerParameterBar 按 capability 隐藏/过滤 tag 选项
  → dimensionsForRatio / getCustomSizeError 用新约束跑（逻辑不动，参数来源变）
```

### 取值规则

- companion 模式 + 已配对 + 在线 → `settingsStore.model` = companion 上报的 model；size 约束和 capability = companion 上报的值。
- companion 离线 / direct 模式 → 回退到 OpenAI 默认值（`FIXED_IMAGE_MODEL` + step=16 + 全能力）。

### `/auth/status` 扩展后的返回

```jsonc
{
  "provider": "glm",
  "model": "glm-image",
  "mode": "api_key",
  "ready": true,
  "accountLabel": "xxx***",
  "sizeConstraints": {
    "step": 32,
    "min": 512, "max": 2048,
    "maxPixels": 4194304,
    "maxAspectRatio": null,        // null = 不限制
    "defaultSize": "1280x1280"
  },
  "capability": {
    "generate": true,
    "edit": false,
    "mask": false,
    "backgrounds": ["auto", "opaque"],        // 不含 transparent
    "outputFormats": ["png", "jpeg"]          // 不含 webp
  }
}
```

### UI 驱动：能力决定 tag 显示与选项过滤

`ComposerParameterBar.vue` 的 tag 按 capability 动态显示：

| Tag | 驱动逻辑 |
|-----|---------|
| 模型 | 始终显示（model 已回流） |
| 内容/模式 | 始终显示（prompt 改写，与 provider 无关） |
| 区域编辑 | `v-if="capability.mask"` —— 不支持 mask 则整个 tag 隐藏 |
| 尺寸 | 始终显示（sizeConstraints 已回流） |
| 数量 | 始终显示（各 provider 都支持，首轮不处理） |
| 背景 | 用 `capability.backgrounds` 过滤 `backgroundOptions`，只显示支持的值；当前选中值被过滤掉则回退到第一个可用值 |
| 格式 | 用 `capability.outputFormats` 过滤 `formatOptions`，同理 |

这样不支持的选项用户根本看不到，也就不会设错 —— 比「设了不支持的值再报错」体验更好。这是 size 约束 provider 化思路的延伸：能力数据由 companion 声明，通过 `/auth/status` 传给 web，web 用它驱动 UI。

capability 只覆盖 GLM 明确有差异的维度（mask / backgrounds / outputFormats），quality、imageCount 等各 provider 都一样的字段不纳入，避免过度设计。

### 安全性

`model`、`sizeConstraints`、`capability` 都不是凭据（模型 id、尺寸规则、能力描述都是公开信息），回流它们不破坏「Web 永远不接触真实 key」的安全边界。`accountLabel` 继续脱敏。

### 改动点

| 文件 | 改动 |
|------|------|
| `companion/src/providers/types.ts` | adapter 接口新增 `sizeConstraints` 和扩展后的 `capability` 字段（含 `backgrounds` / `outputFormats`） |
| `companion/src/providers/openai.ts` | 声明 OpenAI 的 sizeConstraints + 全能力（backgrounds/format 都全） |
| `companion/src/providers/glm.ts` | 声明 GLM 的 sizeConstraints + 能力（backgrounds 去掉 transparent，outputFormats 去掉 webp，mask=false） |
| `companion/src/routes/auth.ts` | `/auth/status` 返回当前 adapter 的 `model`、`sizeConstraints`、`capability`；`provider` 读真实 `creds.provider` |
| `src/types/companion.ts` | `CompanionAuthStatus` 新增 `model`、`sizeConstraints`、`capability` 字段 |
| `src/stores/settingsStore.ts` | `SIZE_STEP` / `MAX_CUSTOM_*` 从常量改为 ref；`backgroundOptions` / `formatOptions` 按 capability 过滤后的结果；新增 model + capability 回流写入 |
| `src/components/chat/ComposerParameterBar.vue` | 区域编辑 tag 加 `v-if` 按 capability.mask 显示；背景/格式 tag 读过滤后的选项 |
| `src/components/settings/ApiSettingsPanel.vue` | `checkStatus()` 拿到 authStatus 后 emit 写回 model + sizeConstraints + capability |

`dimensionsForRatio` / `getCustomSizeError` 逻辑不动，只是引用的常量变成响应式。

> 这个改动让 `settingsStore.model` 的语义从「写死的 FIXED_IMAGE_MODEL」变成「当前生效模型（companion 在线时被覆盖，否则回退默认）」。下游所有读 `model` 的地方（如 `transparentDisabled` 判断 `model === FIXED_IMAGE_MODEL`）需要顺带审查：在 capability 驱动 UI 后，`transparentDisabled` 这种按 model 名字判断的逻辑应该改成读 `capability.backgrounds` 是否含 transparent，语义更直接。

## 架构

### 现状

```text
companion/src/routes/images.ts
  POST /images/generations  →  fetch(apiBaseUrl + "/generations", { Authorization: Bearer key, body: 原样 })
  POST /images/edits        →  fetch(apiBaseUrl + "/edits",       { Authorization: Bearer key, body: 原样 multipart })
  返回上游响应原样
```

### 目标

```text
companion/src/routes/images.ts
  POST /images/generations  →  providerAdapter.generate(OpenAI形状入参)  →  返回 OpenAI 形状 {data:[{b64_json}]}
  POST /images/edits        →  providerAdapter.edit(OpenAI形状入参)      →  返回 OpenAI 形状 {data:[{b64_json}]}

companion/src/providers/
  types.ts        # ProviderAdapter 接口、ProviderCapability、ProviderConfig
  registry.ts     # provider 注册表 + 当前 provider 解析
  openai.ts       # 现有透传逻辑搬过来，作为默认/兼容 adapter
  glm.ts          # GLM-Image（智谱）adapter
  urlToB64.ts     # 通用工具：provider 返回 URL 时 fetch 转 base64
  taskPoller.ts   # 通用工具：异步 provider 的「提交 task → 轮询状态 → 取结果」封装
```

### ProviderAdapter 接口

```ts
// companion/src/providers/types.ts
export type ProviderCapability = {
  generate: true;
  edit: boolean;        // 该 provider 是否支持图片编辑
  mask: boolean;        // 编辑是否支持 mask 局部编辑
  backgrounds: ("auto" | "opaque" | "transparent")[];  // 支持的背景值
  outputFormats: ("png" | "webp" | "jpeg")[];          // 支持的输出格式
};

export type SizeConstraints = {
  step: number;                 // 对齐步长（GLM=32, OpenAI=16）
  min: number;                  // 单边最小像素
  max: number;                  // 单边最大像素
  maxPixels: number;            // 总像素上限
  maxAspectRatio: number | null; // null = 不限制
  defaultSize: string;          // auto / 默认尺寸
};

export type OpenAIImageRequest = {
  model: string;
  prompt: string;
  size: string;          // OpenAI 形状的 size，例如 "1024x1024" / "auto"
  background: string;    // "auto" | "opaque" | "transparent"
  outputFormat: string;  // "png" | "webp" | "jpeg"
};

export type OpenAIImageEditRequest = OpenAIImageRequest & {
  images: { blob: Buffer; name: string; mimeType: string }[];
  mask?: { blob: Buffer; name: string; mimeType: string };
};

export type OpenAIImageResult = {
  b64Json: string;
  revisedPrompt?: string;
};

export type ProviderAdapter = {
  readonly id: string;
  readonly capability: ProviderCapability;
  readonly sizeConstraints: SizeConstraints;

  describe(config: ProviderConfig): { label: string; providerId: string };

  generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult>;

  edit?(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult>;
};
```

adapter 的输入输出都是 OpenAI 形状，内部负责「OpenAI 形状 → 厂商形状 → fetch → 厂商响应 → OpenAI 形状」全过程。`routes/images.ts` 对所有 provider 的处理是统一的。

### 路由层改造

`routes/images.ts` 从「直接 fetch 上游」改成「调用当前 adapter」：

```ts
const adapter = resolveAdapter(creds); // 根据 creds.provider 选 adapter
if (!adapter.capability.generate) throw new Error("当前 provider 不支持文生图");

const result = await adapter.generate(
  { model, prompt, size, background, outputFormat },
  creds,
);
return reply.send({
  data: [{ b64_json: result.b64Json, revised_prompt: result.revisedPrompt }],
});
```

edit 路径多一步能力检查：

```ts
if (!adapter.capability.edit) {
  return reply.status(501).send({ error: "当前 provider 不支持图片编辑" });
}
if (request.mask && !adapter.capability.mask) {
  return reply.status(400).send({ error: "当前 provider 不支持遮罩局部编辑" });
}
```

### 任务轮询基础设施

图像生成 API 有两种调用模式：

- **同步**：一次 HTTP 请求，连接挂到画完为止，在同一个响应里返回结果。OpenAI Images API、GLM 同步接口都是这种。客户端就是一个普通 `await fetch()`，但长连接有超时风险。
- **异步轮询**：第一次请求只提交任务、立即返回 `task_id`（连接断开）；客户端拿着 `task_id` 反复查询任务状态，直到任务完成取回结果。GLM 异步接口、通义万相（Wan）都是这种。优点是不挂长连接、不超时；缺点是客户端要实现「提交 → 轮询间隔 → 超时判断 → 重试 → 取结果」的状态机。

本轮 GLM 用同步接口（简单），但同步模式有超时风险（图像生成几十秒是常态）。为此预留一套**通用任务轮询基础设施** `taskPoller.ts`：

```ts
// companion/src/providers/taskPoller.ts
// 把异步 provider 的「提交 task → 轮询 → 取结果」包成一个同步 Promise
export async function runAsyncTask(options: {
  submit: () => Promise<{ taskId: string }>;        // 提交任务，拿 task_id
  poll: (taskId: string) => Promise<TaskStatus>;    // 查询状态
  extractResult: (taskId: string) => Promise<OpenAIImageResult>; // 任务完成后取结果
  intervalMs: number;       // 轮询间隔
  timeoutMs: number;        // 总超时
}): Promise<OpenAIImageResult>;
```

GLM adapter 本轮不调用它（用同步接口），但这个工具先实现并测试好。后续接通义万相等纯异步 provider 时，adapter 内部直接 `await runAsyncTask({...})` 就行，对 `routes/images.ts` 来说所有 provider 都是同一个 `adapter.generate()` 返回 Promise，无感知差异。

### 凭据模型

`credentials.json` 扩展为带 provider 标识：

```json
{
  "provider": "glm",
  "apiBaseUrl": "https://open.bigmodel.cn/api/paas/v4",
  "apiKey": "xxx",
  "model": "glm-image",
  "savedAt": "2026-06-20T00:00:00.000Z"
}
```

读取时若无 `provider` 字段，按 `openai` 处理，走透传 adapter，现有 OpenAI 中转站用户零感知。

### Web 与 companion 的契约（不变）

Web 永远发：

- generate: `{ model: "gpt-image-2", prompt, size, background, output_format }`
- edit: FormData `{ model, prompt, image[], mask, size, background, output_format }`
- 期望返回: `{ data: [{ b64_json, revised_prompt? }] }`

这套契约在 ADR 002 已确立，本方案不动它。

## 参数保真策略

所有与 provider 相关的参数（size / background / output_format / mask）都采用「能力前置」策略：companion 通过 `/auth/status` 把 `sizeConstraints` 和 `capability` 传给 web，web 端据此驱动 UI —— 不支持的选项直接不显示，用户选不到，也就不会设错。companion 翻译层只保留轻量兜底校验（防御性编程），正常路径下不会触发。

| 参数 | UI 行为 | companion 兜底 |
|------|---------|---------------|
| size | web 按 sizeConstraints 实时校验，违规尺寸即时报错不发请求 | 收到违规 size 时按硬规则规整后透传 |
| background | 按 `capability.backgrounds` 过滤选项，不支持的不显示；当前选中值被过滤则回退到第一个可用值 | 收到不支持的值时报错 |
| output_format | 按 `capability.outputFormats` 过滤选项，同理 | 收到不支持的值时报错 |
| mask | `capability.mask=false` 时区域编辑 tag 整个隐藏 | 收到 mask 请求时报错 |
| size=auto | web 按 `sizeConstraints.defaultSize` 映射 | — |

**不做服务端转码**：如果 provider 只返回某种格式，本轮不把 PNG 转 webp，而是按 provider 实际返回的格式给 Web（Web 侧 `ImageAsset` 按 mimeType 存图，不是按 `output_format` 存）。

## 能力声明（按 provider）

provider 在 adapter 里声明自己的 generate/edit/mask 能力，不支持的调用直接报错。

GLM 首版能力声明：

```ts
export const glmAdapter: ProviderAdapter = {
  id: "glm",
  capability: {
    generate: true,
    edit: false,      // GLM-Image 无 edits 端点；GLM-4V 全图编辑走 chat 接口，阶段三视优先级决定
    mask: false,      // 智谱全系列不支持 mask 局部重绘（确认的缺口）
    backgrounds: ["auto", "opaque"],           // 不含 transparent（GLM 不支持透明）
    outputFormats: ["png", "jpeg"],            // 不含 webp
  },
  sizeConstraints: {
    step: 32,
    min: 512, max: 2048,
    maxPixels: 4194304,
    maxAspectRatio: null,
    defaultSize: "1280x1280",
  },
  // ...
};
```

UI 层按这份 capability 驱动：区域编辑 tag 因 `mask:false` 隐藏，背景选项因不含 transparent 而不显示「透明」，格式选项因不含 webp 而不显示「WebP」。OpenAI adapter 对应声明全能力（`mask:true`、backgrounds/format 都全），direct 模式下 UI 行为与现在完全一致。

若阶段三决定做全图编辑，把 `edit` 打开即可（走 GLM-4V chat 翻译），`mask` 始终保持 `false`。Web 侧无感（Web 本来就在发编辑请求，companion 按 capability 决定报错还是翻译）。

## CLI 命令

### `login`（改造）

交互流程：

```text
1. Provider 类型：openai / glm （默认 openai）
2. API Base URL（按 provider 给默认值）
   - openai: https://api.packyapi.com/v1/images
   - glm:    https://open.bigmodel.cn/api/paas/v4
3. API Key（不回显）
4. [glm 专属] Model ID（如 glm-image，给默认值）
```

凭据按 `provider` 字段一起写入 `credentials.json`，覆盖式写入（不做多 profile 持久化）。

### `status`（增强）

在现有凭据展示基础上，加一行 `Provider: glm (智谱)` 和 `Model: glm-image`。

### `providers`（新增，可选）

```text
gpt-image-studio providers       # 列出所有支持的 provider 及其能力
gpt-image-studio providers glm   # 查看 glm 的详细参数说明
```

本轮可选，不做也不阻塞 MVP。

> 本轮不引入 `use <provider>` 命令，因为 `login` 已经是覆盖式写入 provider。`use` 命令是「多 profile 持久化」的前置，属于后续非目标。

## 安全

全部沿用现有安全设计，无新增风险：

- 只监听 `127.0.0.1`。
- 配对 token + Origin 白名单。
- 日志脱敏：`apiKey` 和各厂商鉴权 header（同为 `Bearer`）都在 redact 范围。
- 凭据文件 `0600`。
- 翻译层在 companion 内部完成，真实 API key 永远不出 companion，Web 永远只拿到 `b64_json` 图片结果。安全边界与 ADR 002 完全一致。
- URL→b64 转换的 fetch 发生在 companion 进程内（服务端），不经过浏览器，不泄露给 Web；该临时下载只用于转 base64 还给 Web，不做本地持久化。

## 测试策略

### Companion 单元测试

```text
companion/src/providers/
  registry.test.ts        # provider 解析、openai 兼容回退
  openai.test.ts          # 透传 adapter 行为（从现有 routes/images.test.ts 拆出）
  glm.test.ts             # GLM 翻译：OpenAI 形状入参 → GLM 请求体、GLM 响应(URL) → OpenAI 形状(b64)
  glm.params.test.ts      # 参数校验：transparent 报错、webp 报错、size 兜底规整
  urlToB64.test.ts        # URL→b64 工具
  taskPoller.test.ts      # 异步轮询：提交 → 轮询 → 超时 → 取结果（mock，不依赖真实网络）
```

翻译层是纯函数（入参 OpenAI 形状 → 出参厂商形状），不依赖真实网络。mock fetch 验证「发出的请求体长什么样」和「收到的响应怎么解析」。taskPoller 用 fake timer 测试轮询间隔、超时、重试。

### Companion 路由测试

现有 `routes/images.test.ts` 改造为：默认走 openai adapter（保持现有测试通过），新增一组「provider=glm 时走 GLM 翻译」的测试。

### 手动联调清单

- [ ] `gpt-image-studio login` 选 glm，配置真实智谱 API Key
- [ ] `gpt-image-studio start` + 网页配对
- [ ] Web 端文生图：确认 GLM 返回的 URL 被 companion 转成 b64 后正常显示
- [ ] Web 端设 `size: auto`：确认 web 映射到 GLM 默认 `1280x1280` 生成
- [ ] Web 端选比例 + 1k 分辨率：确认 web 按 GLM 约束（32 倍数/512–2048/2²²）算出合规尺寸，GLM 正常生成
- [ ] Web 端自定义尺寸设违规值（如非 32 倍数）：确认 web 端即时报错提示，不发请求
- [ ] 参数栏模型标签显示 `glm-image`（验证 provider 元信息回流）
- [ ] 参数栏「区域编辑」tag 隐藏（GLM 不支持 mask）
- [ ] 参数栏「背景」选项不含「透明」（GLM 不支持 transparent）
- [ ] 参数栏「格式」选项不含「WebP」（GLM 不支持 webp）
- [ ] Web 端带 mask 的编辑图：确认报「不支持遮罩局部编辑」（GLM 确认不支持 mask），错误信息清晰
- [ ] Web 端全图编辑（无 mask）：若阶段三已实现，确认经 GLM-4V chat 翻译跑通；若未实现，确认报「不支持图片编辑」
- [ ] 切回 `login` 选 openai：确认参数栏模型回到 gpt-image-2，size 约束回到 step=16，区域编辑/背景/格式 tag 全部恢复，现有 OpenAI 中转站流程零回归

## 分阶段计划

### 阶段一：翻译层骨架 + openai adapter 抽取

把现有透传逻辑从 `routes/images.ts` 抽成 `providers/openai.ts`，建立 `ProviderAdapter` 接口和 registry，**行为零变化**。

- [ ] 新增 `companion/src/providers/types.ts`（接口定义，含 `SizeConstraints`）
- [ ] 新增 `companion/src/providers/registry.ts`（按 `creds.provider` 解析 adapter，缺省回退 openai）
- [ ] 把 `routes/images.ts` 现有 fetch 逻辑搬到 `providers/openai.ts`
- [ ] `routes/images.ts` 改为调用 `resolveAdapter(creds).generate/edit`
- [ ] `credentials.ts` 读取时兼容无 `provider` 字段（默认 openai）
- [ ] `providers/openai.ts` 声明 OpenAI 的 sizeConstraints（step=16 等）和全能力（mask=true, backgrounds/outputFormats 都全，即当前 web 行为）
- [ ] 新增 `companion/src/providers/taskPoller.ts`（通用异步轮询基础设施，GLM 本轮不调用但先实现并测试）
- [ ] `routes/auth.ts` 的 `provider` 读真实 `creds.provider`；新增返回 `model`、`sizeConstraints`、`capability`（来自当前 adapter）
- [ ] `src/types/companion.ts` 的 `CompanionAuthStatus` 新增 `model`、`sizeConstraints`、`capability` 字段
- [ ] `settingsStore.ts` 的 `SIZE_STEP` / `MAX_CUSTOM_*` 从常量改为 ref（companion 覆盖，否则回退 OpenAI 默认）；`backgroundOptions` / `formatOptions` 改为按 `capability` 过滤后的 computed；新增 model + capability 回流写入
- [ ] `ComposerParameterBar.vue` 区域编辑 tag 加 `v-if` 按 capability.mask 显示；背景/格式 tag 读过滤后的选项
- [ ] `ApiSettingsPanel.vue` 的 `checkStatus()` 拿到 authStatus 后 emit 写回 model + sizeConstraints + capability
- [ ] 审查 `settingsStore.model` 下游消费者（`transparentDisabled` 等）在 capability 驱动后的语义（改读 `capability.backgrounds`）
- [ ] 现有所有测试通过（零回归）

**验收**：现有 OpenAI 中转站用户完全无感（OpenAI 全能力，UI 行为不变），companion 内部已有 adapter 抽象 + provider 元信息回流通道 + UI 能力驱动 + 异步轮询基础设施。

### 阶段二：GLM 文生图 adapter

接入 GLM-Image 文生图，打通第一条非 OpenAI 链路。

- [ ] 新增 `companion/src/providers/glm.ts`
- [ ] 新增 `companion/src/providers/urlToB64.ts`（通用 URL→b64 工具）
- [ ] 实现 generate：OpenAI 形状 → GLM `/images/generations` 请求体（裁剪 `background`/`output_format`）
- [ ] 声明 GLM 的 `sizeConstraints`（step=32, 512–2048, maxPixels=4194304, defaultSize=1280x1280）
- [ ] 声明 GLM 的 `capability`（mask=false, backgrounds 去 transparent, outputFormats 去 webp）—— UI 据此隐藏选项，companion 仅保留兜底校验
- [ ] 实现响应翻译：GLM `data[0].url` → fetch → b64 → `{ b64Json, revisedPrompt? }`
- [ ] `login` 命令支持选 glm，写入 `provider` + `model` 字段
- [ ] `status` 显示 provider 信息
- [ ] 单元测试：翻译纯函数 + 参数兜底校验 + urlToB64
- [ ] 手动联调：真实智谱 API Key 文生图跑通

**验收**：用户配置 GLM 凭据后，参数栏自动隐藏 GLM 不支持的选项（区域编辑/透明背景/webp），文生图与 OpenAI 体验一致。编辑图此时报「不支持」（因为 `capability.edit=false`）。

### 阶段三：GLM 全图编辑 adapter（可选，视优先级）

基于调研结论（见「图片编辑」），GLM 编辑能力有明确边界：

- **mask 局部重绘**：确认不支持，不做。`capability.mask` 保持 `false`，带 mask 的编辑请求直接报错。
- **全图编辑**：GLM-4V-Plus 能做，但走 `chat/completions` 接口，翻译成本高（edits 整体重写成 chat messages + 从 chat 返回提取图片 URL），且效果是自然语言驱动。

- [ ] 若决定做全图编辑：
  - GLM adapter 增加 `edit`：OpenAI edits（multipart image[] + prompt）→ GLM-4V chat（image_url + 指令）
  - 解析 chat 返回提取图片 URL → urlToB64 → OpenAI 形状
  - `capability: { edit: true, mask: false }`
  - 单元测试 + 手动联调（重点验证自然语言指令的编辑质量是否可接受）
- [ ] 若决定不做：保持 `capability.edit=false`，带图编辑请求报错，本阶段跳过

**验收**：mask 局部重绘确认不支持（报错）。全图编辑视优先级决定是否实现；不做也不阻塞本轮 MVP，因为文生图（阶段二）是核心价值。

### 阶段四（后续，本轮不做）：更多 provider

每个一个 `providers/<name>.ts`，注册到 registry，`login` 增加选项。按形状接近度排序：

- **豆包（火山方舟）**：形状与 GLM 最接近（都是 OpenAI 兼容 `/images/generations`，返回 URL/b64），adapter 基本是 GLM 的复制 + 改 sizeConstraints + 改 base url。预估 2-3 人天。
- **Qwen-Image（阿里千问团队）**：走 dashscope，形状待确认，可能需要异步轮询。预估 2-4 人天。
- **通义万相 Wan（阿里万相实验室）**：dashscope，支持图像编辑（Wan 2.6），异步任务模式（提交拿 task_id → 轮询）。taskPoller 基础设施已在阶段一就位，adapter 内部 `await runAsyncTask({...})` 即可。预估 2-3 人天。

## 风险与开放问题

1. **GLM 编辑能力有明确缺口**：mask 局部重绘确认不支持（智谱全系列无 mask inpainting），带 mask 的编辑请求只能报错。全图编辑可经 GLM-4V chat 接口实现，但形状差异大、效果依赖自然语言理解，质量不稳定。这是本轮 MVP 的已知功能边界，文生图（核心价值）不受影响。

2. **参数保真 vs 用户体验**：报错策略下，用户设了 transparent 调 GLM 会直接报错。错误信息要足够清晰（指明哪个参数、为什么、怎么改），否则用户会困惑「为什么同样的设置在 OpenAI 能用在 GLM 不行」。

3. **size 规整的尺寸偏差**：GLM 的 size 是软推荐（4 条硬规则），满足硬规则的尺寸直接透传，不满足的会被规整（对齐 32 倍数 + 钳制范围 + 压像素上限），实际生成尺寸可能与用户设的不完全一致。翻译层应在规整后把最终 size 记录到日志，方便排查。`auto` 始终映射为 GLM 默认 `1280x1280`。

4. **provider 模型 ID 漂移**：智谱模型 ID（`glm-image`、`cogview-4` 等）会随版本更新。`login` 时让用户可填自定义 model ID，不写死在 adapter 里，降低漂移影响。

5. **本轮不做多 profile 持久化**：`login` 是覆盖式，切换 provider 要重新输凭据。如果后续用户频繁在 OpenAI / GLM 间切换，这会变成痛点，届时再引入 `use <provider>` + 多 profile 存储。

6. **URL→b64 的稳定性**：GLM 返回的图片 URL 有时效性。companion 必须在拿到 URL 后立即 fetch 转换，不能缓存 URL 稍后用。urlToB64 工具要带超时和重试，避免 GLM 侧 URL 失效导致整条生成失败。

## 成本估算

| 阶段 | 内容 | 估算 |
|------|------|------|
| 阶段一 | adapter 骨架 + openai 抽取 + provider 元信息回流 + taskPoller 基础设施（零行为变化） | 2.5-3 人天 |
| 阶段二 | GLM 文生图 adapter + login/status 改造 + urlToB64 + 测试 + 联调 | 3-4 人天 |
| 阶段三 | GLM 全图编辑 adapter（可选，经 GLM-4V chat 翻译） | 2-3 人天（不做则 0） |
| **合计（本轮 MVP）** | **GLM generate 打通，edit 视情况** | **7-10 人天** |

后续每增加一个 provider，成本约 2-3 人天（写 adapter + 测试 + 联调）。通义万相虽是异步轮询型，但 taskPoller 基础设施已在阶段一就位，不再额外增加成本。

## 参考依据

- 智谱 GLM-Image 模型说明：https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image
- 智谱 API OpenAPI 规范（size 约束的权威来源，字段无 enum）：https://docs.bigmodel.cn/openapi/openapi.json
- 智谱图像生成 API 参考：https://docs.bigmodel.cn/api-reference/模型-api/图像生成
- 智谱 OpenAI 兼容接口说明：https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
- 阿里云百炼文本生成图像（Qwen-Image / 通义万相对照）：https://help.aliyun.com/zh/model-studio/text-to-image
- 现有 companion 设计：`docs/companion.md`
- 安全边界决策：`docs/decisions/002-companion-security-boundary.md`
- 连接模式决策：`docs/decisions/003-connection-modes.md`
