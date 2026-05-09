import type { ImageClient } from "./imageClient";

export function createLocalCompanionImagesClient(): ImageClient {
  return {
    async generate() {
      throw new Error("本地 companion 模式尚未启用。");
    },
    async edit() {
      throw new Error("本地 companion 模式尚未启用。");
    },
  };
}
