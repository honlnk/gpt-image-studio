# 提示词模式开发计划

这份文档用于规划 GPT Image Studio 的“提示词模式”功能。目标是在默认情况下完全保持当前行为不变，同时新增一个可选的提示词工程层，用来支持安全、创意、成人三档模式。

这个方案参考了 `fenjue` 项目的核心思路，但会按我们当前项目的结构来实现。

## 目标

- 默认模式保持当前提示词流程，不影响已有用户和已有嵌入链接。
- 新增三个可选模式：安全、创意、成人。
- 复用参考项目的核心逻辑：不同模式对应不同词库范围。
- 聊天记录里保存用户原始提示词，不保存包装后的请求提示词。
- 只在发送到图片接口前应用模式指令和词库灵感。
- 词库与请求逻辑分离，方便后续人工筛选和替换。

## 非目标

- 第一版不增加单独的 LLM 提示词编译器。
- 第一版不改变 OpenAI Images API 的请求结构，只改变最终发送的 `prompt` 文本。
- 不承诺所有模型和接口都支持成人内容。
- 不让提示词模式影响导入图片、备份格式或已保存消息内容。

## 参考项目逻辑

参考项目使用了三档词库组合：

```text
安全模式：pose.safe
创意模式：pose.safe + pose.creative
成人模式：pose.safe + pose.creative + pose.nsfw
```

同时它会注入不同的模式说明：

- 安全：无成人内容，强调干净构图、优雅、安全表达。
- 创意：允许性感、暧昧、氛围张力和更大胆的视觉表现。
- 成人：面向支持成人内容的模型或接口，允许更成人向的提示词方向。

最值得借鉴的不是具体文案，而是它的组合方式：

```text
用户原始提示词
  + 模式说明
  + 随机词库灵感
  + 明确要求不得覆盖用户意图
```

## 产品行为

新增一个设置项：`promptMode`。

```ts
type PromptMode = "default" | "safe" | "creative" | "adult";
```

模式含义：

```text
default：
  默认模式。完全保持当前逻辑，不追加模式指令，也不追加词库。

safe：
  安全模式。追加安全模式说明，只从 safe 词库抽取灵感。

creative：
  创意模式。追加创意模式说明，从 safe + creative 词库抽取灵感。

adult：
  成人模式。追加成人模式说明，从 safe + creative + nsfw 词库抽取灵感。
```

默认值必须是 `default`，这样旧用户、旧设置和旧 URL 都不会被改变。

## 提示词构建链路

当前请求链路：

```text
用户原始 prompt
  -> promptRewriteGuard
  -> Images API
```

新请求链路：

```text
用户原始 prompt
  -> promptMode builder
  -> promptRewriteGuard
  -> Images API
```

注意：`promptRewriteGuard` 仍然放在最后。它的作用是防止接口侧改写提示词，所以它应该包住最终要发送的完整 prompt。

## Prompt Builder 设计

新增服务：

```text
src/services/promptBuilder.ts
```

建议 API：

```ts
export type PromptMode = "default" | "safe" | "creative" | "adult";

export type BuildPromptInput = {
  prompt: string;
  mode: PromptMode;
  seed?: string;
};

export function buildImagePrompt(input: BuildPromptInput): string;
```

当 `mode` 是 `default` 时，直接返回原始 prompt，不做任何处理。

其他模式返回包装后的 prompt，结构类似：

```text
请把用户原始提示词作为最高优先级。必须保留主体、动作、构图、风格、
场景和用户明确提出的要求。下面的模式说明和灵感词只用于补充细节，
不得覆盖用户原意。

当前模式：创意
模式说明：
...

灵感词：
...

用户原始提示词：
...
```

核心优先级必须始终是：

```text
用户意图 > 模式说明 > 随机词库灵感
```

## 词库设计

新增服务：

```text
src/services/promptWordbanks.ts
```

初始结构：

```ts
export const promptWordbanks = {
  pose: {
    safe: [],
    creative: [],
    nsfw: [],
  },
  adultInspiration: [],
} as const;
```

第一版可以先复制我们从参考项目抽出来的词库：

```text
/Users/honlnk/Downloads/fenjue/prompt-wordbanks
```

这些词库先作为占位资源，后续由产品侧人工筛选。

抽词规则：

```text
安全模式：
  pose.safe

创意模式：
  pose.safe + pose.creative

成人模式：
  pose.safe + pose.creative + pose.nsfw
  额外加入 adultInspiration
```

第一版建议抽取数量：

```text
姿势词：2-3 个
成人灵感词：1-2 个，仅成人模式启用
```

