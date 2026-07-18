/**
 * Provider profile 数据的薄加载层。
 *
 * 实际数据在 profiles/ 子目录下，每个 provider 一个独立 JSON 文件
 * （文件名即 provider id，如 openai.json / glm.json）。新增 provider 的静态数据只需
 * 在该目录加一个 JSON 文件，无需改动本文件——加载时自动扫描汇总。
 *
 * 本文件负责：
 *   1. 扫描 profiles/ 目录下所有 *.json；
 *   2. 运行时形状校验（JSON 写错字段名/类型时立即抛错，弥补 JSON 无编译期类型检查）；
 *   3. 导出类型化的访问函数。
 *
 * 设计原则（来自 docs/companion-provider-adapter-review.md 的配置化评估）：
 * - 「数据值的不同」→ 配置化（profiles/*.json）。
 * - 「结构或算法的不同」→ 留代码（各 adapter 的 normalizeXxxSize / buildBody / parseResponse）。
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  ProviderAdapterConfig,
  ProviderCapability,
  ResolutionOption,
  SizeConstraints,
} from "./types.js";

/** 按 model 切换的能力数据变体。用于 Wan 这类"同一 provider 不同 model 能力不同"的情况。 */
export type ProfileVariant = {
  /** 匹配此 model 时使用下面的数据（adapter 自己决定匹配规则，通常是精确匹配）。 */
  modelId: string;
  sizeConstraints: SizeConstraints;
  resolutionOptions: readonly ResolutionOption[];
  /** 该 model 的编辑专属限制（未声明的字段继承 provider 级 editConstraints）。 */
  editConstraints?: ProviderEditConstraints;
};

/** Provider 图片编辑专属限制；未声明时由全局安全配置兜底。 */
export type ProviderEditConstraints = {
  /** 上游允许的最大参考图数量。 */
  maxImages?: number;
  /** 编辑支持的分辨率档位；可少于文生图档位（如 Wan Pro 不支持编辑 4K）。 */
  resolutionOptions?: readonly ResolutionOption[];
};

/** Provider 的展示和默认连接信息，供 Web 设置面板和 CLI 共用。 */
export type ProviderProfilePreset = {
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Web/CLI provider 选择器的稳定显示顺序。 */
  order: number;
};

/** 单个 provider 的完整静态 profile。 */
export type ProviderProfile = {
  preset: ProviderProfilePreset;
  capability: ProviderCapability;
  sizeConstraints: SizeConstraints;
  resolutionOptions: readonly ResolutionOption[];
  /** Provider 级编辑限制，model variant 可覆盖其中的字段。 */
  editConstraints?: ProviderEditConstraints;
  /**
   * 按 model 切换的数据变体（可选）。
   * adapter 的 getSizeConstraints/getResolutionOptions 按 model 匹配并返回对应数据，
   * 分支逻辑保留在 adapter，数据集中在 JSON。
   */
  variants?: ProfileVariant[];
  /**
   * adapter 翻译专用的私有配置（可选），不回流 web。
   * gemini/grok 等用枚举值传 size/resolution 的 provider 在此声明枚举集；
   * OpenAI 兼容家族（WxH 像素）通常不需要。详见 ProviderAdapterConfig。
   */
  adapterConfig?: ProviderAdapterConfig;
};

/** JSON 的原始形状（未校验）。 */
type RawProfile = Record<string, unknown>;

const PROFILES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "profiles",
);

/**
 * 扫描 profiles/ 目录，加载并校验所有 *.json，返回类型化的 profile 表。
 * 文件名（去掉 .json）即 provider id。校验失败立即抛错（启动期暴露，不留到运行时）。
 */
function loadConfig(): Record<string, ProviderProfile> {
  const files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json"));
  const result: Record<string, ProviderProfile> = {};
  for (const file of files) {
    const providerId = file.slice(0, -".json".length);
    const raw = JSON.parse(readFileSync(join(PROFILES_DIR, file), "utf8")) as RawProfile;
    result[providerId] = validateProfile(providerId, raw);
  }
  return result;
}

function validateProfile(
  providerId: string,
  raw: unknown,
): ProviderProfile {
  if (!isObject(raw)) {
    throw new Error(`profiles/${providerId}.json: 根节点必须是 object`);
  }
  const preset = validatePreset(providerId, raw.preset);
  const capability = validateCapability(providerId, raw.capability);
  const sizeConstraints = validateSizeConstraints(providerId, raw.sizeConstraints);
  const resolutionOptions = validateResolutionOptions(
    providerId,
    raw.resolutionOptions,
  );
  const editConstraints =
    raw.editConstraints === undefined
      ? undefined
      : validateEditConstraints(providerId, raw.editConstraints);
  const variants = raw.variants === undefined ? undefined : validateVariants(providerId, raw.variants);
  const adapterConfig =
    raw.adapterConfig === undefined
      ? undefined
      : validateAdapterConfig(providerId, raw.adapterConfig);
  return {
    preset,
    capability,
    sizeConstraints,
    resolutionOptions,
    editConstraints,
    variants,
    adapterConfig,
  };
}

