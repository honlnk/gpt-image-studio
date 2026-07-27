/**
 * CompanionStorage —— StudioStorage 的 Companion 后端实现（阶段二填充）。
 *
 * 把 StudioStorage 接口的每个方法映射为 fetch 调用 Companion 的 /storage/* 路由：
 * - list/get/put/delete/clear → /storage/:table/*
 * - saveImageBlob/loadImageBlob/deleteImageBlob → /storage/blobs/*
 * - readConfig/writeConfig → /storage/config/*
 * - estimateStoredBytes → /storage/usage
 *
 * companionUrl 和 companionAccessKey 通过 getter 函数惰性读取（每次 fetch 时取最新值），
 * 避免装配顺序循环依赖（resolveStorage 在 settingsStore 之前调用，但 getter 闭包持有 ref）。
 *
 * 错误映射：HTTP 非 2xx → StorageError
 *   401/403 → BACKEND_UNAVAILABLE（鉴权失败，Companion 不可用）
 *   404     → KEY_NOT_FOUND（资源不存在，但接口契约要求 get/load 返回 undefined 而非抛错，
 *             所以 404 在 get/loadImageBlob/readConfig 里被吞掉返回 undefined）
 *   400     → SERIALIZATION_ERROR
 *   其它    → UNKNOWN
 */
import { StorageError, type StoreName, type StudioStorage } from "./types";

export type CompanionStorageOptions = {
  /** 惰性读取 Companion 服务地址（每次 fetch 时取最新，避免装配顺序耦合）。 */
  getCompanionUrl: () => string;
  /** 惰性读取 Companion 连接密钥。 */
  getCompanionAccessKey: () => string;
  /**
   * 自定义 fetch（测试用，注入 mock）。生产环境用全局 fetch。
   * 类型放宽为 unknown 内部再断言，避免对 undici Fetch 类型耦合。
   */
  fetchImpl?: typeof fetch;
};

