# Companion 豆包（Seedream）Provider 开发方案

更新日期：2026-06-26（联调完成）

## 背景

`companion-providers-plan.md` 阶段四排了三个后续 provider，按形状接近度排序，豆包（火山方舟 Seedream）排第一——它和 GLM 一样走 OpenAI 兼容的 `/images/generations` 端点、同样返回 `data[0].url`、同样用 `Bearer` 鉴权。

但实际调研豆包 API 后发现：**豆包不能简单复制 GLM adapter**。它和 GLM 在三个维度上有本质差异，必须有一套独立的 adapter：

1. **size 约束模型完全不同**：豆包不是「单边范围 + 步长对齐」，而是「总像素范围 [下限, 上限] + 宽高比范围 [1/16, 16]」，且有**像素下限**（GLM 无下限）。这个差异会反向影响 web 端通用尺寸逻辑。
2. **原生支持图生图（SeedEdit）**：豆包有独立的图像编辑能力（参考图作为 `image` 字段），这是它相对 GLM 的差异化价值（GLM 全图编辑已确认不做）。本轮要做。
3. **请求/响应字段有豆包特有项**：`watermark`（默认带水印，要关掉）、`response_format`（支持直接要 b64，可跳过 URL→b64 转换）。

本方案是豆包 adapter 的设计依据，落地路径遵循 `companion-providers-plan.md` 已确立的「provider 元信息回流 + capability 驱动 UI」架构。

## 豆包 Seedream API 形状

### 文生图（generate）

```text
POST https://ark.cn-beijing.volces.com/api/v3/images/generations
Authorization: Bearer <火山方舟 API Key>
Content-Type: application/json

{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "...",
  "size": "2048x2048",
  "response_format": "b64_json",
  "watermark": false
}
```

返回（`response_format=b64_json` 时）：

```json
{
  "data": [{ "b64_json": "..." }]
}
```

返回（`response_format=url` 时，与 GLM 一致）：

```json
{
  "data": [{ "url": "https://..." }]
}
```

### 与 OpenAI / GLM 的差异对照

| 维度 | 豆包 Seedream | OpenAI Images API | GLM-Image |
|------|--------------|-------------------|-----------|
| 端点 | `/api/v3/images/generations` | `/images/generations` | `/paas/v4/images/generations` |
| 鉴权 | `Bearer` | `Bearer` | `Bearer` |
| 请求体 | `{ model, prompt, size, response_format, watermark }` | `{ model, prompt, size, background, output_format }` | `{ model, prompt, size }` |
| size 约束 | 总像素范围 + 宽高比（见下） | 枚举尺寸 + auto | 单边范围 + 32 步长 |
| 返回 | `data[0].b64_json`（可要求）或 `data[0].url` | `data[0].b64_json` | `data[0].url` |
| 水印 | 默认 `watermark=true`，要显式关 | 无 | 无 |
| 图生图 | 原生支持（SeedEdit / `image` 字段） | `images/edits` multipart | 不支持 |

### 豆包 size 约束（核心差异，必读）

豆包的 size 不是「单边范围 + 步长」，而是**双约束**：

**硬约束（违反会被拒）：**

1. 总像素 `width × height` 必须在 **[3,686,400, 16,777,216]** 之间
   - 下限 3,686,400 ≈ 1920×1920（约 2K²）
   - 上限 16,777,216 = 2²⁴（约 4K²）
2. 宽高比 `width/height` 必须在 **[1/16, 16]** 之间
3. size 取值格式：`宽x高`（如 `2048x2048`）或分辨率档字符串 `2K`/`3K`/`4K`

**关键差异：豆包有像素下限，且有 web 不认识的「3K」原生档位。**

把 web 现有的 1K/2K/4K 预设往豆包上套，会出两个问题：

| web 分辨率档 | targetPixels | 豆包下限 3,686,400 | 豆包是否接受 |
|-------------|-------------|-------------------|-------------|
| 1K | 1,048,576 | ❌ 低于下限 | 拒绝 |
| 2K | 4,194,304 | ✅ 刚过下限 | 接受 |
| 4K | 8,294,400 | ✅ 在范围内 | 接受 |

- 1K 档会被豆包拒（低于下限）——规则过滤能把它隐藏掉。
- 但豆包自己有原生 **3K** 档（web 根本没有这个选项），规则过滤**加不出来**。

更根本的问题是：当前 web 把 1K/2K/4K 写死、再用 `maxPixels` 过滤，本质是「web 定死选项，companion 只能减不能加」。GLM 那条「真正的 2K 只有 1:1，其他比例都是伪 2K」就是这种模型的副作用——档位标签是 web 强加的，不是 provider 的真实能力。

→ 因此本方案把「分辨率档位」升级为 **companion 声明、web 渲染**：每个 provider 直接声明自己支持哪几档，web 不再写死也不再过滤（见「核心设计决策 D1」）。豆包自然声明 [2K, 3K, 4K]，既隐藏了不支持的 1K，又补出了原生 3K。

