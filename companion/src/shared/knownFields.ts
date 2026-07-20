/**
 * Web ↔ Companion 之间的「已知字段」白名单。
 *
 * 背景：Companion 路由接受 OpenAI Images API 兼容形状的请求，其中既包含
 * OpenAI 标准字段（model / prompt / size 等），也包含本项目自定义的扩展字段
 * （companion_resolution / background / output_format）。route 层需要一个清单
 * 来区分「标准已知字段」和「透传型 extra」，避免拼写错误或未知字段被错误
 * 塞进 adapter 的标准字段位。
 *
 * 历史问题：这份清单曾和 Web 侧 `localCompanionImagesClient.ts` 的 `buildParams`
 * 是两份手工同步的硬编码清单——任一端漏改都表现为能力静默失效，且 CI 无法拦截
 * （详见 docs/companion-provider-adapter-review.md P1 第 5 项）。
 *
 * 当前方案（软共享）：
 *   - 本文件是 Companion 侧的单一源。
 *   - Web 侧 `src/types/companionKnownFields.ts` 维护一份镜像常量。
 *   - 由 `src/__tests__/companionKnownFields.contract.test.ts` 在 CI 阶段
 *     断言两端字段集合完全一致，漂移会直接让测试失败。
 *
 * 取舍：仍保留两份清单（避免 Web 引入对 companion 包的构建依赖），但通过契约
 * 测试把「无声漂移」转化为「CI 报错」。新增字段时两端必须同步修改。
 */

/**
 * 文生图（POST /images/generations）接受的已知字段。
 *
 * - `companion_resolution` 是历史命名（早期为避免与 OpenAI 字段冲突加前缀），
 *   路由层会在归一化时把它翻译为 adapter 标准字段 `resolution`。
 *   保留在本清单里是为了让 multipart/json 请求校验通过。
 * - 其余字段直接透传到 `OpenAIImageRequest` 的同名标准字段。
 */
export const KNOWN_GENERATE_FIELDS = [
  "model",
  "prompt",
  "size",
  "companion_resolution",
  "background",
  "output_format",
] as const;

/**
 * 图片编辑（POST /images/edits，multipart/form-data）接受的已知字段。
 *
 * 编辑请求中图片二进制通过 `image[]` 字段、mask 通过 `mask` 字段单独处理，
 * 这里的清单只覆盖文本型已知字段。当前与文生图清单相同。
 */
export const KNOWN_EDIT_FIELDS = [
  "model",
  "prompt",
  "size",
  "companion_resolution",
  "background",
  "output_format",
] as const;

export type KnownGenerateField = (typeof KNOWN_GENERATE_FIELDS)[number];
export type KnownEditField = (typeof KNOWN_EDIT_FIELDS)[number];
