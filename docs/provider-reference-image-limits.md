# 各 Provider 参考图上传限制

本文档记录各图像生成 Provider 对参考图（reference image / 编辑输入图）的数量、大小和格式限制，
作为 Companion 能力协议和 Web 端 UI 限制的设计依据。

数据来源以官方文档为准；无法获取官方文档的 provider 标注「未确认」并注明依据。

最后更新：2026-07-23

## 限制总览

| Provider | 参考图数量 | 单张大小 | 来源 |
| --- | --- | --- | --- |
| OpenAI (gpt-image) | 无明确文档上限 | ≤ 50 MB | [官方文档][openai] |
| 豆包 Seedream 5.0 pro | 2-10 张 | ≤ 30 MB | [官方文档][doubao] |
| 豆包 Seedream 5.0 lite / 4.5 / 4.0 | 2-14 张 | ≤ 30 MB | [官方文档][doubao] |
| Qwen-Image (qwen-image-edit 系列) | 1-3 张 | ≤ 10 MB | [官方文档][qwen] |
| Wan (通义万相) | ≤ 9 张（实测，无官方文档出处） | ≤ 10 MB | 302.ai 转述 + 代码实测 |
| Gemini | 无明确文档限制 | 未确认 | — |
| Grok | 无明确文档限制 | 未确认 | — |
| DeepInfra | 无明确文档限制 | 未确认 | — |
| GLM | 不支持编辑 | — | — |

## 详细说明

### OpenAI (gpt-image-1 / gpt-image-2)

[官方文档][openai] 的编辑示例直接使用 4 张参考图（`image[]` 数组），但文档**没有写明确的数量上限**。
唯一的硬性限制是单张图片大小：

> The image to edit and mask must be of the same format and size (**less than 50MB in size**).

- 支持格式：PNG、WebP、JPG
- 参考图通过 multipart `image[]` 字段传入
- 多图示例：gift basket 场景使用 4 张商品参考图合成一张新图

**注意**：代码中 `securityConfig.maxEditImages = 16` 是 Companion 的全局安全上限，不是 OpenAI 的限制。
该数字不来源于任何 provider 的文档，是防御性配置。

### 豆包 Seedream（火山方舟）

来源：火山方舟 [图片生成 API 官方文档][doubao]（`POST /api/v3/images/generations`）。

豆包的「编辑」和「文生图」走同一个 `/generations` 端点，参考图通过 JSON body 的 `image` 字段传入，
类型为 `string / string[]`（单值或数组均可）。

**模型能力区分**：

| 模型 | 多图生图 | 交互编辑 | 组图生成 |
| --- | --- | --- | --- |
| Seedream 5.0 pro | 2-10 张参考图 | 支持（坐标/框选/箭头） | 不支持 |
| Seedream 5.0 lite | 2-14 张参考图 | — | 支持（参考图+生成图 ≤ 15 张） |
| Seedream 4.5 / 4.0 | 2-14 张参考图 | — | 支持（参考图+生成图 ≤ 15 张） |

**单张参考图要求**：

- 格式：jpeg、png、webp、bmp、tiff、gif、heic、heif
- 宽高比（宽 / 高）范围：[1/16, 16]
- 宽高长度 > 14 px
- 大小：**不超过 30 MB**
- 总像素：不超过 6000×6000 = 36,000,000 px

**生成图尺寸**（`size` 参数）：

Seedream 5.0 pro：
- 分辨率档位：`1K`、`2K`（默认 `2K`）
- 自定义宽高像素：总像素范围 [921600, 4624220]，宽高比 [1/16, 16]

Seedream 5.0 lite / 4.5 / 4.0：
- 分辨率档位：`1K`、`2K`（默认）、`3K`、`4K`

**水印**：`watermark` 参数控制，默认 `true`（Companion 代码中固定关闭）。

**输出格式**：`output_format` 支持 `png` / `jpeg`（5.0 pro 支持），默认 `jpeg`。

### Qwen-Image（阿里云百炼）

来源：阿里云 [千问图像编辑 API 官方文档][qwen]。

Qwen 走 DashScope multimodal-generation 接口，参考图通过 `messages.content` 数组的 `{image: "..."}` 传入。

**参考图限制**：