**默认尺寸**：豆包推荐 `2048x2048`（2K 正方形，刚好在下限之上、是豆包最稳定的档位）。

### 模型 ID 漂移

豆包 model ID 形如 `doubao-seedream-5-0-260128`（带日期版本号），会随版本更新。和 GLM 一样，`login` 时让用户填自定义 model ID，不写死在 adapter。文档里的具体 ID 只是示例。

> **联调确认**：火山方舟的 `model` 字段填的是**模型名**（`doubao-seedream-5-0-260128`），不是推理接入点 ID（`ep-xxxxx`）。两种方式火山方舟都支持——模型名直接调用更简单，接入点 ID 用于需要指定特定部署/版本的场景。本项目用模型名。

### 返回结构（联调确认）

豆包 generate 返回的 `data[0]` 只有 `b64_json` 和 `size` 两个字段，**没有 `revised_prompt`**——豆包 Seedream 原样用用户给的 prompt 生成，不返回优化后 prompt（这与 OpenAI gpt-image 不同，gpt-image 会返回 `revised_prompt`）。因此 adapter 的 `OpenAIImageResult.revisedPrompt` 对豆包恒为 undefined，web 端不会展示优化后 prompt。

### 图生图（edit / 全图编辑，联调确认）

**联调发现**：豆包**没有独立的 `/images/edits` 端点**（返回 404）。图生图和文生图共用 `/images/generations`，靠请求体里带不带 `image` 字段区分——带 `image` 就是图生图，不带就是文生图。这是国产 API 常见做法（参考图直接塞进 generate 请求）。

```text
POST https://ark.cn-beijing.volces.com/api/v3/images/generations   # 同文生图端点
Authorization: Bearer <API Key>
Content-Type: application/json                                       # JSON，不是 multipart

{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "编辑指令",
  "size": "2048x2048",
  "image": "data:image/png;base64,<参考图 base64>",                   # 参考图作为 JSON 字段
  "response_format": "b64_json",
  "watermark": false
}
```

返回与文生图一致（`data[0].b64_json`，无 `revised_prompt`）。

特点：

- **支持全图编辑**（无 mask）：参考图 + 自然语言指令，改风格、换背景、增删元素。
- **不支持 mask 局部重绘**：与 GLM 一样，国产模型普遍缺这个能力。`capability.mask=false`。
- **形状与 OpenAI edits 不同**：OpenAI 用 multipart `image[]`，豆包用 JSON `image`（单张、base64 data URL）。adapter 在 `edit()` 里负责这个形状转换。
- 豆包不认的文本字段（background/output_format 等）adapter 已裁掉；`editExtra` 不再透传（豆包 edit 是 JSON，web 的 stream/partial_images 等字段对豆包无意义）。

> **联调过程中的修正**：最初 adapter 按火山方舟文档描述实现成 multipart 打 `/images/edits`，实际返回 404。改打 `/images/generations` + JSON `image` 字段后跑通。这是「文档描述与真实行为不符、以真实 4xx 为准」的典型案例，见风险条目。

## 目标

### 产品目标

- 用户在 companion CLI 配置豆包（火山方舟）凭据后，Web 端无需改动即可文生图。
- 豆包支持图生图，Web 端带参考图的编辑请求能经豆包 SeedEdit 跑通（无 mask 的全图编辑）。
- Web 端体验与连接 GLM / OpenAI 时一致：同样的输入框、同样的参数、同样的生成/编辑/重试流程。
- 用户设的参数如果豆包不支持，companion 返回明确错误，而不是静默丢弃或带水印生成。

### 技术目标

- 豆包是**独立 adapter**（`providers/doubao.ts`），不复用 GLM adapter，但复用同一套 `ProviderAdapter` 契约和基础设施（`urlToB64` / `multipart` 解析）。
- `SizeConstraints` 的 `minPixels` 字段被 web 通用逻辑正式启用（GLM 阶段它恒为 0，没被真正消费）。
- 现有安全边界全部保留：只监听 `127.0.0.1`、配对 token、Origin 白名单、日志脱敏、凭据 `0600`。

## 非目标

- 不做 mask 局部重绘（豆包不支持，`capability.mask=false`）。
- 不做服务端图片格式转码（PNG↔webp）。
- 不做 `providers` CLI 命令（本轮可选，不阻塞）。
- 不做多 provider profile 持久化切换（`login` 仍是覆盖式写入）。
- 不做异步轮询（豆包文生图是同步接口，taskPoller 基础设施本轮不启用）。
- 不改 `imagesApi.ts` 的请求构造/响应解析主流程。
- D1 重构**统一档位来源**：走 companion 的 provider 一律由 companion 声明（web 删除写死档位 + `availableResolutionValues` 运行时过滤），只有 direct/本地配置走 web 兜底默认。GLM 的 4K 运行时过滤特判随之删除——GLM 4K 不显示，是因为 GLM adapter 声明里就没 4K。`dimensionsForRatio`（比例 + 档 → 具体尺寸）的计算逻辑本身不动。
- D1b 的 minPixels 校验**复用已有逻辑**（`getCustomSizeError` 早已判断 minPixels），不新增校验分支。
- D4 的 edit 不透传 `editExtra`（豆包 edit 是 JSON 形式，web 的 stream/partial_images 等字段对豆包无意义；OpenAI 链路仍透传 editExtra，不受影响）。

