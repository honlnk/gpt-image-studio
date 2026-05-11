import { editImage, generateImage } from "../../../services/imagesApi";
import type { ImageClient } from "./imageClient";

type DirectClientConfig = {
  getApiBaseUrl: () => string;
  getApiKey: () => string;
  getModel: () => string;
};

export function createDirectImagesClient(config: DirectClientConfig): ImageClient {
  return {
    async generate(input) {
      const apiBaseUrl = config.getApiBaseUrl().trim();
      const apiKey = config.getApiKey().trim();
      const model = config.getModel();

      if (!apiKey) {
        throw new Error("请先在设置里填写 OpenAI API key。");
      }

      if (!apiBaseUrl) {
        throw new Error("请先在设置里填写 API Base URL。");
      }

      return generateImage({
        apiBaseUrl,
        apiKey,
        model,
        prompt: input.prompt,
        params: input.params,
      });
    },
    async edit(input) {
      const apiBaseUrl = config.getApiBaseUrl().trim();
      const apiKey = config.getApiKey().trim();
      const model = config.getModel();

      if (!apiKey) {
        throw new Error("请先在设置里填写 OpenAI API key。");
      }

      if (!apiBaseUrl) {
        throw new Error("请先在设置里填写 API Base URL。");
      }

      return editImage({
        apiBaseUrl,
        apiKey,
        model,
        prompt: input.prompt,
        params: input.params,
        images: input.images,
        mask: input.mask,
      });
    },
  };
}
