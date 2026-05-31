# Responses API 与流式图片预览开发方案

## 背景

GPT Image Studio 当前已经具备稳定的聊天式图片工作台体验：

- 用户通过对话提交文生图或图片编辑请求。
- 图片结果、引用图、遮罩图和聊天记录都保存在本地 IndexedDB。
- 浏览器直连模式通过 OpenAI 兼容 Images API 完成生成与编辑。
- 本地 Companion 模式通过 `127.0.0.1` 上的本地服务代理同样的图片接口。

当前实现仍有两个明显缺口：

1. 浏览器直连模式只支持传统 `Images API`，不支持 `Responses API`。
2. 页面只能在整张图片生成完成后一次性显示结果，不支持流式中间图预览。

本方案的目标是在不引入 Agent 模式的前提下，为当前工作台增加：

- `Responses API` 图片生成与编辑能力
- 流式图片预览能力

本方案优先保证对现有交互和数据模型的兼容，避免把一次接口扩展演变成整套产品形态重做。

## 参考依据

- OpenAI 官方图片生成指南：
  - https://developers.openai.com/api/docs/guides/image-generation
- OpenAI 官方 GPT Image 2 模型说明：
  - https://developers.openai.com/api/docs/models/gpt-image-2
- 本工作区参考实现：
  - `gpt_image_playground/src/lib/openaiCompatibleImageApi.ts`

其中最值得复用的设计思路是：

- `Responses API` 下不做 Agent，也可以只把 `image_generation` 当成单一图片工具使用。
- 多图生成可以继续保持“前端拆成多个并发单图请求”，不依赖单次请求的多图返回。
- 流式中间图可以只保存在运行时内存，不进入持久化层。

## 目标

### 产品目标

- 用户可以在“浏览器直连”模式下切换 `Images API` 与 `Responses API`。
- 用户可以选择是否开启“流式预览”。
- 生成中的 assistant 消息可以显示中间图预览，而不是只有骨架屏。
- 最终图片完成后，仍按当前方式写入图片库与聊天记录。

### 技术目标

- 保持当前聊天工作台、图片库、引用图编辑、遮罩编辑、多图并发、重试和刷新逻辑可用。
- 保持当前“多图 = 多 job 并发请求”的生成编排。
- 不让 `generation` store 直接依赖某一个 OpenAI API 形态。
- 为后续把流式支持扩展到 Companion 留出接口，但本轮不实现 Companion 流式。

## 非目标

以下内容明确不在本次范围内：

- 不做 Agent 模式
- 不做多轮工具调用
- 不接入 `web_search`
- 不接入函数工具或 `generate_image_batch`
- 不扩展 `fal.ai`、自定义 provider、`chat/completions`
- 不改成本地文件系统落盘
- 不做 Companion 流式转发

## 当前实现概况

### 当前连接模式

当前项目只有两种连接模式：

- `direct`
- `localCompanion`

接口模式目前只有一种隐含模式：OpenAI 兼容 `Images API`。

### 当前请求路径

浏览器直连：

- 文生图：`POST /v1/images/generations`
- 图片编辑：`POST /v1/images/edits`

本地 Companion：

- 文生图：`POST /images/generations`
- 图片编辑：`POST /images/edits`

### 当前响应方式

当前前端与 Companion 都采用“等待完整 JSON 再解析”的模式：

- 前端没有发送 `stream: true`
- 前端没有解析 `text/event-stream`
- Companion 也不是流式透传，而是整体读取上游响应后再返回

### 当前多图生成策略

当前项目并不是依赖接口层的 `n` 一次返回多张图片，而是：

- 用户设置 `imageCount`
- `generationStore` 创建多个 `GenerationJob`
- 多个 job 并发发起请求
- 同一条 assistant message 汇总多个 job 的最终结果

这个机制对于接入 `Responses API` 是有利的，因为可以先把 `Responses API` 也当作“单张图请求”来接。

## 为什么本次适合先做直连模式

本次改动涉及三个层次：

1. 设置模型与接口模式
2. 图片客户端抽象
3. 消息级流式展示

这三层都发生在 Web App 内部。只做浏览器直连可以先验证：

- `Responses API` 请求体是否稳定
- 流式中间图的用户体验是否足够好
- 现有消息聚合模型是否适合 partial image

如果这三层没有先在 Web App 内部稳定下来，就直接推动到 Companion，会把风险扩散到：