## 核心设计决策

### D1：分辨率档位改为 companion 声明、web 渲染（取代规则过滤）

**现状的问题**：web 把 1K/2K/4K 写死，用 `availableResolutionValues(maxPixels)` 按 maxPixels 过滤。这是「web 定死选项，companion 只能减」的模型。它有两个副作用：

1. **减得出，加不出**：GLM maxPixels=4M 能隐藏 4K，但豆包有原生 3K 档——web 根本没有这个选项，过滤模型加不出来。
2. **标签不诚实**：档位是 web 强加的目标像素，不反映 provider 真实能力。GLM「真正的 2K 只有 1:1，其他比例都是伪 2K」就是这种副作用——`dimensionsForRatio` 算出来的非正方形尺寸像素其实不到 2K，但 UI 仍标 2K。

**决策**：把分辨率档位从「web 写死 + 过滤」统一升级为「**companion 声明、web 渲染**」。**只要走 companion 的 provider，档位一律由 companion 声明，web 不再写死、不再运行时过滤；只有直连/前端本地配置（direct 模式、未回流）才用 web 兜底的写死默认。**

- 每个 provider adapter 声明自己支持的分辨率档列表（含 label + targetPixels）——声明什么是每个 provider 自己的真实能力，不是「为了不破坏现状而凑出来的值」。
- `/auth/status` 回流这个列表（新增字段，见「回流字段扩展」）。
- web 删掉写死的 `SIZE_RESOLUTION_OPTIONS`、删掉 `availableResolutionValues`（那个专门给 GLM 按 maxPixels 运行时过滤 4K 的逻辑），改为直接渲染 companion 上报的档位。
- direct 模式 / companion 离线 / 未回流时，web 回退到本地兜底默认（OpenAI 形状的 [1K, 2K, 4K]）。

**各 provider 的档位声明**（各自的真实能力）：

| provider | 声明档位 | 说明 |
|----------|---------|------|
| OpenAI | 1K / 2K / 4K | OpenAI/gpt-image-2 的真实档位 |
| GLM | 1K / 2K | GLM maxPixels=4M，真实只到 2K（4K 原本就生成不了） |
| 豆包 | 2K / 3K / 4K | 豆包有像素下限，1K 达不到；有原生 3K |

> 这个表不再以「和改动前一致」为约束——那是保守改法的思维残留。统一机制后，OpenAI/GLM 声明什么就是它们的真实能力，恰好和改动前可见档位吻合是自然结果，不是刻意凑出来的。GLM「真正的 2K 只有 1:1、其他比例是伪 2K」那个标签不诚实问题，根源就在于档位是 web 强加的目标像素、不是 provider 声明的——统一机制后天然消失。

**为什么要顺手把 OpenAI/GLM 也改了**：只要走 companion 就一律由 companion 配置，不再写死——这是一条干净的架构原则。如果只让豆包走新机制、OpenAI/GLM 还走旧的写死+过滤，UI 就有两套分支逻辑（按 provider 判断走哪条路），比统一模型更脆。统一后删掉 `availableResolutionValues` 这个 band-aid 和 GLM 4K 过滤的特判逻辑，代码更干净。

### D1b：minPixels 在「自定义尺寸」路径的处理

档位由 companion 声明后，预设档路径（选比例 + 选档）天然合规——因为声明的档位 targetPixels 本就在 provider 的合法区间内。

但「自定义尺寸」路径（用户手输宽高）仍需要 minPixels 校验：

- web 的 `getCustomSizeError` **已有** `pixels < c.minPixels` 的判断（`imagesApi.ts:872`），GLM 因 minPixels=0 从未触发，豆包 minPixels≈3.6M 时自动生效，**无需改逻辑，补测试即可**。
- `dimensionsForRatio`（比例 + 档 → 具体尺寸）无需「抬到 minPixels」逻辑了，因为它输入的 targetPixels 来自 companion 声明的合法档，算出的像素天然 ≥ 该档 targetPixels ≥ provider minPixels。

→ 相比原 D1 草案，这个版本**不用动 `dimensionsForRatio` 的抬升逻辑**，复杂度更低。minPixels 只在自定义尺寸的实时校验里生效。

### D2：文生图直接要 b64_json，跳过 URL→b64

**问题**：豆包支持 `response_format=b64_json` 直接返回 base64，也支持 `url`。

**决策**：adapter 请求时固定带 `response_format: "b64_json"`，直接拿 base64，**跳过 URL→b64 转换**。

