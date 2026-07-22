import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 多配置凭据存储。
 *
 * credentials.json 从单对象重构为 { entries, activeId } 结构：
 * - entries：多条 provider 配置（label / provider / base url / key / model）。
 * - activeId：指向当前激活的那条；images 路由和 /auth/status 只消费它。
 *
 * 不兼容旧的单对象格式——升级前需删掉旧的 credentials.json。
 *
 * 损坏处理（P3-A）：JSON 不可解析或结构不合法时不再静默返空 store——那样会让
 * 后续 addCredential/updateCredential 等「读-改-写」操作覆盖原始损坏文件，数据
 * 永久丢失。现在 loadStore 会先把损坏文件备份到 credentials.json.corrupt-{ts}.json，
 * 再抛 CredentialStoreError，让 route 层把明确的「凭据文件损坏」原因回传给 Web/CLI。
 */

/**
 * 凭据存储读取/校验失败的统一异常类型。
 *
 * - `code` 区分 JSON 解析失败 (`CRED_PARSE_FAILED`) 与结构不合法 (`CRED_INVALID_STRUCTURE`)，
 *   route 层可据此构造响应体；`message` 是中文用户可读文案（含备份文件路径）。
 * - `cause` 保留原始异常（如 SyntaxError）用于日志，不进入响应体。
 * - 范式对齐 `ProviderCallError`：自定义 Error 子类 + `this.name` + ES2022 `cause`。
 */
export class CredentialStoreError extends Error {
  readonly code: "CRED_PARSE_FAILED" | "CRED_INVALID_STRUCTURE";

  constructor(
    message: string,
    code: "CRED_PARSE_FAILED" | "CRED_INVALID_STRUCTURE",
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CredentialStoreError";
    this.code = code;
  }
}

/**
 * 凭据损坏事件（内存缓存，进程级）。
 *
 * 为什么需要这个：loadStore 检测到损坏时会备份并移走原文件，损坏信号是「一次性」的——
 * 后续 loadStore 会发现文件不存在，返空 store 走正常路径，损坏信息丢失。
 * 但 Web 端可能连续发多次 /credentials（页面初始化、watch 触发等），第一次拿到 500+corrupt
 * 后，第二次只拿到 200 空列表，credError 被清空，用户根本看不到损坏提示。
 *
 * 内存缓存把损坏事件提升为「进程内持久状态」：
 * - 备份后记录事件（message + backupPath + timestamp）
 * - /credentials GET 在 store 正常时检查是否有未消费事件，有则仍返 500+corrupt
 * - addCredential 成功后清除事件（语义：用户已重新配置，损坏翻篇）
 * - 进程重启后事件消失（可接受：重启意味着用户主动介入，此时文件已是干净状态）
 *
 * 不持久化到磁盘：损坏事件是临时 UX 信号，不是业务数据；且进程重启场景下
 * 「文件不存在」本身就是干净的初始状态，不需要再提示历史损坏。
 */
type CorruptionEvent = {
  message: string;
  backupPath: string;
  timestamp: number;
};

let lastCorruptionEvent: CorruptionEvent | null = null;

/** 记录一次损坏事件（loadStore 备份后调用）。 */
function recordCorruptionEvent(message: string, backupPath: string): void {
  lastCorruptionEvent = { message, backupPath, timestamp: Date.now() };
}

/**
 * 读取并消费未确认的损坏事件。
 *
 * 语义：route 层 GET /credentials 在 store 正常加载后调用此函数；
 * 若有事件，仍返 500+corrupt 让 Web 能看到，事件保留（不清除）——
 * 因为 Web 端可能再次刷新页面，需要再次看到。
 *
 * 事件只在 addCredential 成功后通过 clearCorruptionEvent 显式清除，
 * 语义是「用户已重新配置 provider，损坏翻篇」。
 */
export function consumeCorruptionEvent(): CorruptionEvent | null {
  return lastCorruptionEvent;
}

/** 清除损坏事件（addCredential 成功后调用）。 */
export function clearCorruptionEvent(): void {
  lastCorruptionEvent = null;
}