- 本地 HTTP 协议
- 安全边界
- 原始事件流透传
- 本地服务异常恢复

因此本次建议把 Companion 明确后置。

## 总体方案

本次采用“最小扩展、双模式共存”的方案。

### 核心思路

1. 在现有设置中新增 `apiMode`
2. 保留当前 `ImageClient` 边界，但扩展其回调能力
3. 在 `directImagesClient` 下按 `apiMode` 分流到：
   - `Images API`
   - `Responses API`
4. 在 `generationStore` 中为每个运行中的 job 增加运行时 partial image 状态
5. 在 `PendingGenerationCard` 中显示最新 partial image
6. 最终图片完成后，继续走当前图片资产写入流程

### 推荐实施顺序

1. `Responses API` 非流式
2. `Responses API` 流式
3. `Images API` 流式
4. 文档、回归、兼容性收口

## API 设计

### 新增设置字段

在 `AppSettings` 中新增：

```ts
type ApiMode = "images" | "responses";

type AppSettings = {
  // existing fields...
  apiMode: ApiMode;
  streamImages: boolean;
  streamPartialImages: 0 | 1 | 2 | 3;
};
```

默认值建议：

```ts
apiMode = "images";
streamImages = false;
streamPartialImages = 1;
```

### 浏览器直连下的 Images API

继续保留当前能力：

- 文生图：`POST /v1/images/generations`
- 图片编辑：`POST /v1/images/edits`

在开启流式时补充：

- `stream: true`
- `partial_images: <0-3>`

### 浏览器直连下的 Responses API

统一走：

- `POST /v1/responses`

请求体结构采用“单图片工具调用”模式：

```ts
{
  model,
  input,
  tools: [
    {
      type: "image_generation",
      action: "generate" | "edit",
      size,
      quality,
      output_format,
      output_compression,
      moderation,
      partial_images,
      input_image_mask
    }
  ],
  tool_choice: "required",
  stream?: true
}
```

其中：

- 文生图：`input` 仅包含 prompt
- 引用图编辑：`input` 包含 `input_text + input_image[]`
- 局部编辑：在工具对象中补 `input_image_mask`

### Responses API 的输入构造

建议对齐参考实现，统一使用：

```ts
[
  {
    role: "user",
    content: [
      { type: "input_text", text: prompt },
      { type: "input_image", image_url: dataUrl }
    ]
  }
]
```

如果没有引用图，也允许直接把 prompt 作为纯文本输入。

### 多图生成策略

本次不依赖 `Responses API` 单次返回多张图片。

继续保持：

- 1 个用户提交
- N 个 `GenerationJob`
- 每个 job 发起 1 次单图请求

优点：

- 改动最小
- 与当前消息聚合逻辑兼容
- 流式状态天然落在 job 维度

## 流式响应设计

### 支持的流式来源

本次目标支持两类流式事件：

1. `Images API` 的 partial image 事件
2. `Responses API` 的 `response.image_generation_call.partial_image`

### 运行时状态设计

新增 job 级运行时状态：

```ts
type GenerationJobRuntime = {
  partialPreviewUrl?: string;
  partialImageIndex?: number;
  streamStartedAtMs?: number;
};
```

这部分数据：

- 只保存在内存
- 不写入 IndexedDB
- 不进入备份
- 最终图写入成功或任务失败后立即释放 object URL

### UI 行为

对于单条 assistant 消息：

- 若存在已完成结果图，继续展示 `ResultImageCard`
- 若仍有 pending job：
  - 有 partial image 时显示最新中间图
  - 无 partial image 时显示当前骨架屏
- 若部分 job 失败，其余 job 继续时，继续显示 pending 区与已有结果图

### 为什么只展示“最新 partial image”

不建议第一版保存完整中间图序列，原因：

- 现有消息卡片布局并不适合展示序列帧
- 会增加 object URL 管理复杂度
- IndexedDB 持久化中间图没有真实长期价值
- “最后一张中间图”已经足够表达进度

因此第一版只保留：

- 每个 job 最近一次 partial image

## 数据模型改动

### `AppSettings`

新增：

- `apiMode`
- `streamImages`
- `streamPartialImages`

### `ImageClient`

当前签名只返回最终结果，需要扩展：