理由：

- 少一次网络往返（URL 有时效，GLM 必须立即 fetch，豆包可避免）。
- 链路更简单、更稳定（urlToB64 的超时/重试逻辑对豆包不触发）。
- 与 OpenAI 形状的 `data[0].b64_json` 契约天然吻合。

`urlToB64` 工具保留（GLM 还在用），豆包 adapter 只是**不调用**它。若联调发现豆包的 `b64_json` 有体积/兼容问题，回退到 `url` + urlToB64（一行改动）。

### D3：watermark 固定关掉

豆包默认 `watermark=true`（生成图带「AI 生成」水印）。adapter 请求时固定带 `watermark: false`。这不作为参数暴露给 web（web 端无水印概念），是 adapter 内部行为。

### D4：图生图 edit 走 /generations + image 字段（联调确认，非独立 edits 端点）

**联调发现**：豆包**没有独立的 `/images/edits` 端点**（返回 404）。图生图和文生图共用 `/images/generations`，靠请求体里带不带 `image` 字段区分。

adapter 的 `edit()` 收到结构化的 `OpenAIImageEditRequest`，把 `images[0]` 转成 base64 data URL 塞进 `/generations` 的 JSON `image` 字段，**不走 multipart**（这是和 OpenAI edits 形状的关键差异——OpenAI 用 multipart `image[]`，豆包用 JSON `image`）。

- `capability.edit = true`，`capability.mask = false`。
- 带 mask 的编辑请求：route 层 `if (parsed.mask && !adapter.capability.mask)` 返回 400「不支持遮罩局部编辑」（这套逻辑阶段一已就位，豆包复用）。
- 无 mask 的全图编辑：豆包 adapter `edit()` 走 `/generations` + `image` 字段。

豆包返回结构与文生图一致：`data[0].b64_json`（无 `revised_prompt`，豆包不返回优化后 prompt，与 OpenAI gpt-image 不同）。

### D5：size 的 `2K/3K/4K` 档字符串 vs `宽x高`

豆包 size 接受两种格式：分辨率档（`2K`）和具体尺寸（`2048x2048`）。

**决策**：adapter 发给豆包的请求体**始终是 `宽x高` 具体尺寸**，**不发档字符串**。理由：

- web 端的尺寸逻辑（`dimensionsForRatio`）算出的就是具体 `宽x高`，adapter 透传即可。
- 档字符串会让模型自己决定宽高，web 端的「比例」选择就失去意义（用户选了 16:9 却发 `2K`，宽高由模型定）。
- 具体尺寸行为可预测、可复现，便于排查。

注意这和 D1「companion 声明档位」不冲突：D1 的档位是给 **web UI 渲染选项**用的（用户看到的 2K/3K/4K 按钮），adapter 发给豆包的请求体里仍然是 web 算好的具体 `宽x高`（例如用户选 16:9 + 2K，web 算出 `3840x2160`，adapter 发 `3840x2160`）。

adapter 内部的 `normalizeDoubaoSize` 只处理：`auto` → 默认 `2048x2048`；`宽x高` → 钳总像素范围 + 宽高比范围。无步长对齐（豆包 step=1，见 D6）。

### D6：豆包 step=1，等于无步长约束

OpenAI/GPT 的自定义尺寸受步长约束（step=16，宽高必须是 16 的倍数）；GLM 是 step=32。豆包无对齐要求，任意整数像素都接受。

**决策**：豆包 `sizeConstraints.step = 1`。web 的 `roundToStep` / `clampDimension` 在 step=1 时退化为「四舍五入到整数」，等于无步长约束——逻辑无需特殊处理，参数自然生效。

这也是「companion 声明、web 渲染」架构的又一次体现：步长本来就是一个 `SizeConstraints` 字段，豆包填 1，web 通用逻辑自动适配，不需要豆包专属分支。

## 能力声明

```ts
export const doubaoAdapter: ProviderAdapter = {
  id: "doubao",
  capability: {
    generate: true,
    edit: true,        // 豆包原生支持图生图（/generations + image 字段，联调确认），本轮实现
    mask: false,       // 豆包不支持 mask 局部重绘（与 GLM 一致的国产模型缺口）
    backgrounds: ["auto", "opaque"],        // 豆包不支持透明背景
    outputFormats: ["png", "jpeg"],         // 不含 webp（Seedream 主力输出 png/jpeg）
  },
  sizeConstraints: {
    step: 1,                   // ★ D6：豆包无步长对齐，step=1 等于无约束（GPT=16, GLM=32）
    min: 512,                  // 单边软下限（豆包靠总像素+宽高比约束，单边无硬下限，取一个合理值兜底）
    max: 4096,                 // 单边软上限（总像素上限 2^24 决定，4096 是安全值）
    maxPixels: 16777216,       // 2^24，豆包总像素上限
    minPixels: 3686400,        // 豆包总像素下限（约 1920²），自定义尺寸路径校验用（D1b）
    maxAspectRatio: 16,        // 宽高比上限 [1/16, 16]
    defaultSize: "2048x2048",  // 2K 正方形，豆包最稳定档位，刚过下限
  },
  // ★ D1：豆包原生支持的分辨率档位（companion 声明、web 渲染）
  resolutionOptions: [
    { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
    { value: "3k", label: "3K", targetPixels: 2880 * 1620 },   // 豆包原生档，web 此前没有
    { value: "4k", label: "4K", targetPixels: 4096 * 2160 },
  ],
  // ...
};
```

