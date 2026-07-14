import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 持久化连接密钥（替代旧版配对 session token）。
 *
 * 信任模型：Companion 启动时生成一个随机 UUID 密钥并存盘（0600），
 * 用户把它粘进网页设置完成连接。密钥无过期、无配对仪式、无状态机——
 * 它的唯一职责是作为 Authorization: Bearer 自定义 header 的值，
 * 让非白名单 origin 的跨域请求触发 CORS 预检，从而挡住 CSRF。
 *
 * 本机信任由 127.0.0.1 监听 + CORS 白名单 + loopbackGuard 提供；
 * 密钥不防本机进程（同用户可直接读 credentials.json），只防远程网页。
 */
const CONFIG_DIR = process.env.GPT_IMAGE_STUDIO_CONFIG_DIR ?? join(homedir(), ".gpt-image-studio");
const ACCESS_KEY_FILE = join(CONFIG_DIR, "access-key.json");

type AccessKeyData = {
  key: string;
  createdAt: string;
};

let accessKey: string | null = null;

/**
 * 启动时调用：文件存在则读入内存，不存在则生成新密钥并写盘。
 * 始终保证内存中有一份有效密钥（accessKey !== null）。
 */
export function loadOrCreateAccessKey(): string {
  if (accessKey) return accessKey;
  try {
    if (existsSync(ACCESS_KEY_FILE)) {
      const data = JSON.parse(readFileSync(ACCESS_KEY_FILE, "utf-8")) as AccessKeyData;
      if (data.key) {
        accessKey = data.key;
        return accessKey;
      }
    }
  } catch {
    // 文件损坏则重新生成
  }
  accessKey = randomUUID();
  saveAccessKeyFile(accessKey);
  return accessKey;
}

/**
 * 校验请求携带的 token 是否匹配当前密钥。
 * 由 authMiddleware 调用——通过则放行受保护接口。
 */
export function validateAccessKey(token: string): boolean {
  return accessKey !== null && token === accessKey;
}

/**
 * 重新生成密钥并写盘，旧密钥立即失效。
 * 由 CLI `gpt-image-studio reset-key` 调用（密钥泄露/换电脑时用）。
 */
export function resetAccessKey(): string {
  accessKey = randomUUID();
  saveAccessKeyFile(accessKey);
  return accessKey;
}

/**
 * 返回当前密钥（供 CLI status 命令打印，让用户复制粘贴）。
 */
export function getAccessKey(): string | null {
  return accessKey;
}

function saveAccessKeyFile(key: string): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const data: AccessKeyData = {
    key,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(ACCESS_KEY_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(ACCESS_KEY_FILE, 0o600);
}
