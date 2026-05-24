export type CompanionChannel = "stable" | "dev";

export type CompanionSecurityConfig = {
  channel: CompanionChannel;
  allowedOrigins: string[];
  sessionTtlMs: number;
  maxJsonBodyBytes: number;
  maxEditBodyBytes: number;
  maxEditImages: number;
  allowedEditImageMimeTypes: string[];
};

const STABLE_ORIGINS = ["https://gpt-image.honlnk.com"];
const DEV_ORIGINS = [
  "https://gpt-image.honlnk.com",
  "http://127.0.0.1:8888",
  "http://localhost:8888",
];

const DEFAULT_SESSION_TTL_DAYS = 30;
const DEFAULT_JSON_BODY_BYTES = 1024 * 1024;
const DEFAULT_EDIT_BODY_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_EDIT_IMAGES = 16;
const DEFAULT_EDIT_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function resolveChannel(value: string | undefined): CompanionChannel {
  return value === "dev" ? "dev" : "stable";
}

export function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim();
  if (!trimmed || trimmed === "*") {
    throw new Error("Origin 必须是完整 origin，不能为空或使用通配符。");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Origin 格式无效：${origin}`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Origin 只支持 http 或 https：${origin}`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Origin 不能包含路径、查询或 hash：${origin}`);
  }
  if (url.username || url.password) {
    throw new Error(`Origin 不能包含用户名或密码：${origin}`);
  }

  return url.origin;
}

export function parseAllowOrigins(values: string[] = []): string[] {
  return values.map(normalizeOrigin);
}

export function createSecurityConfig(opts: {
  channel?: string;
  allowOrigins?: string[];
  sessionTtlDays?: number;
} = {}): CompanionSecurityConfig {
  const channel = resolveChannel(opts.channel);
  const baseOrigins = channel === "dev" ? DEV_ORIGINS : STABLE_ORIGINS;
  const extraOrigins = parseAllowOrigins(opts.allowOrigins);
  const sessionTtlDays = Number.isFinite(opts.sessionTtlDays)
    ? opts.sessionTtlDays!
    : DEFAULT_SESSION_TTL_DAYS;

  return {
    channel,
    allowedOrigins: Array.from(new Set([...baseOrigins, ...extraOrigins])),
    sessionTtlMs: Math.max(1, sessionTtlDays) * 24 * 60 * 60 * 1000,
    maxJsonBodyBytes: DEFAULT_JSON_BODY_BYTES,
    maxEditBodyBytes: DEFAULT_EDIT_BODY_BYTES,
    maxEditImages: DEFAULT_MAX_EDIT_IMAGES,
    allowedEditImageMimeTypes: DEFAULT_EDIT_IMAGE_MIME_TYPES,
  };
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  try {
    return allowedOrigins.includes(normalizeOrigin(origin));
  } catch {
    return false;
  }
}
