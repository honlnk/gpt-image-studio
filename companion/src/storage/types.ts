/**
 * 存储层类型定义。
 *
 * 对应 evolution-roadmap.md 第七章 D7 双层结构：
 * - 主 db studio.db 的 dataset_registry 表（见 db.ts）。
 * - 业务 db 的 7 张业务表（见 businessDb.ts）。
 *
 * 这些类型是 Companion 内部存储语义，不直接回流 Web 端——Web 端通过
 * /storage/* 路由拿到的是视图类型（DatasetView）或 JSON 值（业务对象）。
 */

/** 图片存储位置大类：文件系统 / 对象存储。 */
export type StorageKind = "filesystem" | "oss";

/**
 * 图片存储位置的细分（对应 D6 的三选项）。
 * - filesystem-default：选项 B，Companion 默认目录 ~/.gpt-image-studio/images，不透明 Blob。
 * - filesystem-custom：选项 A，用户指定目录，可直接打开的图片文件。
 * - oss：选项 C，阿里云 OSS。
 */
export type ImageStoreKind =
  | "filesystem-default"
  | "filesystem-custom"
  | "oss";

/** 文件系统存储配置（选项 A/B）。 */
export type FilesystemConfig = {
  /** 绝对路径。选项 B 固定为 ~/.gpt-image-studio/images；选项 A 为用户输入。 */
  directory: string;
};

/** OSS 存储配置（选项 C）。不含 AccessKey（AccessKey 在 credentials.json）。 */
export type OssConfig = {
  endpoint: string;
  bucket: string;
  prefix: string;
};

export type StorageConfig = FilesystemConfig | OssConfig;

/**
 * dataset_registry 表的一行（主 db）。
 * 字段对应 schema.ts 的 MASTER_DB_DDL。
 */
export type DatasetRecord = {
  id: string;
  label: string;
  storage_kind: StorageKind;
  /** JSON.stringify(StorageConfig)。读取时由调用方 JSON.parse。 */
  storage_config: string;
  /** 配置指纹（见 fingerprint.ts），UNIQUE。 */
  fingerprint: string;
  /** 业务 db 的绝对路径（datasets/<id>.db）。 */
  db_path: string;
  image_store_kind: ImageStoreKind;
  /** ISO timestamp。 */
  created_at: string;
  /** ISO timestamp，最近一次激活时间。 */
  activated_at: string;
  /** SQLite 存 0/1，TS 里用 number 保持与 DB 行一致。 */
  is_active: 0 | 1;
};

/** 查询/返回时把 is_active 数字转 boolean 的视图类型（回流 Web 端用）。 */
export type DatasetView = Omit<DatasetRecord, "is_active"> & {
  is_active: boolean;
};