```ts
type ImageClientResult = {
  b64Json: string;
  revisedPrompt?: string;
};

type PartialImageEvent = {
  b64Json: string;
  partialImageIndex?: number;
};

type GenerateImageInput = {
  // existing fields...
  onPartialImage?: (event: PartialImageEvent) => void;
  onStatusText?: (text: string) => void;
};
```

这里建议直接把 partial image 回调放在 `ImageClient` 边界上，而不是放在更上层的 store 中推测。

### `GenerationJob`

不建议把 partial image 状态写入持久化的 `GenerationJob` 类型定义本体中。

建议做法：

- `jobs` 中的持久状态仍保留现有字段
- partial image 通过独立的运行时 Map 或 store 内部字段管理

这样可以避免把临时预览状态和真实业务记录混在一起。

## 组件与状态层改动

### 设置页

需要在“接口”设置页增加：

- API 模式切换：
  - `Images API`
  - `Responses API`
- 流式预览开关
- 中间图数量开关
- 模型输入框

当前设置页缺少真正可编辑的模型控件，本次需要补上。

### Composer 参数栏

当前参数栏顶部显示：

- 模型
- 内容模式
- 区域编辑
- 尺寸
- 数量
- 背景
- 格式

本次建议增加轻量提示，不建议把 `apiMode` 放进这里常驻显示，避免信息过载。`apiMode` 更适合保留在设置页。

### `PendingGenerationCard`

扩展 props：

```ts
type PendingGenerationCardProps = {
  durationLabel: string;
  retryAttempt?: number;
  previewUrl?: string;
};
```

渲染策略：

- `previewUrl` 存在时显示图片
- 否则显示当前生成骨架

### `MessageItem`

需要能从 `generationStore` 读取当前消息下 pending jobs 的 partial 状态，并把最合适的一个传给 `PendingGenerationCard`。

优先级建议：

1. 当前消息最后一个有 partial image 的 pending job
2. 若没有，则保持现有骨架屏

### `generationStore`

需要新增：

- 接收 `onPartialImage`
- 将 partial image 更新写入内存态
- 在 job 完成或失败时回收 object URL

不建议把 partial image 存进 `Message.resultImageIds` 或 `ImageAsset`。

## 兼容性与迁移策略

### 历史设置迁移

旧设置没有 `apiMode`、`streamImages`、`streamPartialImages`。

迁移规则：

- `apiMode` 缺失时默认 `"images"`
- `streamImages` 缺失时默认 `false`
- `streamPartialImages` 缺失时默认 `1`

### 历史消息兼容

历史消息不需要迁移。

原因：

- partial image 不做持久化
- 旧消息只要仍能展示最终结果即可

### Companion 兼容

Companion 本轮不改。

在 `localCompanion` 模式下：

- UI 中可先隐藏 `apiMode=responses`
- 或保留切换但在提交前阻止，提示“本地 Companion 目前仅支持 Images API”

推荐做法是先在设置页直接限制，减少用户混淆。

## 参数兼容策略

### 模型字段语义变化

这是本次最重要的产品语义变化。

当前项目默认模型是 `gpt-image-2`，这和 `Images API` 匹配。

但在 `Responses API` 下，主模型字段通常不再表示“图片模型本身”，而是表示执行图片工具的响应模型。

因此本次需要：

- 给不同 `apiMode` 提供不同默认模型
- 在设置文案中明确提示
- 避免用户直接把 `gpt-image-2` 误填进 `responses` 模式

### 透明背景限制

当前代码中存在：

- `model === "gpt-image-2"` 时禁用透明背景

接入 `Responses API` 后，这个规则不再可靠。建议改为：

- 若 `apiMode === "images"` 且当前模型明确不支持透明背景，再做硬限制
- `responses` 模式下先不做前端硬限制，交给接口侧返回真实错误

### 提示词防改写

当前项目通过前缀文本尽量减少接口重写 prompt。

接入 `Responses API` 后：

- 前缀仍可保留
- 但设置文案需说明：最终服务端仍可能返回 `revised_prompt`

## 分阶段实施计划

### 阶段 1：配置与非流式 Responses API

目标：

- 完成设置与类型扩展
- 跑通浏览器直连 `Responses API`
- 支持文生图

任务：

- 新增 `apiMode` 等设置字段
- 设置页增加 API 模式切换与模型输入
- 在 `directImagesClient` 中按 `apiMode` 分流
- 实现 `Responses API` 文生图请求与结果解析

验收：

- 用户可手动切到 `Responses API`
- 文生图成功写入消息和图片库