function validatePreset(providerId: string, raw: unknown): ProviderProfilePreset {
  if (!isObject(raw)) {
    throw new Error(`profiles/${providerId}.json: "preset" 必须是 object`);
  }
  const { label, defaultBaseUrl, defaultModel, order } = raw;
  if (typeof label !== "string" || !label.trim()) {
    throw new Error(`profiles/${providerId}.json: "preset.label" 必须是非空 string`);
  }
  if (typeof defaultBaseUrl !== "string" || !defaultBaseUrl.trim()) {
    throw new Error(`profiles/${providerId}.json: "preset.defaultBaseUrl" 必须是非空 string`);
  }
  if (typeof defaultModel !== "string" || !defaultModel.trim()) {
    throw new Error(`profiles/${providerId}.json: "preset.defaultModel" 必须是非空 string`);
  }
  if (typeof order !== "number" || !Number.isFinite(order)) {
    throw new Error(`profiles/${providerId}.json: "preset.order" 必须是 number`);
  }
  return { label, defaultBaseUrl, defaultModel, order };
}

function validateCapability(providerId: string, raw: unknown): ProviderCapability {
  if (!isObject(raw)) throw new Error(`profiles/${providerId}.json: "capability" 必须是 object`);
  const { generate, edit, mask, backgrounds, outputFormats } = raw;
  if (generate !== true) throw new Error(`profiles/${providerId}.json: "capability.generate" 必须为 true`);
  if (typeof edit !== "boolean") throw new Error(`profiles/${providerId}.json: "capability.edit" 必须是 boolean`);
  if (typeof mask !== "boolean") throw new Error(`profiles/${providerId}.json: "capability.mask" 必须是 boolean`);
  if (!isStringArray(backgrounds) || backgrounds.length === 0) {
    throw new Error(`profiles/${providerId}.json: "capability.backgrounds" 必须是非空 string[]`);
  }
  if (!isStringArray(outputFormats) || outputFormats.length === 0) {
    throw new Error(`profiles/${providerId}.json: "capability.outputFormats" 必须是非空 string[]`);
  }
  return {
    generate,
    edit,
    mask,
    backgrounds: backgrounds as ProviderCapability["backgrounds"],
    outputFormats: outputFormats as ProviderCapability["outputFormats"],
  };
}

function validateSizeConstraints(providerId: string, raw: unknown): SizeConstraints {
  if (!isObject(raw)) throw new Error(`profiles/${providerId}.json: "sizeConstraints" 必须是 object`);
  const { step, min, max, maxPixels, minPixels, maxAspectRatio, defaultSize } = raw;
  if (typeof step !== "number" || !Number.isFinite(step)) throw new Error(`profiles/${providerId}.json: "sizeConstraints.step" 必须是 number`);
  if (typeof min !== "number" || !Number.isFinite(min)) throw new Error(`profiles/${providerId}.json: "sizeConstraints.min" 必须是 number`);
  if (typeof max !== "number" || !Number.isFinite(max)) throw new Error(`profiles/${providerId}.json: "sizeConstraints.max" 必须是 number`);
  if (typeof maxPixels !== "number" || !Number.isFinite(maxPixels)) throw new Error(`profiles/${providerId}.json: "sizeConstraints.maxPixels" 必须是 number`);
  if (typeof minPixels !== "number" || !Number.isFinite(minPixels)) throw new Error(`profiles/${providerId}.json: "sizeConstraints.minPixels" 必须是 number`);
  if (maxAspectRatio !== null && (typeof maxAspectRatio !== "number" || !Number.isFinite(maxAspectRatio))) {
    throw new Error(`profiles/${providerId}.json: "sizeConstraints.maxAspectRatio" 必须是 number 或 null`);
  }
  if (typeof defaultSize !== "string") throw new Error(`profiles/${providerId}.json: "sizeConstraints.defaultSize" 必须是 string`);
  return {
    step,
    min,
    max,
    maxPixels,
    minPixels,
    maxAspectRatio: maxAspectRatio as number | null,
    defaultSize,
  };
}

