# 遮罩局部编辑方案

> 状态（2026-05-12）：已落地并在持续迭代。本文已按当前实现更新。

## 目标

为 GPT 图片编辑请求增加一个简单的本地遮罩绘制流程。用户可以在参考图上涂抹想要修改的区域，应用在内部把涂抹结果转换成 OpenAI 图片编辑接口需要的 PNG mask，然后随参考图一起提交。

用户侧的概念是“涂抹要编辑的区域”。接口侧的 mask 含义需要反过来处理：

- 涂抹区域：透明像素，`alpha = 0`，表示交给模型编辑。
- 未涂抹区域：不透明像素，`alpha = 255`，表示尽量保留。

## 当前上下文

项目目前已经支持基于参考图的图片编辑：

- `src/services/imagesApi.ts` 使用 `FormData` 构造 `/images/edits` 请求。
- `src/app/studio/useStudioViewModel.ts` 负责装配生成流程；当前生成逻辑会读取参考图 blob，并调用 `editImage`。
- `src/components/studio/ImagePreviewModal.vue` 是查看单张图片的自然入口，适合承载遮罩绘制。
- `src/components/studio/ChatWorkspace.vue` 负责输入框和当前引用图片展示。

第一版可以在现有流程上扩展，不需要把 mask 当作普通图片资产放入图片库。

## 当前交互（已实现）

1. 用户点击消息卡片中的“继续编辑”。
2. 当输入区“区域编辑”开关为开启状态时，进入遮罩绘制弹窗。
3. 支持多种工具：画笔、橡皮、矩形、圆形、平移。
4. 支持多选区叠加、撤销/重做、软边、缩放/复位视图。
5. 点击完成后：
   - 原图与 mask 以“编辑对”形式绑定到单个复合引用 tag 中展示。
   - 点击该复合 tag 的关闭按钮会同时移除原图和 mask。
6. 发送后，图片编辑请求同时携带 `image[]` 和 `mask`。

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

## 数据结构（当前）

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

当前实现中，mask 作为 `ImageAsset` 保存在本地图片资产中，并通过会话草稿记录 `editSourceImageId` / `editMaskImageId` 绑定关系。产品决策为不做“跨刷新保留正在绘制中的选区”。

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

然后在生成流程中，把可选 mask 从提交消息流程一路传到 `requestImageEdit` 和 `editImage`。

## 状态调整（当前）

以下情况会清空选区或 mask 绑定：

- 用户移除了对应的引用图。
- 用户提交了一条消息。
- 用户关闭编辑弹窗（包含取消和应用后关闭）。

如果 `editMaskImageId` 对应的图片不存在、尺寸不匹配、或 MIME 类型不合法，发送会失败并给出明确提示。

## UI 调整（当前）

已接入组件：

- `ChatWorkspace.vue`：继续编辑进入遮罩弹窗、接收 `apply(maskBlob)`。
- `EditMaskModal.vue`：遮罩绘制工具与交互。
- `ChatComposer.vue`：编辑对复合 tag 展示（源图 + mask 合并）。

## 发送前校验

发送带 mask 的请求前校验：

- mask 尺寸和源图尺寸一致。
- mask blob 类型是 PNG。

校验失败时，MVP 阶段建议直接提示错误，不要静默降级为普通图片编辑。否则用户会以为局部编辑生效了，但模型实际在全图编辑。

## 后续增强（未做）

- 保存可复用的遮罩资产（当前仅作为本地引用资产使用）。
- 多图编辑时“明确指定 mask 主图”的 UI（已确认后置，待重设计）。
