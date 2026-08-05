/**
 * 存储层错误类型。
 *
 * 范式对齐 `CredentialStoreError`（src/credentials.ts）：
 * - 自定义 Error 子类 + `this.name` + ES2022 `cause`。
 * - `code` 字段供 route 层（storeRouteWrapper 模式）构造响应体。
 * - `message` 是中文用户可读文案。
 *
 * 注意：SQLite 自身的错误（如磁盘满、文件锁）不会被包装成 StorageStoreError——
 * 它们是 better-sqlite3 抛的原生 Error，route 层用 try/catch 兜底转 500。
 * 只有「应用层语义错误」（非法表名、序列化失败、数据集不存在）才用本类。
 */
export class StorageStoreError extends Error {
  readonly code: StorageErrorCode;

  constructor(
    message: string,
    code: StorageErrorCode,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "StorageStoreError";
    this.code = code;
  }
}

export type StorageErrorCode =
  /** 路由传入非法业务表名（不在 BUSINESS_TABLES 内）。防 SQL 注入。 */
  | "STORAGE_INVALID_TABLE"
  /** key 不合法（空字符串、类型错）。 */
  | "STORAGE_INVALID_KEY"
  /** JSON 序列化/反序列化失败（如循环引用、脏数据）。 */
  | "STORAGE_SERIALIZATION"
  /** db 文件打开失败（权限、损坏）。 */
  | "STORAGE_DB_OPEN"
  /** 数据集不存在（按 id 查询未命中）。 */
  | "STORAGE_DATASET_NOT_FOUND"
  /** 配置指纹冲突（理论不应发生，UNIQUE 约束兜底）。 */
  | "STORAGE_FINGERPRINT_CONFLICT"
  /** 分页查询参数不合法（表不支持分页/过滤组合、limit 越界）。 */
  | "STORAGE_INVALID_QUERY"
  /** 分页游标无法解码（非本服务产出的 opaque cursor）。 */
  | "STORAGE_INVALID_CURSOR"
  /** 兜底。 */
  | "STORAGE_UNKNOWN";
