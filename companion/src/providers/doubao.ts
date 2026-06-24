import type {
  OpenAIImageEditRequest,
  OpenAIImageRequest,
  OpenAIImageResult,
  ProviderAdapter,
  ProviderCapability,
  ProviderConfig,
  ResolutionOption,
  SizeConstraints,
} from "./types.js";

/**
 * 豆包 Seedream（火山方舟 ByteDance）adapter。
 *
 * 与 GLM 一样走 OpenAI 兼容的 /images/generations 端点、Bearer 鉴权，
 * 但在三个维度上有本质差异，因此是独立 adapter（不复用 glm.ts）：
 *
 *   1. size 约束模型不同：豆包是「总像素范围 [3.6M, 16M] + 宽高比 [1/16, 16]」双约束，
 *      有像素下限（GLM 无下限），且无步长对齐（step=1）。
 *   2. 原生支持图生图（SeedEdit / edits 端点），capability.edit=true。
 *      GLM 全图编辑已确认不做。
 *   3. 豆包特有字段：response_format（D2 固定要 b64_json 跳过 URL→b64）、
 *      watermark（D3 固定关掉，不要「AI 生成」水印）。
 *
 * 不支持 mask 局部重绘（与 GLM 一致的国产模型缺口），capability.mask=false，
 * 带 mask 的编辑请求由 route 层返回 400。
 *
 * 详见 docs/companion-doubao-plan.md。
 */

/** 豆包的 size 硬规则（经查火山方舟 Seedream 官方文档确认）。 */
const SIZE_CONSTRAINTS: SizeConstraints = {
  step: 1, // D6：豆包无步长对齐，任意整数像素都接受
  min: 512, // 单边软下限兜底（豆包靠总像素+宽高比约束，单边无硬下限）
  max: 4096, // 单边软上限（总像素上限 2^24 决定，4096 是安全值）
  maxPixels: 16777216, // 2^24，豆包总像素上限
  minPixels: 3686400, // 豆包总像素下限（约 1920²），自定义尺寸路径校验用
  maxAspectRatio: 16, // 宽高比上限 [1/16, 16]
  defaultSize: "2048x2048", // 2K 正方形，豆包最稳定档位，刚过下限
};

/**
 * 豆包能力声明。
 * - edit=true：原生支持图生图（SeedEdit / edits 端点）。
 * - mask=false：不支持 mask 局部重绘（国产模型普遍缺口）。
 * - backgrounds 去 transparent：豆包不支持透明背景。
 * - outputFormats 去 webp：Seedream 主力输出 png/jpeg。
 */
const CAPABILITY: ProviderCapability = {
  generate: true,
  edit: true,
  mask: false,
  backgrounds: ["auto", "opaque"],
  outputFormats: ["png", "jpeg"],
};

/**
 * 豆包支持的分辨率档位（companion 声明、web 渲染）。
 * - 不含 1K：豆包 minPixels≈3.6M，1K（1M）达不到下限。
 * - 含 3K：豆包原生档，web 此前没有。
 */
const RESOLUTION_OPTIONS: readonly ResolutionOption[] = [
  { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
  { value: "3k", label: "3K", targetPixels: 2880 * 1620 },
  { value: "4k", label: "4K", targetPixels: 4096 * 2160 },
];

/** 豆包默认 base url（火山方舟方舟服务）。login 时可被覆盖。 */
const DEFAULT_DOUBAO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3/images";
/** 豆包默认 model（Seedream 5.0 lite，豆包当前最强模型）。login 时可填自定义。 */
const DEFAULT_DOUBAO_MODEL = "doubao-seedream-5-0-lite";

export const doubaoAdapter: ProviderAdapter = {
  id: "doubao",
  capability: CAPABILITY,
  sizeConstraints: SIZE_CONSTRAINTS,
  resolutionOptions: RESOLUTION_OPTIONS,

  describe(config: ProviderConfig) {
    return { label: config.model ?? DEFAULT_DOUBAO_MODEL, providerId: "doubao" };
  },

  async generate(
    request: OpenAIImageRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    const apiUrl = `${config.apiBaseUrl.replace(/\/+$/, "")}/generations`;
    const model = config.model ?? DEFAULT_DOUBAO_MODEL;
    const size = normalizeDoubaoSize(request.size, SIZE_CONSTRAINTS);

    // 裁剪：豆包只认 model/prompt/size，固定 response_format=b64_json（D2）+ watermark=false（D3）。
    // 丢弃 background/output_format/extra（豆包不支持这些参数）。
    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: request.prompt,
          size,
          response_format: "b64_json",
          watermark: false,
        }),
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    const payload = await parseJsonResponse(response);
    const b64Json = payload?.data?.[0]?.b64_json;
    if (!b64Json) {
      throw new Error(extractErrorMessage(payload) ?? "豆包响应中没有 data[0].b64_json");
    }
    // D2：直接拿 b64_json，不走 urlToB64（豆包支持 response_format=b64_json）。
    return { b64Json };
  },

  async edit(
    request: OpenAIImageEditRequest,
    config: ProviderConfig,
  ): Promise<OpenAIImageResult> {
    // 豆包图生图不分独立 edits 端点——参考图作为 JSON 的 image 字段塞进 /generations。
    // （验证来源：/images/edits 返回 404；Seedream 文档用 images/generations + image 做图生图）
    const apiUrl = `${config.apiBaseUrl.replace(/\/+$/, "")}/generations`;
    const model = config.model ?? DEFAULT_DOUBAO_MODEL;
    const size = normalizeDoubaoSize(request.size, SIZE_CONSTRAINTS);
    // 豆包 edit 用第一张参考图作为 image（SeedEdit 全图编辑）。
    const reference = request.images[0];
    if (!reference) {
      throw new Error("豆包图生图需要至少一张参考图。");
    }
    // image 字段：base64 data URL（OpenAI 兼容惯例：data:<mime>;base64,<b64>）
    const imageDataUrl = `data:${reference.mimeType};base64,${reference.blob.toString("base64")}`;

    let response: Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: request.prompt,
          size,
          image: imageDataUrl,
          response_format: "b64_json",
          watermark: false,
        }),
      });
    } catch {
      throw new Error(UPSTREAM_DISCONNECT_MESSAGE);
    }

    const payload = await parseJsonResponse(response);
    const b64Json = payload?.data?.[0]?.b64_json;
    if (!b64Json) {
      throw new Error(extractErrorMessage(payload) ?? "豆包响应中没有 data[0].b64_json");
    }
    return { b64Json };
  },
};

