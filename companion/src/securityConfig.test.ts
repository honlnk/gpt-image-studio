import { describe, expect, it } from "vitest";
import {
  createSecurityConfig,
  isOriginAllowed,
  normalizeOrigin,
} from "./securityConfig.js";

describe("companion security config", () => {
  it("uses stable origins by default", () => {
    const config = createSecurityConfig();

    expect(config.channel).toBe("stable");
    expect(config.allowedOrigins).toEqual(["https://image.honlnk.com"]);
  });

  it("allows local development origins only in dev channel", () => {
    const config = createSecurityConfig({ channel: "dev" });

    expect(config.allowedOrigins).toContain("http://127.0.0.1:8888");
    expect(config.allowedOrigins).toContain("http://localhost:8888");
  });

  it("normalizes complete origins and rejects unsafe values", () => {
    expect(normalizeOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(() => normalizeOrigin("*")).toThrow();
    expect(() => normalizeOrigin("localhost:5173")).toThrow();
    expect(() => normalizeOrigin("http://localhost:5173/path")).toThrow();
  });

  it("checks request origins against the allow list", () => {
    const allowedOrigins = ["https://image.honlnk.com"];

    expect(isOriginAllowed(undefined, allowedOrigins)).toBe(true);
    expect(isOriginAllowed("https://image.honlnk.com", allowedOrigins)).toBe(true);
    expect(isOriginAllowed("http://localhost:8888", allowedOrigins)).toBe(false);
  });
});