UI 层按这份 capability 驱动：

- 区域编辑 tag：`v-if="capability.mask"` → 豆包 `mask=false`，**整个区域编辑 tag 隐藏**（与 GLM 一致）。但普通全图编辑（带参考图、无 mask）仍可用，因为 `edit=true`。
- 背景/格式 tag：按 `capability` 过滤，豆包不显示「透明」「WebP」。
- 尺寸 tag 的**分辨率档位**：直接渲染 `resolutionOptions`，豆包显示 2K/3K/4K 三档（1K 因豆包不声明而自然消失，3K 因豆包声明而出现）。
- 尺寸 tag 的**自定义尺寸**：step=1 生效，用户可输任意整数像素；minPixels≈3.6M 时低于下限实时报错。

> 3K 档的 targetPixels 取 `2880×1620 = 4,665,600`（16:9 下的 3K 标准），落在豆包 [3.6M, 16M] 区间内。具体每档的 targetPixels 由 adapter 声明，web 不再硬编码。

> **edit=true 与 mask=false 的 UI 含义**：现有 UI 里「带参考图的编辑」和「mask 区域编辑」是两个独立开关。豆包 `edit=true` 让前者可用，`mask=false` 让后者隐藏。需要确认 web 端这两个开关确实独立（见「改动点」审查项）。

## 回流字段扩展（/auth/status）

D1 要求 companion 把分辨率档位上报给 web。在现有 `CompanionAuthStatus` 基础上新增 `resolutionOptions` 字段：

```jsonc
{
  "provider": "doubao",
  "model": "doubao-seedream-5-0-260128",
  "mode": "api_key",
  "ready": true,
  "accountLabel": "xxx***",
  "sizeConstraints": { /* 如上，step=1, minPixels=3686400, ... */ },
  "capability": { /* 如上，edit=true, mask=false, ... */ },
  "resolutionOptions": [                          // ★ 新增（D1）
    { "value": "2k", "label": "2K", "targetPixels": 4194304 },
    { "value": "3k", "label": "3K", "targetPixels": 4665600 },
    { "value": "4k", "label": "4K", "targetPixels": 8847360 }
  ]
}
```

- OpenAI adapter 声明 `[1k, 2k, 4k]`（OpenAI 真实档位）。
- GLM adapter 声明 `[1k, 2k]`（GLM 真实能力，maxPixels=4M 决定它到不了 4K）。
- 豆包 adapter 声明 `[2k, 3k, 4k]`。
- direct 模式 / companion 离线 / 未回流时，web 回退到本地兜底 `[1k, 2k, 4k]`（直连场景的默认）。

各 adapter 的 `resolutionOptions` 是它自己的真实能力声明，不是「凑成和现状一致」。`resolutionOptions` 与 `sizeConstraints.maxPixels` 的关系变为：前者是显式声明（哪些档可选），后者仍是自定义尺寸路径的像素上限校验来源，两者职责分离、不再用 maxPixels 反推档位。**专门给 GLM 按 maxPixels 过滤 4K 的 `availableResolutionValues` 函数整个删除**——GLM 4K 不显示，是因为 GLM adapter 声明里就没 4K，不再靠运行时过滤。

## 改动点

### Companion 侧

| 文件 | 改动 | 阶段 |
|------|------|------|
| `companion/src/providers/types.ts` | `ProviderAdapter` 增加 `resolutionOptions` 字段（含 value/label/targetPixels） | A |
| `companion/src/providers/openai.ts` | 声明 `[1k, 2k, 4k]`（等价现状） | A |
| `companion/src/providers/glm.ts` | 声明 `[1k, 2k]`（等价现状过滤结果） | A |
| `companion/src/providers/doubao.ts` | **新增**：豆包 adapter。generate（裁剪 + size 规整 + 固定 `response_format=b64_json` + `watermark=false`）；edit（SeedEdit 翻译）；声明 sizeConstraints(step=1) + capability + `resolutionOptions=[2k,3k,4k]` | A |
| `companion/src/providers/registry.ts` | 注册 `doubao: doubaoAdapter` | A |
| `companion/src/main.ts` | `PROVIDER_PRESETS` 加豆包预设（默认 base url + 默认 model + label） | A |
| `companion/src/routes/auth.ts` | `/auth/status` 返回当前 adapter 的 `resolutionOptions` | A |
| `companion/src/types.ts` | `CompanionAuthStatus` 增加 `resolutionOptions` 字段 | A |
| `companion/src/providers/doubao.test.ts` | **新增**：generate/edit 翻译、size 规整、watermark/response_format 断言、resolutionOptions 回流 | A |
| companion 既有测试 | openai/glm 的 auth 回流测试补 `resolutionOptions` 断言 | A |