### 阶段 2：Responses API 图片编辑

目标：

- 支持引用图编辑
- 支持遮罩编辑

任务：

- 为 `Responses API` 构造 `input_image`
- 为遮罩编辑增加 `input_image_mask`
- 保留当前引用图大小、mask PNG、尺寸一致性校验

验收：

- 无遮罩编辑成功
- 遮罩编辑成功
- `revised_prompt` 能保存到结果图

### 阶段 3：Responses API 流式预览

目标：

- 页面可展示 `Responses API` 的 partial image

任务：

- 实现 SSE 解析器
- 支持 `response.image_generation_call.partial_image`
- `generationStore` 接 partial image 回调
- `PendingGenerationCard` 展示最新预览

验收：

- 开启流式时能看到中间图
- 完成后替换为正式图
- 失败后 partial image 被清理

### 阶段 4：Images API 流式预览

目标：

- 现有 `Images API` 也获得一致的流式体验

任务：

- 请求体增加 `stream: true`、`partial_images`
- 解析 `image_generation.partial_image` / `image_edit.partial_image`
- 复用现有 pending UI

验收：

- `Images API` 与 `Responses API` 预览体验一致

### 阶段 5：收口与文档更新

任务：

- README 增加 `Responses API` 说明
- 更新架构说明中的 `ImageClient` 边界
- 增加测试与已知限制记录

## 测试计划

### 单元测试

建议新增：

- `imagesApi`：
  - `Responses API` 非流式成功
  - `Responses API` 流式 partial image + completed
  - `Images API` 流式 partial image + completed
  - 空响应
  - 非法 JSON
  - 没有 `image_generation_call`
- `settings`：
  - 旧设置迁移
  - `apiMode` 默认值
- `generationStore`：
  - partial image 更新
  - 完成后清理 object URL
  - 失败后清理 object URL

### 手工测试

- 浏览器直连：
  - `Images API` 文生图
  - `Images API` 引用图编辑
  - `Images API` 遮罩编辑
  - `Responses API` 文生图
  - `Responses API` 引用图编辑
  - `Responses API` 遮罩编辑
- 流式：
  - 开启流式，观察中间图
  - 关闭流式，确认退回完整响应模式
- 多图：
  - `imageCount = 2/4/8`
  - 部分成功、部分失败
- 交互：
  - 再次生成
  - 刷新单张图
  - 重试失败消息
  - 继续编辑

## 风险与难点

### 1. 模型语义变化会影响设置体验

这是最大的产品风险，而不是技术风险。

当前用户心智是：

- 模型 = 图片模型

接入 `Responses API` 后会变成：

- 模型 = 响应模型

必须靠设置页文案和默认值把这件事讲清楚。

### 2. partial image 预览会带来 object URL 生命周期管理问题

如果处理不当，会出现：

- 内存泄漏
- 已结束任务仍保留中间图
- 快速重试时旧 partial 图闪回

因此第一版一定要做到：

- 每次覆盖前释放旧 URL
- 任务结束时清理
- 组件卸载时清理

### 3. 遮罩编辑在 Responses API 下的入参兼容性

这是最需要做真实联调验证的部分。

尽管参考实现已经证明这条路径可行，但当前项目的遮罩来源、引用图筛选逻辑和消息关联方式与参考项目不同，仍需要单独验证。

### 4. Companion 后续扩展成本

本轮不做 Companion 是正确的，但也意味着：

- 设置页会出现“直连支持、Companion 暂不支持”的短期差异

这不是阻塞问题，但需要明确写入文档和 UI 提示。

## 后续扩展建议

完成本方案后，可以再评估以下后续能力：

1. Companion 对 `Responses API` 的非流式支持
2. Companion 对 SSE 的透明转发
3. partial image 序列回看
4. 生成详情中展示实际生效参数
5. 更细粒度的“请求进度状态文案”

这些都应在本方案落地稳定后再考虑。

## 开发建议摘要

如果要把本次工作做稳，建议遵循以下原则：

1. 先做 `Responses API` 非流式，再做流式
2. 先做浏览器直连，不碰 Companion
3. 保持“多图 = 多 job 并发”的现有架构
4. partial image 只放运行时内存，不做持久化
5. 设置页必须补齐 `apiMode`、模型输入和流式开关

这条路径改动不小，但边界清晰，且与当前项目结构兼容，是一次可控的演进式升级，而不是推倒重来。