测试里需要可预测的抽样结果。生产实现可以接受可选的 `seed`，这样单元测试能固定输出。

## 设置模型

更新 `src/types/studio.ts`：

```ts
export type PromptMode = "default" | "safe" | "creative" | "adult";

export type AppSettings = {
  ...
  promptMode: PromptMode;
};
```

更新设置归一化：

```text
src/services/settings.ts
```

默认值：

```ts
promptMode: "default"
```

更新 Pinia 设置 store：

```text
src/stores/settingsStore.ts
```

新增：

```ts
const promptMode = ref<PromptMode>("default");
```

并在 `currentSettings()` 中持久化，在 `applySettings()` 中恢复。

## API 接入

更新 `src/services/imagesApi.ts`：

```ts
type GenerateImageInput = {
  ...
  promptMode?: PromptMode;
};
```

在提示词防改写之前应用提示词模式：

```ts
const modePrompt = buildImagePrompt({
  prompt: input.prompt,
  mode: input.promptMode ?? "default",
});

const prompt = applyPromptRewriteGuard(
  modePrompt,
  input.promptRewriteGuardEnabled ?? false,
  input.promptRewriteGuardText,
);
```

文生图和图生图都要使用同样逻辑。

同时更新两个图片客户端：

```text
src/features/generation/imageClients/directImagesClient.ts
src/features/generation/imageClients/localCompanionImagesClient.ts
```

两个客户端都需要从配置里读取 `getPromptMode()`，再传给底层图片请求。

## UI 设计

在设置页里新增一个区域，建议放在“提示词保护”附近：

```text
提示词模式

默认    不追加任何模式指令，保持当前逻辑
安全    使用安全提示词方向
创意    使用安全 + 创意提示词方向
成人    使用安全 + 创意 + 成人提示词方向
```

建议新增独立组件：

```text
src/components/settings/PromptModeSettingsPanel.vue
```

如果 UI 很简单，也可以先直接扩展：

```text
src/components/settings/PromptGuardSettingsPanel.vue
```

但从长期看，独立组件会更清晰。

在输入框参数栏里可以增加一个紧凑显示：

```text
内容：默认 / 安全 / 创意 / 成人
```

第一版可以先只显示当前模式，点击后打开设置弹窗。后续再做行内切换。

## URL 设置

当前应用支持通过 URL 传入嵌入设置。后续可以新增：

```text
promptMode=default|safe|creative|adult
```

需要更新：

```text
src/services/urlSettings.ts
src/services/urlSettings.test.ts
README.md
```

这个可以放在基础功能完成之后再做。

## 备份兼容

备份中包含设置。由于 `promptMode` 有默认值，旧备份恢复后应该自动得到：

```ts
promptMode: "default"
```

如果某些测试断言了完整设置对象，需要同步更新测试。

## 模型和接口现实

成人模式只是一个提示词工程模式，不保证接口一定接受请求。

应用不应该把成人模式描述成“绕过模型限制”。它只是把更成人向的 prompt 发送给支持此类内容的模型或自定义接口。

词库内容由产品侧后续筛选。实现上要保证词库与请求代码分离，方便替换。

## 实现阶段

### Phase 1：设置与 Builder

- 增加 `PromptMode` 类型。
- 在设置持久化和 settings store 中加入 `promptMode`。
- 新增 `promptBuilder.ts`。
- 新增 `promptWordbanks.ts`。
- 为 `buildImagePrompt` 补单元测试。
- 把 prompt mode 接入 direct 和 companion 图片客户端。

### Phase 2：设置 UI

- 在设置页增加提示词模式选择器。
- 增加每个模式的说明。
- 通过现有设置流程持久化。
- 在输入框参数栏展示当前内容模式。

### Phase 3：URL 与备份完善

- 支持 URL 参数 `promptMode`。
- 更新 README 的嵌入说明。
- 如有必要，更新备份相关测试。

### Phase 4：词库筛选与调优

- 用产品侧筛选后的词库替换初始词库。
- 调整每次抽取数量。
- 如有需要，增加自定义 profile 文案。

## 验收标准

- 默认模式发送的 prompt 与当前行为完全一致。
- 安全、创意、成人模式只改变发送给接口的请求 prompt，不改变保存到聊天记录里的原始消息。
- `promptRewriteGuard` 仍然包住最终请求 prompt。
- 文生图和图生图都应用当前提示词模式。
- 浏览器直连和本地 Companion 两种连接模式行为一致。
- 设置刷新后仍然保留。
- 旧设置加载后默认得到 `promptMode: "default"`。
- 单元测试覆盖默认透传和三个提示词模式。