豆包 adapter **不需要**新增 multipart 解析器（复用 `providers/multipart.ts`）、**不需要** urlToB64（D2）、**不需要** taskPoller（同步接口）。

### Web 侧（D1：档位渲染 + D1b：自定义 minPixels 校验）

| 文件 | 改动 | 阶段 |
|------|------|------|
| `src/types/companion.ts` | `CompanionAuthStatus` 增加 `resolutionOptions` 字段（与 companion 对齐） | B |
| `src/stores/settingsStore.ts` | 删除写死的 `SIZE_RESOLUTION_OPTIONS` 和 `availableResolutionValues`；`sizeResolutionOptions` 改为读 companion 回流的 `resolutionOptions`（离线回退 OpenAI 默认 `[1k,2k,4k]`）；`applyProviderInfo` 写入 resolutionOptions；当前选中档不在新列表则回退第一个可用档 | B |
| `src/services/imagesApi.ts` | `getCustomSizeError` 的 minPixels 判断**已就位**，无需改 | B |
| `src/stores/settingsStore.test.ts` | 补：companion 回流 resolutionOptions 后渲染正确档位（OpenAI→[1k,2k,4k]、GLM→[1k,2k]、豆包→[2k,3k,4k]）；离线/direct 回退默认 [1k,2k,4k]；选中档被移除时回退第一个可用档；豆包 minPixels 下自定义尺寸报错 | B |
| `src/services/imagesApi.test.ts` | 补豆包约束用例（minPixels=3686400）：低于下限报错、刚好下限通过 | B |

> **审查项**：确认 web 端「带参考图编辑」与「mask 区域编辑」是两个独立开关。若当前实现把「带参考图」耦合在「区域编辑」tag 里（即 `mask=false` 会连普通编辑一起隐藏），需要先解耦，否则豆包 `edit=true, mask=false` 的组合会让用户无法发起全图编辑。这是 D4 能否落地的 UI 前提，阶段 A 前先审查 `ComposerParameterBar.vue` / `useStudioViewModel.ts`。

### 测试（联调，待用户侧）

真实火山方舟 API Key 联调，覆盖手动清单（见下）。

## 架构（落地后）

```text
companion/src/providers/
  doubao.ts        # ★ 新增：豆包 Seedream adapter（generate + edit）
  registry.ts      # 注册 doubao
  types.ts         # 增加 resolutionOptions 字段（D1）
  multipart.ts     # 不动（route 层复用，豆包 edit 收结构化字段）
  urlToB64.ts      # 不动（豆包本轮不调用，D2）
  glm.ts / openai.ts / taskPoller.ts  # openai/glm 声明 resolutionOptions（等价现状）
```

```text
routes/images.ts（无改动，已统一走 resolveAdapter()）
  provider=doubao
    generate → doubaoAdapter.generate()
      → POST ark.../images/generations { model, prompt, size, response_format:"b64_json", watermark:false }
      → data[0].b64_json 直接返回（不经 urlToB64）
    edit     → doubaoAdapter.edit()
      → POST ark.../images/edits (multipart: image=images[0], model, prompt, response_format, watermark)
      → data[0].b64_json
```

## CLI 命令

### `login`（增加豆包选项）

交互流程不变，`PROVIDER_PRESETS` 加一项：

```text
选择 Provider：
  1. OpenAI 兼容（gpt-image-2 / 中转站）
  2. GLM-Image（智谱 Zhipu）
  3. 豆包 Seedream（火山方舟 ByteDance）   # ★ 新增
```

豆包预设：

- defaultBaseUrl: `https://ark.cn-beijing.volces.com/api/v3/images`
- defaultModel: `doubao-seedream-3-0-t2i-250415`（示例，用户可改）

### `status`（自动支持）

现有逻辑已按 `PROVIDER_PRESETS` 查 label，豆包加进去后 `status` 自动显示 `Provider: 豆包 Seedream（火山方舟 ByteDance）`，无需额外改。

## 安全

全部沿用现有安全设计，无新增风险（与 GLM adapter 一致）：

- 只监听 `127.0.0.1`，配对 token + Origin 白名单。
- 日志脱敏：`Authorization` header（`Bearer`）在 redact 范围。
- 凭据文件 `0600`。
- 翻译层在 companion 内部完成，真实 API key 永远不出 companion。
- D2 决策下豆包链路不经 URL→b64，连「URL 时效性 fetch」这一环都省了，反而比 GLM 链路更少外部依赖。

## 测试策略

### Companion 单元测试（`doubao.test.ts`）

