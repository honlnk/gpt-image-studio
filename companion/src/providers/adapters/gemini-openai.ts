/**
 * Gemini（OpenAI 协议 / 中转）adapter。
 *
 * 针对一类特殊场景：上游中转服务（PackyCode、各类 API 聚合站）用 OpenAI
 * Images API 协议（/v1/images/generations、/v1/images/edits）转发 gemini 模型，
 * 但底层实际是 gemini 的能力画像。
 *
 * 为什么需要独立 provider 而非复用 openai：
 *   openai provider 的 profile 声明 mask=true、step=16、maxAspectRatio=3——
 *   这些是 GPT-image 的约束，套在 gemini 模型上会误导 UI（显示不支持的蒙版编辑、
 *   强制 16 倍数尺寸）。gemini-openai 走 openai 工厂的传输协议（Images API JSON
 *   + multipart edits），但 profile 填 gemini 的能力数据（mask=false、step=1、
 *   maxAspectRatio=null），解耦「用什么协议发请求」和「页面显示什么能力」。
 *
 * 与原生 gemini provider 的区别：
 *   gemini（adapters/gemini.ts）走 Google 官方 :generateContent 协议（x-goog-api-key
 *   + contents/parts 结构 + aspectRatio/imageSize 枚举），直连 Google 或完全兼容
 *   Gemini 原生协议的网关时用它。gemini-openai 走标准 OpenAI Images API，中转
 *   只暴露 OpenAI 协议入口时用它。
 *
 * 响应解析复用工厂的 parseImagesResponse（b64_json 优先，url 兜底），应对中转
 *   忽略 response_format=b64_json 直接返回 CDN URL 的情况。
 */

import { createOpenAICompatibleAdapter } from "../openaiCompatible.js";

export const geminiOpenaiAdapter = createOpenAICompatibleAdapter({
  id: "gemini-openai",
  fieldMode: "passthrough",
  responseShape: "data_b64",
  editMode: "multipart",
  normalizeSize: (size) => size,
});
