import type { GenerationParams, SizeRatio, SizeResolution } from "../types/studio";

export type LegacySizePreset = "1024x1024" | "1536x1024" | "1024x1536";
export type StoredGenerationParams = Omit<GenerationParams, "imageCount" | "resolution" | "size"> & {
  imageCount?: number;
  resolution?: SizeResolution;
  size: GenerationParams["size"] | LegacySizePreset;
};

export const MIN_IMAGE_COUNT = 1;

export function normalizeGenerationParams(params: StoredGenerationParams): GenerationParams {
  return {
    ...params,
    imageCount: normalizeImageCount(params.imageCount),
    resolution: params.resolution ?? inferSizeResolution(params),
    size: normalizeSizePreset(params.size),
  };
}

export function normalizeSizePreset(size: StoredGenerationParams["size"]): GenerationParams["size"] {
  if (size === "1024x1024") return "1:1";
  if (size === "1536x1024") return "3:2";
  if (size === "1024x1536") return "2:3";

  return size;
}

export function isSizeRatio(size: GenerationParams["size"]): size is SizeRatio {
  return size.includes(":");
}

export function normalizeImageCount(count: unknown) {
  const numericCount = typeof count === "number" ? count : Number(count);
  if (!Number.isFinite(numericCount)) return MIN_IMAGE_COUNT;

  return Math.max(MIN_IMAGE_COUNT, Math.round(numericCount));
}

function inferSizeResolution(params: Pick<GenerationParams, "height" | "width">): SizeResolution {
  const pixels = params.width * params.height;
  if (pixels > 2048 * 2048) return "4k";
  if (pixels > 1024 * 1024) return "2k";
  return "1k";
}