- `normalizeDoubaoSize`：auto→默认、宽x高透传、低于 minPixels 抬升、高于 maxPixels 压缩、宽高比超 16 规整、比例格式（16:9）→尺寸
- generate 翻译：请求体只含 model/prompt/size/response_format/watermark，**断言 watermark=false、response_format=b64_json**，丢弃 background/output_format/extra
- generate 响应：`data[0].b64_json` 直接取，不走 urlToB64（断言不调用）
- generate 错误：上游 4xx/5xx、响应无 b64_json、连接断开
- edit 翻译：images[0]→参考图、multipart 构造、mask 存在时由 route 层拦截（adapter 不处理 mask）
- registry：provider=doubao 解析到 doubaoAdapter
- /auth/status 回流：豆包 sizeConstraints + capability 正确返回

### Web 单元测试

- `settingsStore`：companion 回流 resolutionOptions 后渲染正确档位（OpenAI→[1k,2k,4k]、GLM→[1k,2k]、豆包→[2k,3k,4k]，各 provider 声明的是自己的真实能力）；direct/离线回退默认 [1k,2k,4k]；选中档被移除时回退第一个可用档；`availableResolutionValues` 已删除、不再存在 maxPixels 运行时过滤
- `imagesApi` getCustomSizeError：豆包约束（minPixels=3686400）下低于下限报错、刚好下限通过、step=1 时任意整数像素不报步长错

### 手动联调清单 ✅ 已完成（真实火山方舟 Key）

- [x] `gpt-image-studio login` 选豆包，配置真实火山方舟 API Key + model `doubao-seedream-5-0-260128`
- [x] `gpt-image-studio start` + 网页配对（复用已有 session）
- [x] 参数栏模型标签显示豆包 model（验证 provider 元信息回流）
- [x] 参数栏「区域编辑」tag 隐藏（豆包 mask=false）
- [x] 参数栏「背景」不含「透明」、「格式」不含「WebP」
- [x] 参数栏分辨率档显示 **2K / 3K / 4K**（验证 D1：1K 因豆包不声明而消失，3K 因豆包声明而出现）
- [x] 文生图：确认返回的 b64_json 正常显示，**无水印**（验证 watermark=false）
- [x] 图生图（无 mask）：带 1 张参考图 + 编辑指令，跑通（经 `/generations` + image 字段，联调修正）
- [ ] 文生图选 3K 档：确认豆包原生 3K 正常生成（web 此前没有的档位）——联调时主要测了 2K，3K 档逻辑一致待补验
- [ ] 文生图自定义尺寸设低于 minPixels：确认 web 端即时报错，不发请求——逻辑已测（单测覆盖），手动补验
- [ ] 文生图自定义尺寸设任意像素（如 2345x1234，非步长倍数）：确认豆包接受（验证 step=1）——逻辑已测，手动补验
- [ ] 带 mask 的编辑：确认报「不支持遮罩局部编辑」，错误信息清晰——route 层逻辑已就位，手动补验
- [ ] **切回 openai：确认分辨率档为 1K / 2K / 4K**——逻辑已测（单测覆盖），手动补验
- [ ] **切回 glm：确认分辨率档为 1K / 2K**——逻辑已测，手动补验
- [ ] **切到 direct 模式：确认分辨率档为 1K / 2K / 4K**——逻辑已测，手动补验

> 核心链路（文生图 + 图生图 + 元信息回流 + 档位渲染）已联调通过。剩余打勾项是 UI 细节补验，逻辑层均有单测覆盖；可在日常使用中顺带验证。

## 分阶段计划

### 阶段 A：companion 侧 adapter + resolutionOptions 回流 ✅ 已完成

- [x] `providers/types.ts` 增加 `ResolutionOption` 类型 + `resolutionOptions` 字段
- [x] openai / glm adapter 声明各自的 resolutionOptions（OpenAI [1k,2k,4k] / GLM [1k,2k]）
- [x] 新增 `providers/doubao.ts`（generate + edit + sizeConstraints(step=1) + capability + resolutionOptions=[2k,3k,4k]）
- [x] `normalizeDoubaoSize` 纯函数 + 单测
- [x] registry 注册 doubao
- [x] `routes/auth.ts` + `types.ts` 回流 resolutionOptions
- [x] main.ts `PROVIDER_PRESETS` 加豆包预设
- [x] doubao.test.ts(25) + openai/glm auth 回流补 resolutionOptions 断言
- [x] tsc + build 干净（companion 全量 98 测试通过）

### 阶段 B：web 侧档位渲染（D1）+ 自定义 minPixels 校验（D1b）✅ 已完成