export type CredentialEntry = {
  id: string;
  /** 用户起的名字，如「豆包测试号」「GLM 生产」。 */
  label: string;
  /** provider id（openai/glm/doubao/qwen/wan/grok/gemini）。 */
  provider: string;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  createdAt: string;
  updatedAt: string;
};

export type CredentialsStore = {
  entries: CredentialEntry[];
  activeId: string | null;
};

/** 新增/编辑时用户填写的字段（id / 时间戳由存储层自动管理）。 */
export type CredentialInput = {
  label?: string;
  provider?: string;
  apiBaseUrl: string;
  apiKey: string;
  model?: string;
};

const CONFIG_DIR = process.env.GPT_IMAGE_STUDIO_CONFIG_DIR ?? join(homedir(), ".gpt-image-studio");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");

function emptyStore(): CredentialsStore {
  return { entries: [], activeId: null };
}

/**
 * 读取并校验凭据 store。
 *
 * 三种结果：
 * - 文件不存在 → 返空 store（首次使用，正常）。
 * - JSON 不可解析或结构不合法 → **先把损坏文件备份**，再抛 CredentialStoreError。
 *   备份是为了让用户能手动恢复；抛错（而非返空 store）是为了阻止后续「读-改-写」
 *   操作覆盖原始数据。route 层捕获错误后把原因回传给 Web/CLI。
 * - 孤儿 activeId（指向不存在的 entry）→ 不视为损坏，静默回退到首条 entry
 *   （和 removeCredential 的回退逻辑一致），记 warn 日志。
 */
export function loadStore(): CredentialsStore {
  if (!existsSync(CREDENTIALS_FILE)) return emptyStore();

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
  } catch (cause) {
    const backup = backupCorruptFile();
    const message = `凭据文件无法解析（JSON 格式错误），已备份到 ${backup}。请检查文件或重新配置 provider。`;
    recordCorruptionEvent(message, backup);
    throw new CredentialStoreError(message, "CRED_PARSE_FAILED", { cause });
  }

  const validation = validateStore(parsed);
  if (!validation.ok) {
    const backup = backupCorruptFile();
    const message = `凭据文件结构不合法：${validation.reason}，已备份到 ${backup}。请重新配置 provider。`;
    recordCorruptionEvent(message, backup);
    throw new CredentialStoreError(message, "CRED_INVALID_STRUCTURE");
  }

  const store = normalizeActiveId(validation.store);
  return store;
}

/**
 * 校验 parsed JSON 是否符合 CredentialsStore 结构。
 *
 * 严格校验每个 entry 的 8 个字段（id/label/provider/apiBaseUrl/apiKey/model/
 * createdAt/updatedAt）全部存在且为非空 string。任一缺失视为损坏——这些字段
 * 都由 addCredential/updateCredential 自动写入，缺失意味着文件被外部编辑过，
 * 这类文件风险高，宁可误判也不要漏过（项目凭据格式已强转，不存在遗留旧格式）。
 */
function validateStore(data: unknown): { ok: true; store: CredentialsStore } | { ok: false; reason: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "根节点不是 object" };
  }
  const obj = data as { entries?: unknown; activeId?: unknown };

  if (!Array.isArray(obj.entries)) {
    return { ok: false, reason: "entries 不是数组" };
  }

  const REQUIRED_FIELDS: ReadonlyArray<keyof CredentialEntry> = [
    "id",
    "label",
    "provider",
    "apiBaseUrl",
    "apiKey",
    "model",
    "createdAt",
    "updatedAt",
  ];

  for (let i = 0; i < obj.entries.length; i++) {
    const entry = obj.entries[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, reason: `entries[${i}] 不是 object` };
    }
    for (const field of REQUIRED_FIELDS) {
      const value = (entry as Record<string, unknown>)[field];
      if (typeof value !== "string" || value.length === 0) {
        return { ok: false, reason: `entries[${i}].${field} 缺失或不是非空 string` };
      }
    }
  }

  if (obj.activeId !== undefined && obj.activeId !== null && typeof obj.activeId !== "string") {
    return { ok: false, reason: "activeId 不是 string/null" };
  }

  return {
    ok: true,
    store: {
      entries: obj.entries as CredentialEntry[],
      activeId: (obj.activeId as string | undefined) ?? null,
    },
  };
}