const UPSTREAM_DISCONNECT_MESSAGE =
  "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。";

/**
 * 把 OpenAI 形状的 size 规整成豆包合法的 `宽x高`。
 *
 * 处理的输入：
 * - "auto" → 豆包默认尺寸（defaultSize，2048x2048）
 * - "WxH" → 钳总像素范围 + 宽高比范围（无步长对齐）
 * - 比例格式（如 "16:9"，来自 web 的 ratio 预设）→ 按比例 + 默认像素算出尺寸再规整
 *
 * 规整策略（豆包双约束）：
 *   1. 宽高比必须在 [1/maxAspectRatio, maxAspectRatio] 内（超了钳到边界）
 *   2. 总像素必须在 [minPixels, maxPixels] 内
 *      - 超上限：按比例缩小长边
 *      - 低于下限：按比例放大长边
 *
 * 注意：豆包无步长对齐（step=1），不像 GLM 需要对齐 32 的倍数。
 *
 * 这是纯函数，便于单测；adapter 内部调用它。
 */
export function normalizeDoubaoSize(
  size: string,
  constraints: SizeConstraints = SIZE_CONSTRAINTS,
): string {
  const trimmed = size.trim();

  if (trimmed === "auto" || trimmed === "") {
    return constraints.defaultSize;
  }

  let width: number;
  let height: number;

  // 比例格式（web 的 ratio 预设会发 "16:9" 这类）
  if (trimmed.includes(":")) {
    const dims = dimensionsFromRatio(trimmed, constraints);
    width = dims.width;
    height = dims.height;
  } else {
    // WxH 格式（web 的 custom 会发 "2048x2048" 这类）
    const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(trimmed);
    if (match) {
      width = Number(match[1]);
      height = Number(match[2]);
    } else {
      // 无法识别 → 回退默认
      console.warn(`[doubao] 无法识别的 size "${trimmed}"，回退默认 ${constraints.defaultSize}`);
      return constraints.defaultSize;
    }
  }

  return finalizeSize(width, height, constraints);
}

/** 按比例 + 目标像素（取 maxPixels 与 minPixels 的几何中间值作基准）算出原始尺寸。 */
function dimensionsFromRatio(ratio: string, constraints: SizeConstraints) {
  const [w, h] = ratio.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 0, height: 0 };
  }
  const aspect = w / h;
  // 基准取上下限的几何平均，落在豆包合法区间内
  const basePixels = Math.sqrt(constraints.minPixels * constraints.maxPixels);
  let width = Math.round(Math.sqrt(basePixels * aspect));
  let height = Math.round(width / aspect);
  return { width, height };
}

/** 规整到豆包合法：钳宽高比 → 钳总像素范围（双向）。无步长对齐。 */
function finalizeSize(
  width: number,
  height: number,
  constraints: SizeConstraints,
): string {
  let w = Math.max(constraints.step, Math.round(width));
  let h = Math.max(constraints.step, Math.round(height));

  const maxAspect = constraints.maxAspectRatio;
  if (maxAspect !== null) {
    // 钳宽高比：超了就把长边缩到 maxAspect 倍短边
    const aspect = w / h;
    if (aspect > maxAspect) {
      w = Math.round(h * maxAspect);
    } else if (aspect < 1 / maxAspect) {
      h = Math.round(w * maxAspect);
    }
  }

  // 钳总像素范围：超上限缩长边，低于下限放长边（保持比例近似）
  const clampPixels = (targetPixels: number) => {
    const ratio = Math.sqrt(targetPixels / (w * h));
    w = Math.max(constraints.step, Math.round(w * ratio));
    h = Math.max(constraints.step, Math.round(h * ratio));
  };
  if (w * h > constraints.maxPixels) {
    clampPixels(constraints.maxPixels);
  } else if (w * h < constraints.minPixels) {
    clampPixels(constraints.minPixels);
  }

  return `${w}x${h}`;
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
