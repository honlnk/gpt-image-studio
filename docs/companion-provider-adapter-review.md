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

## 主要问题

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

### P1：Provider URL 下载缺少网络边界

GLM、Qwen 和 Wan 会让 Companion 下载 Provider 返回的图片 URL，再转为 base64。
当前 `urlToB64` 只设置单次请求超时和重试，不限制：

- URL 协议
- loopback、私网、link-local 和本机地址
- HTTP 重定向目标
- 响应 `Content-Type`
- `Content-Length`
- 实际读取字节数

如果自定义中转、错误配置或被入侵的上游返回本机或局域网 URL，Companion 会代替上游
访问该地址，形成 SSRF 风险。如果 URL 返回超大内容，`arrayBuffer()` 会将响应完整读入
内存，转 base64 时还会进一步增加内存占用。

建议：

- 默认只允许 HTTPS 图片 URL；确有兼容需求时单独允许 HTTP。
- DNS 解析后阻止 loopback、私网、link-local、组播和保留地址。
- 每次重定向后重新校验目标地址，或直接禁用自动重定向。
- 要求响应类型为允许的 `image/*`。
- 对 `Content-Length` 和流式读取的实际字节数设置上限。
- 超过上限立即取消读取，不使用无限制的 `arrayBuffer()`。

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

### P2：上游主请求没有超时和取消传播

各 Adapter 的主 `fetch` 没有传入 `AbortSignal`。上游长时间不返回时，Companion 请求会
持续占用连接；Web 用户取消请求或离开页面，也不会终止上游生成。

建议封装统一的 `providerFetch`：

- 生成和编辑使用明确超时。
- 将客户端断开传播到 Adapter。
- 区分超时、DNS、TLS、连接重置和 HTTP 上游错误。
- 只在有明确审核错误码时提示内容审核，不把所有网络错误都归因于提示词。

### P2：未知 Provider 静默回退 OpenAI

Registry 对缺少 Provider 字段和未知 Provider ID 都回退到 OpenAI Adapter。兼容历史凭据
缺少字段是合理的，但拼写错误或已删除 Provider 也会被当作 OpenAI 请求发送。

建议：

- 仅在 Provider 字段缺失时回退 OpenAI。
- 保存凭据时校验 Provider ID 必须已注册。
- 运行时遇到明确但未知的 ID 时返回配置错误。

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

### P3：凭据文件损坏被静默视为空配置

`loadStore` 在 JSON 解析失败或结构不合法时直接返回空 Store。用户看到的现象会像是所有
Provider 配置突然消失，且缺少可诊断日志。

建议保留损坏文件，记录脱敏错误，并向 CLI/Web 返回“凭据文件无法读取”的明确状态，
不要自动把数据损坏表现为首次使用。

### P3：公共设施存在维护漂移

- `taskPoller` 当前没有 Provider 使用，注释仍描述 Wan 等异步流程。
- 多个 Adapter 的 `DEFAULT_*_BASE_URL` 常量没有实际参与 URL 构造。
- `describe()` 当前价值有限。
- DashScope 错误解析先返回 `message`，导致 `code: message` 组合分支不可达。

这些问题不会立即造成严重故障，但会增加后续维护者判断真实协议的成本。

## 建议整改顺序

### 第一批：修复真实请求契约

1. 统一 `resolution` 字段。
2. 为 Grok/Gemini 增加 route 级集成测试。
3. 让结果携带真实 MIME，并修正能力声明。
4. 结构化 multipart 后再校验。

### 第二批：收紧 Companion 出站网络

1. 实现受限 URL 下载器。
2. 增加响应大小和类型限制。
3. 增加统一 Provider 请求超时。
4. 改进网络错误分类。

### 第三批：完善能力协议

1. 增加最大参考图数量和大小。
2. 将 Gemini 等 Provider 改为模型动态能力。
3. 未知 Provider 改为显式配置错误。
4. 补充各 Provider 的端到端契约测试。

## 测试基线

2026-07-16 审查时：

- `pnpm typecheck:companion` 通过。
- `pnpm test` 通过，共 35 个测试文件、319 个测试。
- `pnpm typecheck` 因本机依赖目录缺少 `qrcode` 模块而失败，不是 Companion 类型错误。

现有测试对 Adapter 内部翻译覆盖较多，但跨越 Web 参数、HTTP route 和 Adapter 的端到端
契约测试不足。后续测试重点应从“手工构造 Adapter 理想输入”转向“使用 Web 实际请求形状”。
