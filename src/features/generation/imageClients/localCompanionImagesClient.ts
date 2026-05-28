import { applyPromptRewriteGuard } from "../../../services/imagesApi";
import { buildImagePrompt } from "../../../services/promptBuilder";
import type { PromptMode, PromptWordbanks } from "../../../types/studio";
import type { ImageClient, ImageClientResult } from "./imageClient";

type CompanionClientConfig = {
  getCompanionUrl: () => string;
  getSessionToken: () => string;
  getModel: () => string;
  getPromptMode: () => PromptMode;
  getPromptWordbanks: () => PromptWordbanks;
  getPromptRewriteGuardEnabled: () => boolean;
  getPromptRewriteGuardText: () => string;
};

export function createLocalCompanionImagesClient(config: CompanionClientConfig): ImageClient {
  function headers() {
    const token = config.getSessionToken();
    if (!token) {
      throw new Error("尚未与本地 Companion 配对，请先在设置中完成配对。");
    }
    return { Authorization: `Bearer ${token}` };
  }

  return {
    async generate(input) {
      const url = `${config.getCompanionUrl()}/images/generations`;
      const model = config.getModel();
      const modePrompt = applyPromptMode(
        input.prompt,
        config.getPromptMode(),
        config.getPromptWordbanks(),
      );
      const prompt = applyPromptRewriteGuard(
        modePrompt,
        config.getPromptRewriteGuardEnabled(),
        config.getPromptRewriteGuardText(),
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
        config.getPromptMode(),
        config.getPromptWordbanks(),
      );
      const prompt = applyPromptRewriteGuard(
        modePrompt,
        config.getPromptRewriteGuardEnabled(),
        config.getPromptRewriteGuardText(),
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

function buildParams(params: { size: string; width: number; height: number; background: string; outputFormat: string }) {
  const size = params.size === "auto"
    ? "auto"
    : params.size.includes(":") || params.size === "custom"
      ? `${params.width}x${params.height}`
      : params.size;

  return {
    size,
    background: params.background,
    output_format: params.outputFormat,
    response_format: "b64_json",
  };
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
  return {
    b64Json: imageData,
    revisedPrompt: payload.data?.[0]?.revised_prompt,
  };
}
