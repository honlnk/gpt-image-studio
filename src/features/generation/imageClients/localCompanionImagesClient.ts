import { applyPromptRewriteGuard } from "../../../services/imagesApi";
import { buildImagePrompt } from "../../../services/promptBuilder";
import type { PromptMode, PromptWordbanks } from "../../../types/studio";
import type {
  CompanionGenerateField,
} from "../../../types/companion";
import type { ImageClient, ImageClientResult } from "./imageClient";

type CompanionClientConfig = {
  getCompanionUrl: () => string;
  getAccessKey: () => string;
  getModel: () => string;
};

export function createLocalCompanionImagesClient(config: CompanionClientConfig): ImageClient {
  function headers() {
    const key = config.getAccessKey();
    if (!key) {
      throw new Error("尚未连接 Companion，请先在设置中输入连接密钥。");
    }
    return { Authorization: `Bearer ${key}` };
  }

  return {
    async generate(input) {
      const url = `${config.getCompanionUrl()}/images/generations`;
      const model = config.getModel();
      const modePrompt = applyPromptMode(
        input.prompt,
        input.promptRequestSettings.promptMode,
        input.promptRequestSettings.promptWordbanks,
      );
      const prompt = applyPromptRewriteGuard(
        modePrompt,
        input.promptRequestSettings.promptRewriteGuardEnabled,
        input.promptRequestSettings.promptRewriteGuardText,
      );

      const params = buildParams(input.params);
      const response = await fetch(url, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, ...params }),
      });

      return extractB64Json(response);
    },

    async edit(input) {
      const url = `${config.getCompanionUrl()}/images/edits`;
      const model = config.getModel();
      const modePrompt = applyPromptMode(
        input.prompt,
        input.promptRequestSettings.promptMode,
        input.promptRequestSettings.promptWordbanks,
      );
      const prompt = applyPromptRewriteGuard(
        modePrompt,
        input.promptRequestSettings.promptRewriteGuardEnabled,
        input.promptRequestSettings.promptRewriteGuardText,
      );

      const body = new FormData();
      body.append("model", model);
      body.append("prompt", prompt);
      input.images.forEach((image) => {
        body.append("image[]", image.blob, image.name);
      });
      if (input.mask) {
        body.append("mask", input.mask.blob, input.mask.name);
      }
      const params = buildParams(input.params);
      Object.entries(params).forEach(([key, value]) => {
        body.append(key, value);
      });

      const response = await fetch(url, {
        method: "POST",
        headers: headers(),
        body,
      });

      return extractB64Json(response);
    },
  };
}

function applyPromptMode(prompt: string, mode: PromptMode, wordbanks: PromptWordbanks) {
  return buildImagePrompt({ prompt, mode, wordbanks });
}

function buildParams(params: {
  size: string;
  resolution: string;
  width: number;
  height: number;
  background: string;
  outputFormat: string;
}) {
  const size = params.size === "auto"
    ? "auto"
    : params.size.includes(":") || params.size === "custom"
      ? `${params.width}x${params.height}`
      : params.size;

  // 编译期断言：这里发出的字段名必须在 COMPANION_GENERATE_FIELDS 白名单里，
  // 否则 Companion route 层会把它们当作未知字段塞进 extra，导致能力静默失效。
  // 字段名漂移由 companionKnownFields.contract.test.ts 兜底。
  // 用 Partial + satisfies：key 必须属于白名单，但不要求全覆盖
  // （model / prompt 在调用点单独传，不在这里）。
  return {
    size,
    companion_resolution: params.resolution,
    background: params.background,
    output_format: params.outputFormat,
  } satisfies Partial<Record<CompanionGenerateField, string>>;
}

async function extractB64Json(response: Response): Promise<ImageClientResult> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const statusMessage = `请求失败：HTTP ${response.status}`;
    const detail = payload.error?.message || payload.error;
    const message = detail
      ? `${statusMessage}：${typeof detail === "string" ? detail : JSON.stringify(detail)}`
      : statusMessage;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  const imageData = payload.data?.[0]?.b64_json;
  if (!imageData) {
    throw new Error("响应中没有 data[0].b64_json。");
  }
  const item = payload.data?.[0];
  return {
    b64Json: imageData,
    revisedPrompt: item?.revised_prompt,
    mimeType: typeof item?.mime_type === "string" ? item.mime_type : undefined,
  };
}
