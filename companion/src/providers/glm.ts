import type {
  OpenAIImageRequest,
  OpenAIImageResult,
  ProviderAdapter,
  ProviderCapability,
  ProviderConfig,
  ResolutionOption,
  SizeConstraints,
} from "./types.js";
import { urlToB64 } from "./urlToB64.js";

/**
 * GLM-Image（智谱 Zhipu）adapter。
 *
 * GLM-Image 的文生图走智谱 OpenAI 兼容路径 `/paas/v4/images/generations`，
 * 形状与 OpenAI 接近，但有三个差异要在 adapter 内部处理：
 *   1. 请求体只认 { model, prompt, size }——background / output_format 要裁掉
 *   2. size 是软推荐 + 4 条硬规则（见 SIZE_CONSTRAINTS），要规整
 *   3. 返回的是 data[0].url（有时效），要立即 fetch 转 b64
 *
 * GLM 不支持图片编辑（edits）：GLM-Image 无 edits 端点，mask 局部重绘智谱全系列
 * 不支持。capability.edit=false，带图编辑请求由 route 层返回 501。
 * 全图编辑理论可经 GLM-4V chat 实现，但翻译成本高、质量依赖自然语言——阶段三再议。
 *
 * 详见 docs/companion-providers-plan.md「GLM-Image 的 API 形状」「GLM size 约束」。
 */

/** GLM-Image 的 4 条 size 硬规则（经查智谱官方 OpenAPI 规范确认）。 */
const SIZE_CONSTRAINTS: SizeConstraints = {
  step: 32,
  min: 512,
  max: 2048,
  maxPixels: 4194304, // 2^22
  minPixels: 0, // GLM 无总像素下限概念
  maxAspectRatio: null, // GLM 文档未提长宽比限制
  defaultSize: "1280x1280",
};

/**
 * GLM 能力声明。
 * - edit/mask=false：GLM-Image 无 edits 端点，不支持 mask 局部重绘。
 * - backgrounds 去 transparent：GLM 文生图无透明背景概念。
 * - outputFormats 去 webp：GLM-Image 返回的是 URL（实际格式由服务端定），
 *   本 adapter 统一转 b64，webp 这个选项对 GLM 无意义，隐藏掉。
 */
const CAPABILITY: ProviderCapability = {
  generate: true,
  edit: false,
  mask: false,
  backgrounds: ["auto", "opaque"],
  outputFormats: ["png", "jpeg"],
};

/**
 * GLM 支持的分辨率档位。GLM maxPixels=4194304（2²²），真实只到 2K，
 * 4K（8.3M）生成不了——这里只声明 1K/2K，是 GLM 的真实能力。
 * （此前 web 是靠 availableResolutionValues 按 maxPixels 运行时过滤掉 4K，
 *  D1 统一机制后该特判删除，GLM 4K 不显示是因为这里压根没声明。）
 */
const RESOLUTION_OPTIONS: readonly ResolutionOption[] = [
  { value: "1k", label: "1K", targetPixels: 1024 * 1024 },
  { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
];

/** GLM 默认 base url（智谱开放平台）。login 时可被覆盖。 */
const DEFAULT_GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/images";
/** GLM 默认 model（智谱 2026 旗舰文生图模型）。login 时可填自定义。 */
const DEFAULT_GLM_MODEL = "glm-image";

export const glmAdapter: ProviderAdapter = {
  id: "glm",
  capability: CAPABILITY,
  sizeConstraints: SIZE_CONSTRAINTS,
  resolutionOptions: RESOLUTION_OPTIONS,

  describe(config: ProviderConfig) {
    return { label: config.model ?? DEFAULT_GLM_MODEL, providerId: "glm" };
  },

  async generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const apiUrl = `${config.apiBaseUrl.replace(/\/+$/, "")}/generations`;
    const model = config.model ?? DEFAULT_GLM_MODEL;
    const size = normalizeGlmSize(request.size, SIZE_CONSTRAINTS);

    // 裁剪：GLM 只认 model/prompt/size，丢弃 background/output_format 及 extra
    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, prompt: request.prompt, size }),
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    const payload = await parseJsonResponse(response);
    const url = payload?.data?.[0]?.url;
    if (!url) {
      throw new Error(extractErrorMessage(payload) ?? "GLM 响应中没有 data[0].url");
    }

    // GLM 返回 URL（有时效），立即 fetch 转 b64，以 OpenAI 形状返回
    const { b64Json, mimeType } = await urlToB64(url);
    return { b64Json, mimeType };
  },
  // edit 不实现：capability.edit=false，route 层会返回 501。
};

