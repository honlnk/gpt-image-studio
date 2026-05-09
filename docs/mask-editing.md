# 遮罩局部编辑方案

## 目标

为 GPT 图片编辑请求增加一个简单的本地遮罩绘制流程。用户可以在参考图上涂抹想要修改的区域，应用在内部把涂抹结果转换成 OpenAI 图片编辑接口需要的 PNG mask，然后随参考图一起提交。

用户侧的概念是“涂抹要编辑的区域”。接口侧的 mask 含义需要反过来处理：

- 涂抹区域：透明像素，`alpha = 0`，表示交给模型编辑。
- 未涂抹区域：不透明像素，`alpha = 255`，表示尽量保留。

## 当前上下文

项目目前已经支持基于参考图的图片编辑：

- `src/services/imagesApi.ts` 使用 `FormData` 构造 `/images/edits` 请求。
- `src/composables/useStudioState.ts` 负责读取参考图 blob，并调用 `editImage`。
- `src/components/studio/ImagePreviewModal.vue` 是查看单张图片的自然入口，适合承载遮罩绘制。
- `src/components/studio/ChatWorkspace.vue` 负责输入框和当前引用图片展示。

第一版可以在现有流程上扩展，不需要把 mask 当作普通图片资产放入图片库。

## MVP 交互

1. 用户从图片库或生成结果中打开一张图片预览。
2. 预览弹窗提供“局部编辑”入口。
3. 点击后进入遮罩绘制模式。
4. 用户在图片上涂抹想要修改的区域。
5. 用户可以调整画笔大小、撤销、清空、取消或完成。
6. 点击完成后：
   - 原图自动作为第一张引用图加入输入框。
   - 生成的 mask 作为当前输入草稿状态保存。
   - 输入框提示用户描述希望如何修改涂抹区域。
7. 用户发送后，图片编辑请求同时携带 `image[]` 和 `mask`。

MVP 阶段建议只允许单张引用图使用 mask。OpenAI 的 `mask` 只作用于第一张图片，多图遮罩编辑很容易造成理解偏差。

## Canvas 设计

绘制界面建议使用两个可见 canvas 加一个内部 canvas：

- 底层 canvas：展示原图，按弹窗空间等比例缩放。
- 绘制层 canvas：展示用户涂抹轨迹，用半透明颜色覆盖在原图上。
- 内部 mask canvas：尺寸等于原图真实宽高，用原图坐标记录涂抹轨迹。

指针事件需要把屏幕上的 canvas 坐标映射回原图真实坐标。这样导出的 mask 尺寸才能和源图完全一致。

## Mask 导出

用户点击完成时：

1. 创建一个和原图真实宽高一致的离屏 canvas。
2. 整张画布先填充为不透明白色：`rgba(255, 255, 255, 255)`。
3. 把用户涂抹过的区域处理成透明：`rgba(0, 0, 0, 0)`。
4. 导出为 `image/png`。

mask 的 RGB 颜色不重要，真正生效的是 alpha 通道。

边缘羽化可以后续再做。MVP 可以先使用硬边缘，保证功能链路跑通。

## 数据结构

新增一个只用于当前输入草稿的遮罩类型：

```ts
type DraftMask = {
  imageId: string;
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
};
```

第一版建议只存在内存里，不持久化到 IndexedDB。等确认用户需要刷新后保留遮罩草稿，再考虑持久化。

## API 调整

扩展 `src/services/imagesApi.ts` 中的 `editImage` 入参：

```ts
type EditImageInput = GenerateImageInput & {
  images: Array<{
    blob: Blob;
    name: string;
  }>;
  mask?: {
    blob: Blob;
    name: string;
  };
};
```

请求体里在有 mask 时追加：

```ts
if (input.mask) {
  body.append("mask", input.mask.blob, input.mask.name);
}
```

然后在 `src/composables/useStudioState.ts` 中，把可选 mask 从提交消息流程一路传到 `requestImageEdit` 和 `editImage`。

## 状态调整

在工作台状态中新增输入框级别的遮罩草稿：

```ts
const draftMask = ref<DraftMask | null>(null);
```

以下情况需要清空 mask：

- 用户移除了对应的引用图。
- 用户换成了另一张源图。
- 用户提交了一条消息。
- 用户切换会话。
- 用户主动清空遮罩。

如果 `draftMask` 存在，但它对应的图片已经不在当前引用图中，不应该继续发送这个 mask。

## UI 调整

预计涉及这些组件：

- `ImagePreviewModal.vue`
  - 增加遮罩绘制模式。
  - 增加画笔大小、撤销、清空、取消、完成等控制。
  - 完成后向外抛出 `create-mask` 或 `apply-mask` 事件。

- `App.vue`
  - 接收预览弹窗抛出的 mask 事件。
  - 调用类似 `applyDraftMask(imageId, blob)` 的状态方法。

- `ChatWorkspace.vue`
  - 在引用图区域附近展示当前已应用遮罩的提示。
  - 提供清空遮罩入口。
  - 当有遮罩时调整输入框 placeholder。

## 发送前校验

发送带 mask 的请求前需要校验：

- 当前只有一张引用图。
- mask 对应的 `imageId` 和这张引用图一致。
- mask 尺寸和源图尺寸一致。
- mask blob 类型是 PNG。

校验失败时，MVP 阶段建议直接提示错误，不要静默降级为普通图片编辑。否则用户会以为局部编辑生效了，但模型实际在全图编辑。

## 后续增强

- 橡皮擦工具。
- 基于笔画对象的撤销栈。
- 画笔软硬度和边缘羽化。
- 绘制时缩放和平移。
- 持久化遮罩草稿。
- 保存可复用的遮罩资产。
- 多图编辑时，让用户明确选择哪一张图作为被 mask 作用的第一张图。