function validateResolutionOptions(
  providerId: string,
  raw: unknown,
): readonly ResolutionOption[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`profiles/${providerId}.json: "resolutionOptions" 必须是非空数组`);
  }
  return raw.map((item, i) => {
    if (!isObject(item)) throw new Error(`profiles/${providerId}.json: "resolutionOptions[${i}]" 必须是 object`);
    const { value, label, targetPixels } = item;
    if (typeof value !== "string") throw new Error(`profiles/${providerId}.json: "resolutionOptions[${i}].value" 必须是 string`);
    if (typeof label !== "string") throw new Error(`profiles/${providerId}.json: "resolutionOptions[${i}].label" 必须是 string`);
    if (typeof targetPixels !== "number" || !Number.isFinite(targetPixels)) throw new Error(`profiles/${providerId}.json: "resolutionOptions[${i}].targetPixels" 必须是 number`);
    return { value, label, targetPixels };
  });
}

function validateEditConstraints(
  providerId: string,
  raw: unknown,
): ProviderEditConstraints {
  if (!isObject(raw)) {
    throw new Error(`profiles/${providerId}.json: "editConstraints" 必须是 object`);
  }
  const result: ProviderEditConstraints = {};
  if (raw.maxImages !== undefined) {
    if (
      typeof raw.maxImages !== "number" ||
      !Number.isSafeInteger(raw.maxImages) ||
      raw.maxImages < 1
    ) {
      throw new Error(
        `profiles/${providerId}.json: "editConstraints.maxImages" 必须是正整数`,
      );
    }
    result.maxImages = raw.maxImages;
  }
  if (raw.resolutionOptions !== undefined) {
    result.resolutionOptions = validateResolutionOptions(
      `${providerId} (editConstraints)`,
      raw.resolutionOptions,
    );
  }
  return result;
}

function validateVariants(providerId: string, raw: unknown): ProfileVariant[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`profiles/${providerId}.json: "variants" 必须是非空数组`);
  }
  const seenModelIds = new Set<string>();
  return raw.map((item, i) => {
    if (!isObject(item)) throw new Error(`profiles/${providerId}.json: "variants[${i}]" 必须是 object`);
    const { modelId } = item;
    if (typeof modelId !== "string" || !modelId) {
      throw new Error(`profiles/${providerId}.json: "variants[${i}].modelId" 必须是非空 string`);
    }
    if (seenModelIds.has(modelId)) {
      throw new Error(`profiles/${providerId}.json: "variants[${i}].modelId" 重复：${modelId}`);
    }
    seenModelIds.add(modelId);
    return {
      modelId,
      sizeConstraints: validateSizeConstraints(`${providerId} (variants[${i}])`, item.sizeConstraints),
      resolutionOptions: validateResolutionOptions(`${providerId} (variants[${i}])`, item.resolutionOptions),
      editConstraints:
        item.editConstraints === undefined
          ? undefined
          : validateEditConstraints(`${providerId} (variants[${i}])`, item.editConstraints),
    };
  });
}

/**
 * 校验 adapterConfig（adapter 翻译专用私有配置）。
 * 三个字段全部可选，按 provider 协议差异按需声明。任一字段类型不符立即抛错。
 */
function validateAdapterConfig(
  providerId: string,
  raw: unknown,
): ProviderAdapterConfig {
  if (!isObject(raw)) {
    throw new Error(`profiles/${providerId}.json: "adapterConfig" 必须是 object`);
  }
  const result: ProviderAdapterConfig = {};

  if (raw.supportedAspectRatios !== undefined) {
    if (!isStringArray(raw.supportedAspectRatios) || raw.supportedAspectRatios.length === 0) {
      throw new Error(
        `profiles/${providerId}.json: "adapterConfig.supportedAspectRatios" 必须是非空 string[]`,
      );
    }
    result.supportedAspectRatios = raw.supportedAspectRatios;
  }

  if (raw.resolutionMap !== undefined) {
    if (!isObject(raw.resolutionMap)) {
      throw new Error(
        `profiles/${providerId}.json: "adapterConfig.resolutionMap" 必须是 object`,
      );
    }
    const map: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw.resolutionMap)) {
      if (typeof val !== "string") {
        throw new Error(
          `profiles/${providerId}.json: "adapterConfig.resolutionMap.${key}" 必须是 string`,
        );
      }
      map[key] = val;
    }
    result.resolutionMap = map;
  }

  if (raw.supportedResolutions !== undefined) {
    if (!isStringArray(raw.supportedResolutions) || raw.supportedResolutions.length === 0) {
      throw new Error(
        `profiles/${providerId}.json: "adapterConfig.supportedResolutions" 必须是非空 string[]`,
      );
    }
    result.supportedResolutions = raw.supportedResolutions;
  }

  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** 全部 provider 的 profile 数据（启动时扫描加载并校验一次）。 */
export const PROVIDER_PROFILES: Record<string, ProviderProfile> =
  loadConfig();

/** 按 provider id 取 profile。未配置时返回 undefined（registry 会回退 openai）。 */
export function getProviderProfile(
  providerId: string,
): ProviderProfile | undefined {
  return PROVIDER_PROFILES[providerId];
}
