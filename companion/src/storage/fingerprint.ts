/**
 * 配置指纹计算（D7 配置去重的核心）。
 *
 * 同一个存储配置（同一目录 / 同一 OSS bucket+prefix）始终复用同一个数据集，
 * 不重复创建。用户先后两次选同一个目录 → 命中已有数据集 → 看到同一份数据。
 *
 * 指纹规则：
 * - filesystem：`fs:<归一化目录绝对路径>`。
 *   归一化 = realpathSync 解软链 + 去尾斜杠（保证 ~/Pictures 和 /Users/x/Pictures 不重复）。
 * - oss：`oss:<endpoint>:<bucket>:<prefix>`，全部小写化、去首尾斜杠。
 *   **不含 AccessKey**——凭证会变更（轮换、过期），但数据集身份不应随之变化（D7 明确）。
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { FilesystemConfig, OssConfig } from "./types.js";

/** filesystem 模式的配置指纹。 */
export function computeFilesystemFingerprint(directory: string): string {
  return `fs:${normalizeDirectory(directory)}`;
}

/** oss 模式的配置指纹。 */
export function computeOssFingerprint(config: OssConfig): string {
  const endpoint = config.endpoint.replace(/\/+$/, "").toLowerCase();
  const bucket = config.bucket.toLowerCase();
  const prefix = (config.prefix ?? "").replace(/^\/+|\/+$/g, "");
  return `oss:${endpoint}:${bucket}:${prefix}`;
}

/**
 * 归一化目录路径：realpathSync 解软链 + 去尾斜杠。
 *
 * realpathSync 会解析符号链接到真实路径，保证
 *   ~/Pictures → /Users/x/Pictures
 *   /var → /private/var (macOS)
 * 不被当成两个不同数据集。
 *
 * 容错：目录不存在时降级用 path.resolve（不抛错），保证首次创建流程能算出稳定指纹。
 * 此时指纹基于逻辑路径而非物理路径，但同一逻辑路径仍会命中同一指纹，去重语义不变。
 */
export function normalizeDirectory(dir: string): string {
  let resolved: string;
  try {
    resolved = realpathSync(dir);
  } catch {
    // 目录不存在，降级用 resolve 得到绝对路径（解 .. 和 . ，但不解软链）
    resolved = resolve(dir);
  }
  return resolved.replace(/[\\/]+$/, "");
}

/** 根据存储大类分发指纹计算。 */
export function computeFingerprint(
  kind: "filesystem" | "oss",
  config: FilesystemConfig | OssConfig,
): string {
  if (kind === "filesystem") {
    return computeFilesystemFingerprint((config as FilesystemConfig).directory);
  }
  return computeOssFingerprint(config as OssConfig);
}
