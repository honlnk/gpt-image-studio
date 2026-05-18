import type { GenerationParams, SizeRatio, SizeResolution } from "../types/studio";

export type LegacySizePreset = "1024x1024" | "1536x1024" | "1024x1536";
export type StoredGenerationParams = Omit<GenerationParams, "resolution" | "size"> & {
  resolution?: SizeResolution;
  size: GenerationParams["size"] | LegacySizePreset;
};

export function normalizeGenerationParams(params: StoredGenerationParams): GenerationParams {
  return {
    ...params,
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

function inferSizeResolution(params: Pick<GenerationParams, "height" | "width">): SizeResolution {
  const pixels = params.width * params.height;
  if (pixels > 2048 * 2048) return "4k";
  if (pixels > 1024 * 1024) return "2k";
  return "1k";
}
