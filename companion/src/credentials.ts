import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
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
 */

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

export function loadStore(): CredentialsStore {
  try {
    if (!existsSync(CREDENTIALS_FILE)) return emptyStore();
    const data = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8")) as Partial<CredentialsStore>;
    if (!Array.isArray(data.entries)) return emptyStore();
    return {
      entries: data.entries,
      activeId: data.activeId ?? null,
    };
  } catch {
    return emptyStore();
  }
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

/** 当前激活的凭据；无配置或 activeId 无效时返回 null。 */
export function getActiveCredential(): CredentialEntry | null {
  const store = loadStore();
  if (!store.activeId) return null;
  return store.entries.find((e) => e.id === store.activeId) ?? null;
}

/** 新增一条配置；首条自动设为激活。 */
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
  } catch {}
}

function defaultLabel(index: number): string {
  return `配置 ${index + 1}`;
}