/**
 * 孤儿 activeId 静默回退：activeId 指向不存在的 entry 时改指首条。
 * 不视为损坏（迁移/手动编辑残留是正常情况），但记 warn 日志方便排查
 * 「明明有配置却显示未配置」的困惑。
 */
function normalizeActiveId(store: CredentialsStore): CredentialsStore {
  if (store.activeId && !store.entries.some((e) => e.id === store.activeId)) {
    const fallback = store.entries[0]?.id ?? null;
    console.warn(
      `[credentials] activeId ${store.activeId} 不在 entries 中，回退到 ${fallback ?? "null"}`,
    );
    return { entries: store.entries, activeId: fallback };
  }
  return store;
}

/**
 * 把损坏的 credentials.json 备份到 credentials.json.corrupt-{timestamp}.json。
 *
 * 优先 rename（原子、快）；跨设备等罕见场景退回 copy + unlink。
 * 备份文件名带 timestamp，避免多次损坏互相覆盖；用户手动清理即可，
 * 不做自动清理（避免误删用户想保留的备份）。
 *
 * 返回备份文件的绝对路径，供错误消息展示。
 */
function backupCorruptFile(): string {
  const backup = `${CREDENTIALS_FILE}.corrupt-${Date.now()}.json`;
  try {
    renameSync(CREDENTIALS_FILE, backup);
  } catch {
    // rename 失败（如跨设备）退回 copy + unlink；copy 失败才让异常上抛
    copyFileSync(CREDENTIALS_FILE, backup);
    unlinkSync(CREDENTIALS_FILE);
  }
  return backup;
}

/**
 * 列出 CONFIG_DIR 下的所有凭据备份文件名，按时间戳降序（最近的在前）。
 *
 * 备份文件名格式：credentials.json.corrupt-{timestamp}.json。
 * timestamp 是 Date.now() 毫秒数，字典序与数值序一致（同位数时），
 * 所以字符串排序即可，不需要转数字。
 */
function listBackupFiles(): string[] {
  return readdirSync(CONFIG_DIR)
    .filter((name) => /^credentials\.json\.corrupt-\d+\.json$/.test(name))
    .sort()
    .reverse();
}

/**
 * 重置成空配置：写一个合法的空 store（首次使用状态），清除损坏事件。
 *
 * 语义：用户放弃损坏历史，回到干净起点。后续如想真的加凭据走正常新增流程。
 * 不删备份文件——用户可能后悔，保留让他手动恢复。
 */
export function resetEmptyStore(): void {
  saveStore(emptyStore());
  clearCorruptionEvent();
}

/**
 * 从最近的备份恢复凭据 store。
 *
 * 找 CONFIG_DIR 下时间戳最大的 credentials.json.corrupt-{ts}.json，尝试解析+校验。
 * 成功则覆盖 credentials.json + 清除事件 + 删掉这个备份（已恢复，不再需要）；
 * 失败则抛 CredentialStoreError（message 含失败原因），原状完全不变（备份文件保留，
 * 事件保留，用户可改试 resetEmptyStore）。
 *
 * @returns 恢复成功时返回的 store
 */
export function restoreLatestBackup(): CredentialsStore {
  const backups = listBackupFiles();
  if (backups.length === 0) {
    throw new CredentialStoreError("没有找到备份文件，无法恢复", "CRED_INVALID_STRUCTURE");
  }
  const latestName = backups[0]; // 最近的在前
  const latestPath = join(CONFIG_DIR, latestName);
  const content = readFileSync(latestPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    throw new CredentialStoreError(
      `备份文件 ${latestName} 仍无法解析（JSON 格式错误），无法恢复。可改用「重置成空配置」。`,
      "CRED_PARSE_FAILED",
      { cause },
    );
  }
  const validation = validateStore(parsed);
  if (!validation.ok) {
    throw new CredentialStoreError(
      `备份文件 ${latestName} 结构不合法：${validation.reason}，无法恢复。可改用「重置成空配置」。`,
      "CRED_INVALID_STRUCTURE",
    );
  }

  const store = normalizeActiveId(validation.store);
  saveStore(store);
  clearCorruptionEvent();
  // 恢复成功后删掉这个备份——已恢复，不再需要；其他历史备份保留
  try {
    unlinkSync(latestPath);
  } catch {
    // 删失败不影响恢复结果
  }
  return store;
}

