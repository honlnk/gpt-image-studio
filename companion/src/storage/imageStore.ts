/**
 * 图片存储 adapter 抽象接口。
 *
 * 对应 evolution-roadmap.md D6 三选项：
 * - FileSystemImageStore 覆盖选项 A（用户指定目录）和 B（Companion 默认目录）。
 * - OssImageStore 覆盖选项 C（阿里云 OSS），PR5 实现。
 *
 * 设计要点：
 * - 接口与具体存储位置解耦：save/load/remove 按 blobKey 操作，adapter 内部决定
 *   落到文件系统还是 OSS。
 * - ImageAsset.blobKey 在元数据里仍是唯一引用——A/B 模式 blobKey=文件名主体，
 *   C 模式 blobKey=OSS object key。
 * - 前端 CompanionStorage.saveImageBlob/loadImageBlob 不感知具体位置，
 *   由 Companion 根据 dataset_registry 的 image_store_kind 路由到对应 adapter。
 *
 * 注意：本接口不持久化 mimeType——选项 B（不透明 Blob）和 C（OSS）的 mimeType
 * 由调用方（路由层）从业务 db 的 imageBlobs 表元信息补全。选项 A 可从文件扩展名反推。
 */
import type { ImageStoreKind } from "./types.js";

export type SavedImage = { size: number; mimeType: string };
export type LoadedImage = { data: Buffer; mimeType: string };

export interface ImageStore {
  /** 存储位置标识，对应 dataset_registry.image_store_kind。 */
  readonly kind: ImageStoreKind;

  /**
   * 保存图片二进制。
   *
   * @param key blobKey（元数据里的唯一引用）
   * @param data 图片字节
   * @param mimeType 图片 MIME（如 "image/png"），adapter 可能用于决定文件扩展名
   * @returns 实际写入的字节大小 + 最终确定的 mimeType
   */
  save(key: string, data: Buffer, mimeType: string): Promise<SavedImage>;

  /**
   * 读取图片二进制。
   *
   * @param key blobKey
   * @returns 图片字节 + mimeType；找不到返回 undefined
   */
  load(key: string): Promise<LoadedImage | undefined>;

  /** 删图片。key 不存在是 no-op（与 StudioStorage.deleteImageBlob 语义一致）。 */
  remove(key: string): Promise<void>;

  /** 统计当前 adapter 下的图片总字节（用于 estimateStoredBytes）。 */
  estimateBytes(): Promise<number>;
}

/** MIME → 文件扩展名映射（选项 A 文件命名用）。 */
export const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
};

/** 文件扩展名 → MIME 映射（选项 A load 时反推 mimeType 用）。 */
export const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

/** 兜底 MIME：未知扩展名或不透明 Blob 模式下用。 */
export const FALLBACK_MIME = "application/octet-stream";
