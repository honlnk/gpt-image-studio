/**
 * imagesApi barrel —— 对外保持与历史 `services/imagesApi.ts` 完全一致的入口。
 *
 * 相关模块分布（注意：部分在 services/ 同级，部分在 imagesApi/ 子目录）：
 * - services/sizeConstraints.ts    尺寸约束/校验（独立于 imagesApi，被 settingsStore 直接依赖，避免反向耦合）
 * - services/promptRewriteGuard.ts 提示词改写守卫（独立于 imagesApi，同上）
 * - imagesApi/types.ts             内部共享响应类型
 * - imagesApi/http.ts              URL 规整 / 响应解析 / 错误提取 / normalizeStreamPartialImages
 * - imagesApi/streaming.ts         SSE 流式响应解析
 * - imagesApi/responses.ts         Responses API 调用路径
 * - imagesApi/client.ts            Images API 调用路径 + generate/edit 入口
 */
import { base64ToBlob } from "../../shared/blobConverters";
import {
  PROMPT_REWRITE_GUARD_PREFIX,
  applyPromptRewriteGuard,
  normalizePromptRewriteGuardText,
} from "../promptRewriteGuard";
import {
  type SizeConstraints,
  getCustomSizeError,
} from "../sizeConstraints";
import { editImage, generateImage } from "./client.js";
import { normalizeApiBaseUrl } from "./http.js";
import type { ImageApiResult } from "./types.js";

export {
  applyPromptRewriteGuard,
  editImage,
  generateImage,
  getCustomSizeError,
  normalizeApiBaseUrl,
  normalizePromptRewriteGuardText,
  PROMPT_REWRITE_GUARD_PREFIX,
  base64ToBlob,
};
export type { ImageApiResult, SizeConstraints };