export class CompanionStorage implements StudioStorage {
  readonly backend = "companion" as const;
  private readonly getCompanionUrl: () => string;
  private readonly getCompanionAccessKey: () => string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CompanionStorageOptions) {
    this.getCompanionUrl = opts.getCompanionUrl;
    this.getCompanionAccessKey = opts.getCompanionAccessKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ─── 通用 CRUD ───

  async list<T>(store: StoreName): Promise<T[]> {
    const res = await this.request("GET", `/storage/${store}`);
    const body = (await res.json()) as { data: T[] };
    return body.data;
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const res = await this.request("GET", `/storage/${store}/${String(key)}`, {
      allow404: true,
    });
    if (res.status === 404) return undefined;
    return (await res.json()) as T;
  }

  async put<T>(store: StoreName, value: T): Promise<void> {
    // IndexedDB put 用 keyPath 自动提取 key，CompanionStorage 需要显式 key。
    // 约定：业务对象都有 id 字段（conversations/messages/imageAssets 等），
    // 或对于 settings 是固定 key。这里从 value 提取 key。
    const key = extractKey(store, value);
    await this.request("PUT", `/storage/${store}/${String(key)}`, {
      method: "PUT",
      body: JSON.stringify(value),
      headers: { "content-type": "application/json" },
    });
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    await this.request("DELETE", `/storage/${store}/${String(key)}`, {
      allow404: true,
    });
  }

  async clear(store: StoreName): Promise<void> {
    await this.request("DELETE", `/storage/${store}`);
  }

  // ─── 图片二进制 ───

  async saveImageBlob(key: string, blob: Blob): Promise<void> {
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const mimeType = blob.type || "application/octet-stream";

    // multipart/form-data：file 字段 + mimeType 字段
    const boundary = `----gpt-image-studio-${Math.random().toString(16).slice(2)}`;
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="blob"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const middle = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="mimeType"\r\n\r\n${mimeType}\r\n`;
    const footer = `--${boundary}--\r\n`;
    const encoder = new TextEncoder();
    const body = new Blob([
      encoder.encode(header),
      buffer,
      encoder.encode(middle),
      encoder.encode(footer),
    ]);

    await this.request("POST", `/storage/blobs/${encodeURIComponent(key)}`, {
      method: "POST",
      body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
  }

  async loadImageBlob(key: string): Promise<Blob | undefined> {
    const res = await this.request("GET", `/storage/blobs/${encodeURIComponent(key)}`, {
      allow404: true,
    });
    if (res.status === 404) return undefined;
    const arrayBuffer = await res.arrayBuffer();
    const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
    return new Blob([arrayBuffer], { type: mimeType });
  }

  async deleteImageBlob(key: string): Promise<void> {
    await this.request("DELETE", `/storage/blobs/${encodeURIComponent(key)}`, {
      allow404: true,
    });
  }

  // ─── 配置（settings 表 __config__: 命名空间） ───

  async readConfig<T>(key: string): Promise<T | undefined> {
    const res = await this.request("GET", `/storage/config/${encodeURIComponent(key)}`, {
      allow404: true,
    });
    if (res.status === 404) return undefined;
    const body = (await res.json()) as { value: T };
    return body.value;
  }

  async writeConfig<T>(key: string, value: T): Promise<void> {
    await this.request("PUT", `/storage/config/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify(value),
      headers: { "content-type": "application/json" },
    });
  }

  // ─── 容量估算 ───

  async estimateStoredBytes(): Promise<{ imageBytes: number; metadataBytes: number }> {
    const res = await this.request("GET", "/storage/usage");
    return (await res.json()) as { imageBytes: number; metadataBytes: number };
  }

  // ─── 内部 fetch 封装 ───

  private baseUrl(): string {
    const url = this.getCompanionUrl().replace(/\/+$/, "");
    return url;
  }

  private authHeader(): string {
    const key = this.getCompanionAccessKey();
    return `Bearer ${key}`;
  }

  private async request(
    method: string,
    path: string,
    opts: {
      body?: BodyInit;
      headers?: Record<string, string>;
      allow404?: boolean;
      method?: string; // opts.method 优先于外层 method（兼容 PUT/POST）
    } = {},
  ): Promise<Response> {
    const url = `${this.baseUrl()}${path}`;
    const res = await this.fetchImpl(url, {
      method: opts.method ?? method,
      body: opts.body,
      headers: {
        authorization: this.authHeader(),
        ...opts.headers,
      },
    });

    if (res.status === 401 || res.status === 403) {
      throw new StorageError(
        "BACKEND_UNAVAILABLE",
        `Companion 鉴权失败 (${res.status})，请检查连接密钥或 Companion 是否在线`,
      );
    }
    if (res.status === 404) {
      if (opts.allow404) return res;
      // 非 get/load/delete 的 404 视为后端路由缺失
      throw new StorageError("BACKEND_UNAVAILABLE", `Companion 路由不存在: ${path}`);
    }
    if (res.status === 400) {
      const body = await safeReadError(res);
      throw new StorageError("SERIALIZATION_ERROR", `Companion 拒绝请求 (400): ${body}`);
    }
    if (!res.ok) {
      const body = await safeReadError(res);
      throw new StorageError("UNKNOWN", `Companion 请求失败 (${res.status}): ${body}`);
    }
    return res;
  }
}

async function safeReadError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return JSON.stringify(body);
  } catch {
    try {
      return await res.text();
    } catch {
      return "<unreadable>";
    }
  }
}

/**
 * 从业务对象提取 key（对应 IndexedDB 的 keyPath）。
 *
 * CompanionStorage.put 需要 URL 里带 key，但 IndexedDB 是 keyPath 自动提取。
 * 这里镜像 IndexedDB 的 keyPath 规则（见 IndexedDbStorage 的 DB_KEY_PATHS）。
 *
 * settings 表特殊：业务记录可能是 { id } 或 { key } 形态（settings.ts 单记录用
 * 固定 key，契约测试用 { key: "app", value } 形态）。优先取 id，其次 key，兜底固定 key。
 */
function extractKey(store: StoreName, value: unknown): string {
  const v = value as Record<string, unknown>;
  switch (store) {
    case "conversations":
    case "messages":
    case "imageAssets":
    case "analyticsEvents":
      return String(v.id);
    case "imageBlobs":
      return String(v.key);
    case "conversationDrafts":
      return String(v.conversationId);
    case "settings":
      // 优先 id，其次 key（契约测试用 { key: "app" } 形态），兜底固定 key
      if (typeof v.id === "string") return v.id;
      if (typeof v.key === "string") return v.key;
      return "__app_settings__";
    default:
      return String(v.id ?? v.key ?? "unknown");
  }
}
