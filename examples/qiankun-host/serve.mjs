#!/usr/bin/env node
/**
 * qiankun demo 宿主服务（取代 python3 -m http.server）。
 *
 * 设计目标：让 demo 的密钥管理与「正式部署」一致——
 *   - 共享密钥（JWT_SECRET / ADMIN_API_KEY）只存在 .env，服务端持有，绝不下发浏览器；
 *   - JWT 由本服务在服务端签发（/api/login），浏览器不再自签、不持有 jwtSecret；
 *   - 平台管理接口（/admin/**）由本服务代理（/api/admin/**），浏览器不持有 ADMIN_API_KEY；
 *   - 配置全部 .env 驱动，不再手工编辑 config.json、不再命令行内联密钥。
 *
 * 读取两个 .env：
 *   - 仓库根 gpt-image-studio/.env        → JWT_SECRET、ADMIN_API_KEY（与 companion 容器共享）
 *   - 本目录 examples/qiankun-host/.env    → demo 专属配置（地址/端口/用户/OSS 等）
 *
 * 路由：
 *   GET  /api/config        → 非敏感配置（companionUrl/subappUrl/user/oss/hideSidebar）
 *   POST /api/login         → 服务端签发 JWT，返回 { jwt, exp }
 *   ALL  /api/admin/*       → 代理 companion /admin/*，注入 ADMIN_API_KEY
 *   GET  /                  → index.html（其余静态资源按路径返回）
 *
 * 用法：node serve.mjs
 */
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_ENV = join(SCRIPT_DIR, "../../.env");
const DEMO_ENV = join(SCRIPT_DIR, ".env");