const UPSTREAM_DISCONNECT_MESSAGE =
  "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。";

/**
 * 把 OpenAI 形状的 size 规整成 GLM 合法的 `宽x高`（小写 x）。
 *
 * 处理的输入：
 * - "auto" → GLM 默认尺寸（defaultSize）
 * - "WxH"（已合法）→ 校验后透传
 * - "WxH"（不合法）→ 规整到合法
 * - 比例格式（如 "16:9"，来自 web 的 ratio 预设）→ 按比例 + 默认像素算出尺寸再规整
 *
 * 规整策略（GLM 4 条硬规则）：
 *   1. 对齐 step（32）倍数
 *   2. 钳制到 [min, max]（512–2048）
 *   3. 压到 maxPixels（4194304）以内：长边优先缩
 *   4. 小写 x 分隔
 *
 * 这是纯函数，便于单测；adapter 内部调用它。
 */
export function normalizeGlmSize(
  size: string,
  constraints: SizeConstraints = SIZE_CONSTRAINTS,
): string {
  const trimmed = size.trim();

  if (trimmed === "auto" || trimmed === "") {
    return constraints.defaultSize;
  }

  // 比例格式（web 的 ratio 预设会发 "16:9" 这类）
  if (trimmed.includes(":")) {
    const dims = dimensionsFromRatio(trimmed, constraints);
    return finalizeSize(dims.width, dims.height, constraints);
  }

  // WxH 格式（web 的 custom 会发 "1280x768" 这类）
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(trimmed);
  if (match) {
    return finalizeSize(Number(match[1]), Number(match[2]), constraints);
  }

  // 无法识别 → 回退默认，并记录（不该发生，UI 已约束）
  console.warn(`[glm] 无法识别的 size "${trimmed}"，回退默认 ${constraints.defaultSize}`);
  return constraints.defaultSize;
}

/** 按比例 + 目标像素（取 maxPixels 的一半作基准，接近正方形默认）算出原始尺寸。 */
function dimensionsFromRatio(ratio: string, constraints: SizeConstraints) {
  const [w, h] = ratio.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 0, height: 0 };
  }
  const aspect = w / h;
  // 基准取一个不超过 maxPixels 且在范围内的正方形等效，再按比例拉伸
  const baseSide = Math.min(constraints.max, Math.sqrt(constraints.maxPixels));
  let width = Math.round(baseSide * Math.sqrt(aspect));
  let height = Math.round(width / aspect);
  return { width, height };
}

/** 规整到 GLM 合法：对齐 step → 钳制范围 → 压像素。 */
function finalizeSize(
  width: number,
  height: number,
  constraints: SizeConstraints,
): string {
  let w = alignToStep(width, constraints);
  let h = alignToStep(height, constraints);

  // 钳制单边范围
  w = clamp(w, constraints.min, constraints.max, constraints);
  h = clamp(h, constraints.min, constraints.max, constraints);

  // 压总像素（长边优先缩，保持比例近似）
  while (w * h > constraints.maxPixels && w > constraints.min && h > constraints.min) {
    if (w >= h) {
      w = alignToStep(w - constraints.step, constraints);
    } else {
      h = alignToStep(h - constraints.step, constraints);
    }
  }

  return `${w}x${h}`;
}

function alignToStep(value: number, constraints: SizeConstraints): number {
  return Math.round(value / constraints.step) * constraints.step;
}

function clamp(
  value: number,
  min: number,
  max: number,
  constraints: SizeConstraints,
): number {
  const clamped = Math.min(max, Math.max(min, value));
  // 钳制后再对齐一次，确保落在 step 倍数
  return alignToStep(clamped, constraints);
}

async function parseJsonResponse(response: Response): Promise<Record<string, any> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return null;
  }
}

function extractErrorMessage(payload: Record<string, any> | null): string | null {
  if (!payload) return null;
  const err = payload.error;
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  return null;
}
