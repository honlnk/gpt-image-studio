/**
 * OpenAI Images API 原生 adapter。
 *
 * 这是 canonical 协议——入参出参都是 OpenAI 形状，工厂的 passthrough 模式
 * 原样转发 web 发来的全部字段（含 quality/stream 等 extra 字段），size 不做
 * 规整（恒等函数），edit 走标准 multipart /edits 端点。响应由 parseImagesResponse
 * 解析（b64_json 优先，url 兜底——应对 PackyCode 等中转无视 response_format 的情况）。
 *
 * 能力数据（capability/sizeConstraints/resolutionOptions）统一在
 * providerProfiles.ts + profiles/openai.json。
 */

import { createOpenAICompatibleAdapter } from "../openaiCompatible.js";

export const openaiAdapter = createOpenAICompatibleAdapter({
  id: "openai",
  fieldMode: "passthrough",
  responseShape: "data_b64",
  editMode: "multipart",
  // openai 原样透传 size（不规整），与恒等函数等价。
  normalizeSize: (size) => size,
});
