import { describe, it, expect } from "vitest";
import { verifyJwt, signJwtForTesting, JwtVerificationError } from "./jwt.js";

const SECRET = "test-secret-key-for-hs256";

describe("verifyJwt (HS256)", () => {
  describe("有效 JWT", () => {
    it("验签通过，返回 payload", () => {
      const token = signJwtForTesting({ sub: "user-1", display_name: "Alice" }, SECRET);
      const payload = verifyJwt(token, SECRET);
      expect(payload.sub).toBe("user-1");
      expect(payload.display_name).toBe("Alice");
    });

    it("无 exp 的长期 token 通过", () => {
      const token = signJwtForTesting({ sub: "user-1" }, SECRET);
      expect(() => verifyJwt(token, SECRET)).not.toThrow();
    });

    it("exp 在未来 → 通过", () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const token = signJwtForTesting({ sub: "user-1", exp: futureExp }, SECRET);
      expect(() => verifyJwt(token, SECRET)).not.toThrow();
    });

    it("带 jti 的 token 通过", () => {
      const token = signJwtForTesting({ sub: "user-1", jti: "abc-123" }, SECRET);
      const payload = verifyJwt(token, SECRET);
      expect(payload.jti).toBe("abc-123");
    });
  });

  describe("验签失败", () => {
    it("错误 secret → 签名不匹配", () => {
      const token = signJwtForTesting({ sub: "user-1" }, SECRET);
      expect(() => verifyJwt(token, "wrong-secret")).toThrow(JwtVerificationError);
    });

    it("篡改 payload → 签名失效", () => {
      const token = signJwtForTesting({ sub: "user-1" }, SECRET);
      const [header, payload, sig] = token.split(".");
      // 篡改 payload：替换为另一个用户的 sub
      const tamperedPayload = Buffer.from(JSON.stringify({ sub: "user-evil" }))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const tamperedToken = `${header}.${tamperedPayload}.${sig}`;
      expect(() => verifyJwt(tamperedToken, SECRET)).toThrow(/签名不匹配/);
    });

    it("token 格式错误（少于三段）", () => {
      expect(() => verifyJwt("abc.def", SECRET)).toThrow(/格式错误/);
    });

    it("非 JSON header", () => {
      const badToken = "aaaa.bbbb.cccc";
      expect(() => verifyJwt(badToken, SECRET)).toThrow(/header 解析失败/);
    });
  });

  describe("算法安全", () => {
    it("alg=none → 拒绝", () => {
      const token = signJwtForTesting({ sub: "user-1" }, SECRET, "none");
      expect(() => verifyJwt(token, SECRET)).toThrow(/不支持的算法：none/);
    });

    it("alg=RS256 → 拒绝（本 PR 仅支持 HS256）", () => {
      const token = signJwtForTesting({ sub: "user-1" }, SECRET, "RS256");
      expect(() => verifyJwt(token, SECRET)).toThrow(/不支持的算法：RS256/);
    });
  });

  describe("过期检查", () => {
    it("exp 已过 → 过期错误", () => {
      const pastExp = Math.floor(Date.now() / 1000) - 100;
      const token = signJwtForTesting({ sub: "user-1", exp: pastExp }, SECRET);
      expect(() => verifyJwt(token, SECRET)).toThrow(/已过期/);
    });

    it("exp = 当前时间 → 过期（>= 判定）", () => {
      const nowExp = Math.floor(Date.now() / 1000);
      const token = signJwtForTesting({ sub: "user-1", exp: nowExp }, SECRET);
      expect(() => verifyJwt(token, SECRET)).toThrow(/已过期/);
    });
  });

  describe("claim 校验", () => {
    it("缺少 sub → 错误", () => {
      // 构造无 sub 的 payload（绕过 signJwtForTesting 的类型，直接拼）
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
        .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const payload = Buffer.from(JSON.stringify({ display_name: "x" }))
        .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const signingInput = `${header}.${payload}`;
      const { createHmac } = require("node:crypto");
      const sig = createHmac("sha256", SECRET).update(signingInput).digest();
      const sigB64 = sig.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const token = `${signingInput}.${sigB64}`;
      expect(() => verifyJwt(token, SECRET)).toThrow(/缺少 sub/);
    });

    it("sub 为空字符串 → 错误", () => {
      const token = signJwtForTesting({ sub: "" }, SECRET);
      expect(() => verifyJwt(token, SECRET)).toThrow(/缺少 sub/);
    });
  });

  describe("base64url 编码兼容", () => {
    it("含中文 display_name 的 payload 正确解码", () => {
      const token = signJwtForTesting({ sub: "user-1", display_name: "张三" }, SECRET);
      const payload = verifyJwt(token, SECRET);
      expect(payload.display_name).toBe("张三");
    });
  });
});
