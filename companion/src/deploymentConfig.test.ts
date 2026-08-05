import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveDeploymentConfig,
  HostIgnoredWarning,
  type DeploymentConfig,
} from "./deploymentConfig.js";

describe("resolveDeploymentConfig", () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    envBackup.COMPANION_DEPLOYMENT_MODE = process.env.COMPANION_DEPLOYMENT_MODE;
    envBackup.COMPANION_HOST = process.env.COMPANION_HOST;
    envBackup.GPT_IMAGE_STUDIO_CONFIG_DIR = process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
    delete process.env.COMPANION_DEPLOYMENT_MODE;
    delete process.env.COMPANION_HOST;
    delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe("默认值（无参）", () => {
    it("默认 local 模式 + 127.0.0.1", () => {
      const cfg = resolveDeploymentConfig();
      expect(cfg.mode).toBe("local");
      expect(cfg.host).toBe("127.0.0.1");
      expect(cfg.dataDir).toBe(join(homedir(), ".gpt-image-studio"));
    });
  });

  describe("local 模式（本机信任，host 锁定）", () => {
    it("显式 mode=local", () => {
      const cfg = resolveDeploymentConfig({ mode: "local" });
      expect(cfg.mode).toBe("local");
      expect(cfg.host).toBe("127.0.0.1");
    });

    it("传入 host 被忽略，仍 127.0.0.1", () => {
      const cfg = resolveDeploymentConfig({ mode: "local", host: "0.0.0.0" });
      expect(cfg.host).toBe("127.0.0.1");
    });

    it("传入 host 触发 warning 回调", () => {
      const warnings: HostIgnoredWarning[] = [];
      resolveDeploymentConfig(
        { mode: "local", host: "0.0.0.0" },
        (w) => warnings.push(w),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].requestedHost).toBe("0.0.0.0");
      expect(warnings[0].reason).toContain("local 模式");
    });

    it("传入 host=127.0.0.1 不触发 warning（与默认一致）", () => {
      const warnings: HostIgnoredWarning[] = [];
      resolveDeploymentConfig(
        { mode: "local", host: "127.0.0.1" },
        (w) => warnings.push(w),
      );
      expect(warnings).toHaveLength(0);
    });

    it("不传 host 不触发 warning", () => {
      const warnings: HostIgnoredWarning[] = [];
      resolveDeploymentConfig({ mode: "local" }, (w) => warnings.push(w));
      expect(warnings).toHaveLength(0);
    });
  });

  describe("server 模式（可远程访问）", () => {
    it("无 host 时默认 0.0.0.0", () => {
      const cfg = resolveDeploymentConfig({ mode: "server" });
      expect(cfg.mode).toBe("server");
      expect(cfg.host).toBe("0.0.0.0");
      expect(cfg.dataDir).toBe(join(homedir(), ".gpt-image-studio-docker"));
    });

    it("显式 host 生效", () => {
      const cfg = resolveDeploymentConfig({ mode: "server", host: "192.168.1.10" });
      expect(cfg.host).toBe("192.168.1.10");
    });

    it("server 模式不触发 warning", () => {
      const warnings: HostIgnoredWarning[] = [];
      resolveDeploymentConfig(
        { mode: "server", host: "0.0.0.0" },
        (w) => warnings.push(w),
      );
      expect(warnings).toHaveLength(0);
    });
  });

  describe("环境变量优先级（env > opts > default）", () => {
    it("COMPANION_DEPLOYMENT_MODE 覆盖 opts.mode", () => {
      process.env.COMPANION_DEPLOYMENT_MODE = "server";
      const cfg = resolveDeploymentConfig({ mode: "local" });
      expect(cfg.mode).toBe("server");
    });

    it("COMPANION_HOST 在 server 模式覆盖 opts.host", () => {
      process.env.COMPANION_DEPLOYMENT_MODE = "server";
      process.env.COMPANION_HOST = "10.0.0.1";
      const cfg = resolveDeploymentConfig({ host: "0.0.0.0" });
      expect(cfg.host).toBe("10.0.0.1");
    });

    it("COMPANION_HOST 在 local 模式被忽略（仍触发 warning）", () => {
      process.env.COMPANION_DEPLOYMENT_MODE = "local";
      process.env.COMPANION_HOST = "0.0.0.0";
      const warnings: HostIgnoredWarning[] = [];
      const cfg = resolveDeploymentConfig({}, (w) => warnings.push(w));
      expect(cfg.host).toBe("127.0.0.1");
      expect(warnings).toHaveLength(1);
    });

    it("GPT_IMAGE_STUDIO_CONFIG_DIR 决定 dataDir", () => {
      process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = "/custom/data";
      const cfg = resolveDeploymentConfig();
      expect(cfg.dataDir).toBe("/custom/data");
    });

    it("显式 dataDir 在 local 模式优先于默认 ~/.gpt-image-studio", () => {
      process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = "/custom/local";
      const cfg = resolveDeploymentConfig({ mode: "local" });
      expect(cfg.dataDir).toBe("/custom/local");
    });

    it("显式 dataDir 在 server 模式优先于默认 ~/.gpt-image-studio-docker", () => {
      process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = "/custom/server";
      const cfg = resolveDeploymentConfig({ mode: "server" });
      expect(cfg.dataDir).toBe("/custom/server");
    });
  });

  describe("非法值", () => {
    it("非法 mode 抛错", () => {
      expect(() => resolveDeploymentConfig({ mode: "production" })).toThrow(
        /无效的部署形态/,
      );
    });

    it("空字符串 mode 抛错", () => {
      expect(() => resolveDeploymentConfig({ mode: "" })).toThrow(
        /无效的部署形态/,
      );
    });
  });

  describe("类型完整性", () => {
    it("返回值结构符合 DeploymentConfig", () => {
      const cfg: DeploymentConfig = resolveDeploymentConfig({ mode: "server" });
      expect(cfg).toHaveProperty("mode");
      expect(cfg).toHaveProperty("host");
      expect(cfg).toHaveProperty("dataDir");
    });
  });
});