export function saveStore(store: CredentialsStore): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  chmodSync(CREDENTIALS_FILE, 0o600);
}

/** 返回全量列表 + 激活 id（供 Web 面板渲染列表）。 */
export function listCredentials(): CredentialsStore {
  return loadStore();
}

/**
 * 当前激活的凭据；无配置或 activeId 无效时返回 null。
 *
 * 损坏处理：loadStore 抛 CredentialStoreError 时，这里 catch 返 null，让 images
 * route 走现有「无凭据返 503」路径；损坏信号留给 /credentials 和 /auth/status
 * 专门处理（它们会展示具体原因）。这样 images route 的 503 文案保持「未配置凭据」
 * 足够，不需要每个调用方都处理 CredentialStoreError。
 */
export function getActiveCredential(): CredentialEntry | null {
  let store: CredentialsStore;
  try {
    store = loadStore();
  } catch {
    return null;
  }
  if (!store.activeId) return null;
  return store.entries.find((e) => e.id === store.activeId) ?? null;
}

/**
 * 新增一条配置；首条自动设为激活。
 *
 * 成功后清除损坏事件（clearCorruptionEvent）——语义是「用户已重新配置 provider，
 * 损坏翻篇」，后续 /credentials 返正常空列表，不再提示历史损坏。
 */
export function addCredential(input: CredentialInput): CredentialEntry {
  const store = loadStore();
  const now = new Date().toISOString();
  const entry: CredentialEntry = {
    id: randomUUID(),
    label: input.label?.trim() || defaultLabel(store.entries.length),
    provider: input.provider?.trim() || "openai",
    apiBaseUrl: input.apiBaseUrl.trim(),
    apiKey: input.apiKey.trim(),
    model: input.model?.trim() || "",
    createdAt: now,
    updatedAt: now,
  };
  store.entries.push(entry);
  // 首条自动激活；已有激活项则不抢占。
  if (!store.activeId) store.activeId = entry.id;
  saveStore(store);
  clearCorruptionEvent();
  return entry;
}

/** 更新指定条目；不存在返回 null。 */
export function updateCredential(id: string, input: CredentialInput): CredentialEntry | null {
  const store = loadStore();
  const entry = store.entries.find((e) => e.id === id);
  if (!entry) return null;
  entry.label = input.label?.trim() || entry.label;
  entry.provider = input.provider?.trim() || entry.provider;
  entry.apiBaseUrl = input.apiBaseUrl.trim();
  entry.apiKey = input.apiKey.trim();
  entry.model = input.model?.trim() || "";
  entry.updatedAt = new Date().toISOString();
  saveStore(store);
  return entry;
}

/** 删除指定条目；删的是激活项时自动切到剩余首条。 */
export function removeCredential(id: string): boolean {
  const store = loadStore();
  const index = store.entries.findIndex((e) => e.id === id);
  if (index === -1) return false;
  store.entries.splice(index, 1);
  if (store.activeId === id) {
    store.activeId = store.entries[0]?.id ?? null;
  }
  saveStore(store);
  return true;
}

/** 设指定条目为激活；不存在返回 false。 */
export function activateCredential(id: string): boolean {
  const store = loadStore();
  if (!store.entries.some((e) => e.id === id)) return false;
  store.activeId = id;
  saveStore(store);
  return true;
}

/** 清空全部凭据（删文件）。 */
export function clearAllCredentials(): void {
  try {
    if (existsSync(CREDENTIALS_FILE)) {
      unlinkSync(CREDENTIALS_FILE);
    }
  } catch (cause) {
    console.warn("[credentials] 清空凭据文件失败", cause);
  }
}

function defaultLabel(index: number): string {
  return `配置 ${index + 1}`;
}