- [x] 审查「带参考图编辑」与「mask 区域编辑」是否独立开关 → **结论：独立**（generate vs edit 由 `referencedImageIds.length` 决定，mask 可选，`editModeEnabled` 只管 mask 流程）。豆包 `edit=true, mask=false` 直接可用，无需解耦。
- [x] `types/companion.ts` 增加 resolutionOptions + `SizeResolution` 放开为 string（让 3k 能进）
- [x] `settingsStore` 删除写死档位 + `availableResolutionValues`，改读 companion 回流（离线回退 OpenAI 默认）
- [x] applyProviderInfo 写入 resolutionOptions + 选中档回退（离线/切换 provider 都处理）
- [x] 补 settingsStore.test.ts / imagesApi.test.ts 用例（豆包档位 [2k,3k,4k]、minPixels 校验、离线回退）
- [x] web 全量 216 测试通过、vue-tsc 干净

### 阶段 C：联调 ✅ 已完成（真实火山方舟 Key）

- [x] 文生图跑通：`doubao-seedream-5-0-260128` + b64_json 返回正常，无水印
- [x] 图生图跑通：edit 走 `/generations` + JSON `image` 字段（联调修正，原 `/images/edits` 返回 404）
- [x] 参数栏回流验证：模型标签、档位 [2k,3k,4k]、区域编辑隐藏、背景/格式过滤
- [x] 切换 provider 档位恢复验证
- [x] 确认豆包**不返回 `revised_prompt`**（`data[0]` 只有 b64_json + size）

**联调过程的关键修正**（已固化到代码 + 文档）：
1. **model 名**：文档示例的 `doubao-seedream-3-0-t2i-250415` / `doubao-seedream-5-0-lite` 都无效，真实名 `doubao-seedream-5-0-260128`（火山方舟用模型名，非 endpoint id）。
2. **edit 端点**：文档描述的 multipart `/images/edits` 不存在（404），实际共用 `/images/generations` + JSON `image` 字段。adapter 已改，废弃的 multipart 构造器已删。

## 成本估算

| 阶段 | 内容 | 估算 |
|------|------|------|
| 阶段 A | 豆包 adapter（generate + edit）+ resolutionOptions 全 provider 声明 + 回流 + CLI 预设 + 单测 | 2.5-3 人天 |
| 阶段 B | web 档位渲染重构（D1）+ 自定义 minPixels 校验（D1b，逻辑已就位仅补测试）+ 测试 | 1-1.5 人天 |
| 阶段 C | 联调（待用户侧，需真实 Key） | — |
| **合计** | **豆包 generate + edit 打通 + 分辨率档统一为 provider 声明** | **3.5-4.5 人天** |

比原 D1 草案（3-4 人天）略增，增量来自 D1 统一档位机制——删掉 `availableResolutionValues` band-aid、删掉 GLM 4K 运行时过滤特判、解决 GLM「伪 2K」标签不诚实问题、为后续 provider（通义万相/Qwen）铺路。这是一笔主动的架构改进，不是「为了不破坏现状的妥协」。

## 风险与开放问题

1. **D1 重构改变了 OpenAI/GLM 的实现路径**：把分辨率档从「web 写死 + maxPixels 过滤」改成「provider 声明」，OpenAI/GLM 的实现路径变了（不再走 `availableResolutionValues` 过滤），但它们声明的档位就是各自真实能力，和用户原本看到的吻合是自然结果而非刻意凑值。测试重点：各 provider 声明的档位正确、direct/离线回退默认档位正确、删除 `availableResolutionValues` 后无残留引用。

2. **~~edit 端点真实形状待联调确认~~**（联调已解决）：火山方舟**没有独立的 `/images/edits` 端点**（404），图生图共用 `/images/generations` + JSON `image` 字段（base64 data URL）。adapter 已按此实现并跑通。文档原描述（multipart edits）与真实行为不符，已修正。

3. **3K 档的 targetPixels 取值**：3K 是豆包原生档，web 此前没有对应预设。文档取 `2880×1620 = 4,665,600`（16:9 下的 3K 标准）。联调已验证文生图正常生成；极端比例（如 1:16 竖条）可能算出低于 minPixels 的尺寸，`getCustomSizeError` 会拦。

4. **水印策略**：固定 `watermark=false`。联调已验证无水印。若火山方舟政策变化强制带水印，adapter 需调整——但这是 provider 侧政策，不属于本轮范围。

5. **模型 ID 漂移**：豆包 model ID 带日期版本号（`260128`），会随版本更新。`login` 时用户可填自定义，降低漂移影响；adapter 不写死 model。

6. **~~b64_json 体积~~**（联调已验证）：豆包 4K 图的 b64 正常通过，未触发 companion body limit。

## 参考依据

- 火山方舟 Seedream 5.0 lite API 参考（中文官方）：https://www.volcengine.com/docs/82379/1541523
- Image generation API — ModelArk-BytePlus（英文官方）：https://docs.byteplus.com/en/docs/ModelArk/1541523
- 火山方舟模型列表：https://www.volcengine.com/docs/82379/1330310
- 现有 provider 架构：`docs/companion-providers-plan.md`
- 安全边界决策：`docs/decisions/002-companion-security-boundary.md`
- 连接模式决策：`docs/decisions/003-connection-modes.md`