// ─── 极简 .env 解析（无依赖）───
function parseEnv(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function loadEnv(file) {
  try {
    return parseEnv(await readFile(file, "utf8"));
  } catch (e) {
    console.error(`无法读取 ${file}：${e.message}`);
    return {};
  }
}

const [rootEnv, demoEnv] = await Promise.all([loadEnv(ROOT_ENV), loadEnv(DEMO_ENV)]);

// 共享密钥（来自仓库根 .env）
const JWT_SECRET = rootEnv.JWT_SECRET;
const ADMIN_API_KEY = rootEnv.ADMIN_API_KEY;
// demo 配置（来自本目录 .env）
const COMPANION_URL = (demoEnv.COMPANION_URL || "http://127.0.0.1:19751").replace(/\/$/, "");
const SUBAPP_URL = demoEnv.SUBAPP_URL || "http://127.0.0.1:4173";
const HOST_PORT = Number(demoEnv.HOST_PORT || 5599);
const DEMO_USER_SUB = demoEnv.DEMO_USER_SUB || "qiankun-preview-user";
const DEMO_USER_NAME = demoEnv.DEMO_USER_NAME || "qiankun 预览用户";
const JWT_TTL_SECONDS = Number(demoEnv.JWT_TTL_SECONDS || 2592000);
const OSS_ENDPOINT = demoEnv.OSS_ENDPOINT || "";
const OSS_BUCKET = demoEnv.OSS_BUCKET || "";
const HIDE_SIDEBAR = String(demoEnv.HIDE_SIDEBAR ?? "true") === "true";

if (!JWT_SECRET) {
  console.error("✗ 仓库根 gpt-image-studio/.env 缺少 JWT_SECRET（与 companion 容器共享）。");
  process.exit(1);
}
if (!ADMIN_API_KEY) {
  console.error("✗ 仓库根 gpt-image-studio/.env 缺少 ADMIN_API_KEY（平台管理密钥）。");
  process.exit(1);
}

// ─── HS256 JWT 签发（服务端，与 companion 验签共用 JWT_SECRET）───
function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function signJwt(payload) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64url(sig)}`;
}

// ─── 非敏感配置（下发给浏览器）───
function publicConfig() {
  return {
    companionUrl: COMPANION_URL,
    subappUrl: SUBAPP_URL,
    user: { sub: DEMO_USER_SUB, displayName: DEMO_USER_NAME },
    oss: OSS_ENDPOINT && OSS_BUCKET ? { endpoint: OSS_ENDPOINT, bucket: OSS_BUCKET } : null,
    hideSidebar: HIDE_SIDEBAR,
  };
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

// ─── 静态文件托管（本目录）───
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

async function serveStatic(req, res, urlPath) {
  // 防穿越：归一化后必须仍在 SCRIPT_DIR 内
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const target = normalize(join(SCRIPT_DIR, rel));
  if (!target.startsWith(SCRIPT_DIR)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  let s;
  try {
    s = await stat(target);
  } catch {
    sendJson(res, 404, { error: "not found", path: urlPath });
    return;
  }
  // 目录：回落 index.html
  const file = s.isDirectory() ? join(target, "index.html") : target;
  try {
    await stat(file);
  } catch {
    sendJson(res, 404, { error: "not found", path: urlPath });
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(file).pipe(res);
}

// ─── /api/admin/** 代理到 companion /admin/**，注入 ADMIN_API_KEY ───
// 透传 method/query/body/content-type；剔除上游 CORS 头（同源代理，浏览器侧 CORS 由本服务负责）。
const STRIPPED_UPSTREAM_HEADERS = new Set([
  "content-length", "connection", "transfer-encoding", "content-encoding", "keep-alive",
  "access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-methods",
  "access-control-allow-headers", "access-control-max-age", "access-control-expose-headers",
]);

async function proxyAdmin(req, res, rest, search) {
  const target = `${COMPANION_URL}/admin/${rest}${search || ""}`;
  const headers = { Authorization: `Bearer ${ADMIN_API_KEY}` };
  if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") body = await readBody(req);
  let upstream;
  try {
    upstream = await fetch(target, { method: req.method, headers, body });
  } catch (e) {
    sendJson(res, 502, { error: "companion unreachable", detail: e.message });
    return;
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  const respHeaders = { "Content-Type": upstream.headers.get("content-type") || "application/json" };
  // 复制安全响应头
  for (const [k, v] of upstream.headers) {
    if (STRIPPED_UPSTREAM_HEADERS.has(k.toLowerCase())) continue;
    respHeaders[k] = v;
  }
  res.writeHead(upstream.status, respHeaders);
  res.end(buf);
}

// ─── 主路由 ───
const server = createServer(async (req, res) => {
  const { pathname, search } = new URL(req.url, "http://localhost");

  // API 路由
  if (pathname === "/api/config" && req.method === "GET") {
    sendJson(res, 200, publicConfig());
    return;
  }
  if (pathname === "/api/login" && req.method === "POST") {
    const now = Math.floor(Date.now() / 1000);
    const jwt = signJwt({
      sub: DEMO_USER_SUB,
      display_name: DEMO_USER_NAME,
      iat: now,
      exp: now + JWT_TTL_SECONDS,
    });
    sendJson(res, 200, { jwt, exp: now + JWT_TTL_SECONDS });
    return;
  }
  if (pathname.startsWith("/api/admin/")) {
    const rest = pathname.slice("/api/admin/".length);
    await proxyAdmin(req, res, rest, search || "");
    return;
  }
  if (pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "unknown api", path: pathname });
    return;
  }

  // 静态资源
  await serveStatic(req, res, pathname);
});

server.listen(HOST_PORT, () => {
  console.log("┌──────────────────────────────────────────────────────");
  console.log("│ qiankun demo 宿主服务已启动");
  console.log(`│   页面:  http://127.0.0.1:${HOST_PORT}`);
  console.log(`│   子应用: ${SUBAPP_URL}（需另起 pnpm preview）`);
  console.log(`│   companion: ${COMPANION_URL}`);
  console.log("│ 密钥来自 .env（服务端持有），浏览器不持有 secret");
  console.log("└──────────────────────────────────────────────────────");
});
