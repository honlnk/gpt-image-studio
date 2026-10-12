import { ApiClientError } from "../../../shared/apiErrorCodes";
import { t } from "../../../i18n";
import type { ApiMode } from "../../../types/studio";
import { editImage, generateImage } from "../../../services/imagesApi";
import type { SizeConstraints } from "../../../services/imagesApi";
import type { ImageClient } from "./imageClient";

type DirectClientConfig = {
  getApiBaseUrl: () => string;
  getApiBaseUrlMode: () => "origin" | "full";
  getApiMode: () => ApiMode;
  getApiKey: () => string;
  getModel: () => string;
  getStreamImages: () => boolean;
  getStreamPartialImages: () => 0 | 1 | 2 | 3;
  getSupportsTransparent: () => boolean;
  getSizeConstraints: () => SizeConstraints;
};

export function createDirectImagesClient(config: DirectClientConfig): ImageClient {
  return {
    async generate(input) {
      const apiBaseUrl = config.getApiBaseUrl().trim();
      const apiKey = config.getApiKey().trim();
      const model = config.getModel();

      if (!apiKey) {
        throw new ApiClientError("api-key-missing", t("errors.api.apiKeyMissing"));
      }

      if (!apiBaseUrl) {
        throw new ApiClientError("base-url-missing", t("errors.api.baseUrlMissing"));
      }

      return generateImage({
        apiBaseUrl,
        apiBaseUrlMode: config.getApiBaseUrlMode(),
        apiMode: config.getApiMode(),
        apiKey,
        model,
        prompt: input.prompt,
        promptMode: input.promptRequestSettings.promptMode,
        promptWordbanks: input.promptRequestSettings.promptWordbanks,
        promptRewriteGuardEnabled:
          input.promptRequestSettings.promptRewriteGuardEnabled,
        promptRewriteGuardText:
          input.promptRequestSettings.promptRewriteGuardText,
        streamImages: config.getStreamImages(),
        streamPartialImages: config.getStreamPartialImages(),
        onPartialImage: input.onPartialImage,
        params: input.params,
        supportsTransparent: config.getSupportsTransparent(),
        sizeConstraints: config.getSizeConstraints(),
      });
    },
    async edit(input) {
      const apiBaseUrl = config.getApiBaseUrl().trim();
      const apiKey = config.getApiKey().trim();
      const model = config.getModel();

      if (!apiKey) {
        throw new ApiClientError("api-key-missing", t("errors.api.apiKeyMissing"));
      }

      if (!apiBaseUrl) {
        throw new ApiClientError("base-url-missing", t("errors.api.baseUrlMissing"));
      }

      return editImage({
        apiBaseUrl,
        apiBaseUrlMode: config.getApiBaseUrlMode(),
        apiMode: config.getApiMode(),
        apiKey,
        model,
        prompt: input.prompt,
        promptMode: input.promptRequestSettings.promptMode,
        promptWordbanks: input.promptRequestSettings.promptWordbanks,
        promptRewriteGuardEnabled:
          input.promptRequestSettings.promptRewriteGuardEnabled,
        promptRewriteGuardText:
          input.promptRequestSettings.promptRewriteGuardText,
        streamImages: config.getStreamImages(),
        streamPartialImages: config.getStreamPartialImages(),
        onPartialImage: input.onPartialImage,
        params: input.params,
        images: input.images,
        mask: input.mask,
        supportsTransparent: config.getSupportsTransparent(),
        sizeConstraints: config.getSizeConstraints(),
      });
    },
  };
}
