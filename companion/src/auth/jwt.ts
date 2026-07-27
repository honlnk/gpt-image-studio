/**
 * HS256 JWT 验证（阶段三 PR2）。
 *
 * Companion 是资源服务器（RS），只**验签 + 过期检查**，不签发 JWT（签发由宿主 IdP 负责）。
 * 用 Node 内置 crypto 实现，不引入 jsonwebtoken/jose 依赖——
 * HS256 = HMAC-SHA256，逻辑简单固定，自建 40 行即可，减少 supply chain 风险（项目理念）。
 *
 * 安全要点：
 * - 拒绝 alg=none（防绕过验签）。
 * - 用 crypto.timingSafeEqual 常数时间比较签名（防时序攻击）。
 * - 只接受 HS256，其他 alg（RS256/ES256）直接拒绝（本 PR 只支持对称密钥）。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type JwtPayload = {
  /** 用户 id（JWT sub claim，必填）。 */
  sub: string;
  /** 显示名（可选 claim，避免反查宿主）。 */
  display_name?: string;
  /** JWT 唯一 id（PR3 吊销黑名单用）。 */
  jti?: string;
  /** 过期时间（Unix 秒）。无 exp 视为长期有效（由宿主控制）。 */
  exp?: number;
  iat?: number;
};

export class JwtVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtVerificationError";
  }
}

/**
 * 验证 HS256 JWT。
 *
 * @param token 形如 "xxx.yyy.zzz" 的 JWT 字符串
 * @param secret 共享密钥（HS256）
 * @returns 解析出的 payload
 * @throws JwtVerificationError 验签失败 / 过期 / 格式错误
 */
export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new JwtVerificationError("JWT 格式错误：需要三段 header.payload.signature");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. 解析 header，校验 alg
  let header: { alg: string; typ?: string };
  try {
    header = JSON.parse(base64urlDecode(headerB64)) as typeof header;
  } catch {
    throw new JwtVerificationError("JWT header 解析失败");
  }
  if (header.alg !== "HS256") {
    // 关键：拒绝 alg=none 和其他算法，防绕过验签
    throw new JwtVerificationError(`不支持的算法：${header.alg}（仅支持 HS256）`);
  }

  // 2. 重新计算签名，常数时间比较
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac("sha256", secret).update(signingInput).digest();
  const actualSig = base64urlDecodeToBuffer(signatureB64);
  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
    throw new JwtVerificationError("JWT 签名不匹配");
  }

  // 3. 解析 payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64)) as JwtPayload;
  } catch {
    throw new JwtVerificationError("JWT payload 解析失败");
  }

  // 4. 检查 sub（必填）
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new JwtVerificationError("JWT 缺少 sub claim（user_id）");
  }

  // 5. 检查 exp（过期）
  if (typeof payload.exp === "number") {
    const now = Math.floor(Date.now() / 1000);
    if (now >= payload.exp) {
      throw new JwtVerificationError("JWT 已过期");
    }
  }

  return payload;
}

/** base64url 解码为字符串（UTF-8）。 */
function base64urlDecode(input: string): string {
  return base64urlDecodeToBuffer(input).toString("utf-8");
}

/** base64url 解码为 Buffer。补齐 padding 后用 base64 解码。 */
function base64urlDecodeToBuffer(input: string): Buffer {
  // base64url → base64：- → +，_ → /，补齐 padding
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

// ─── 测试辅助：签发 HS256 JWT（仅测试用，生产由宿主签发） ───

/**
 * 签发 HS256 JWT（仅供测试）。生产环境 Companion 不签发 JWT。
 */
export function signJwtForTesting(payload: JwtPayload, secret: string, headerAlg = "HS256"): string {
  const header = base64urlEncode(JSON.stringify({ alg: headerAlg, typ: "JWT" }));
  const body = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64urlEncodeBuffer(sig)}`;
}

function base64urlEncode(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlEncodeBuffer(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