- 数量：**1-3 张**（官方文档明确）
- 单张大小：**不超过 10 MB**
- 分辨率建议：宽高均在 384-3072 px 之间
- 格式：JPG、JPEG、PNG、BMP、TIFF、WEBP、GIF（GIF 仅处理第一帧）
- 多图输入时，输出图像比例以最后一张参考图为准

**已知 bug**：代码中 `profiles/qwen.json` 的 `editConstraints.maxImages: 3` 与官方文档一致，正确。

### Wan（通义万相）

来源：302.ai 文档转述通义万相官方规则，以及代码实测。**未找到万相官方原版文档的参考图数量限制。**

- 参考图数量：≤ 9 张（代码 `profiles/wan.json` 中 `editConstraints.maxImages: 9`，来源为开发时实测）
- 单张大小：不超过 10 MB
- 格式：JPEG、JPG、PNG（无透明通道）、BMP、WEBP
- 分辨率：宽/高范围 [384, 5000] 像素

### Gemini

来源：Google AI 文档未找到对图像编辑参考图数量的明确限制。

- Gemini 走 `generateContent` API，参考图通过 `inline_data` parts 传入
- 理论上可传多张 parts，但官方文档未明确数量上限
- 代码中 Gemini adapter 全部透传，无数量校验

### Grok

来源：x.ai 文档未找到对图像编辑参考图数量的明确限制。

- Grok 走 `/images/edits` 端点，单图用 `image` 字段，多图用 `images` 数组字段
- 代码中 Grok adapter 全部透传，无数量校验

### DeepInfra

来源：DeepInfra 文档未找到对图像编辑参考图数量的明确限制。

- 走 OpenAI 兼容 multipart `image[]` 格式
- 代码中 DeepInfra adapter 全部透传，无数量校验

### GLM

- 不支持图片编辑（`capability.edit: false`）

## 与代码实现的差异

### ✅ 已修复：豆包 adapter 多图支持

此前 `createImageFieldEdit` 只取 `request.images[0]`，静默丢弃其余参考图。
现已修复为：1 张传 `image: dataUrl`（单值，向后兼容），≥2 张传 `image: [dataUrl, ...]`（数组），
与豆包官方 `image` 字段 `string / string[]` 类型一致。

同时在 `profiles/doubao.json` 声明 `editConstraints.maxImages: 10`，route 层在 adapter 解析后
按 provider 上限校验，超限返回 400「当前 provider 编辑最多支持 10 张参考图」。

详见 `companion/src/providers/openaiCompatible.ts` 的 `createImageFieldEdit` 和
`companion/src/routes/images.ts` edit 路由的 per-provider 校验。

### Provider 专属上限已由 route 层强制执行

`ProviderEditConstraints.maxImages` 现已在三个 provider profile 中声明：

| Provider | maxImages | 说明 |
| --- | --- | --- |
| 豆包 Seedream | 10 | route 层校验，超限返 400 |
| Qwen-Image | 3 | route 层校验 + adapter 内 throw 双重兜底 |
| Wan | 9 | route 层校验 + adapter 内 throw 双重兜底 |

route 层校验（`images.ts` edit 路由）在 adapter 解析后、调用 adapter.edit 之前拦截，
返回 400「当前 provider 编辑最多支持 N 张参考图」。adapter 内部的 `throw` 作为防御性兜底保留。

**注意**：`maxImages` 仍**不回流 Web**（不出现在 `/auth/status`）。
Web 端无 per-provider 实时数量提示，用户传超限图片时由 Companion 在请求阶段拒绝。
未来若要支持 capability-driven UI，可通过 `/auth/status` 暴露 `editConstraints`。

### Web 端的通用限制

`src/stores/generationStore.ts` 中硬编码了参考图**总大小** ≤ 20 MB 的限制（所有 provider 通用）：
```ts
const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;
```
这是唯一的 Web 端前置检查，只在点「生成」时触发，不在 UI 贴图时实时反馈。

Companion 侧 `securityConfig.maxEditImages = 16` 是全局图片数量安全上限，对所有 provider 一刀切。

## 参考链接

- [OpenAI Image Generation Guide][openai]
- [火山方舟 图片生成 API（豆包 Seedream）][doubao]
- [阿里云 千问图像编辑 API][qwen]

[openai]: https://developers.openai.com/api/docs/guides/image-generation
[doubao]: https://www.volcengine.com/docs/82379/1541523
[qwen]: https://help.aliyun.com/zh/model-studio/qwen-image-edit
