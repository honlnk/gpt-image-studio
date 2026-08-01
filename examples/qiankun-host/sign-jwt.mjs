#!/usr/bin/env node
/**
 * 本地 qiankun 宿主用的 JWT 签发脚本（仅开发预览用）。
 *
 * 用与 Companion server 模式相同的 JWT_SECRET 签发 HS256 JWT，
 * 子应用拿到后用 Authorization: Bearer <jwt> 调 Companion。
 *
 * 用法：JWT_SECRET=xxx node sign-jwt.mjs
 */
import { createHmac } from "node:crypto";

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error("请先设置 JWT_SECRET 环境变量");
  process.exit(1);
}

function b64url(input) {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function b64urlBuf(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const payload = b64url(
  JSON.stringify({
    sub: "qiankun-preview-user", // 必填：用户 id（Companion 据此定位用户数据目录）
    display_name: "qiankun 预览用户",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 小时有效
  }),
);
const signingInput = `${header}.${payload}`;
const sig = createHmac("sha256", SECRET).update(signingInput).digest();
const jwt = `${signingInput}.${b64urlBuf(sig)}`;

console.log(jwt);
