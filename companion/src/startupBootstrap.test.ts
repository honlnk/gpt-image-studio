import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bootstrapDataDir, readDeploymentMode } from "./startupBootstrap.js";

describe("startupBootstrap", () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    envBackup.GPT_IMAGE_STUDIO_CONFIG_DIR = process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
    envBackup.COMPANION_DEPLOYMENT_MODE = process.env.COMPANION_DEPLOYMENT_MODE;
    delete process.env.GPT_IMAGE_STUDIO_CONFIG_DIR;
    delete process.env.COMPANION_DEPLOYMENT_MODE;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe("readDeploymentMode", () => {
    it("识别 --deployment-mode server 分离参数", () => {
      expect(readDeploymentMode(["serve", "--deployment-mode", "server"])).toBe("server");
    });

    it("识别 --deployment-mode=server 等号参数", () => {
      expect(readDeploymentMode(["serve", "--deployment-mode=server"])).toBe("server");
    });

    it("未指定时返回 undefined", () => {
      expect(readDeploymentMode(["serve", "--port", "19750"])).toBeUndefined();
    });
  });

  describe("bootstrapDataDir", () => {
    it("server 模式默认 ~/.gpt-image-studio-docker", () => {
      const dir = bootstrapDataDir(["serve", "--deployment-mode", "server"]);

      expect(dir).toBe(join(homedir(), ".gpt-image-studio-docker"));
      expect(process.env.GPT_IMAGE_STUDIO_CONFIG_DIR).toBe(dir);
    });

    it("local 模式默认 ~/.gpt-image-studio", () => {
      const dir = bootstrapDataDir(["serve", "--deployment-mode", "local"]);

      expect(dir).toBe(join(homedir(), ".gpt-image-studio"));
      expect(process.env.GPT_IMAGE_STUDIO_CONFIG_DIR).toBe(dir);
    });

    it("显式 GPT_IMAGE_STUDIO_CONFIG_DIR 优先于 mode 默认", () => {
      process.env.GPT_IMAGE_STUDIO_CONFIG_DIR = "/explicit/dir";
      const dir = bootstrapDataDir(["serve", "--deployment-mode", "server"]);

      expect(dir).toBe("/explicit/dir");
      expect(process.env.GPT_IMAGE_STUDIO_CONFIG_DIR).toBe("/explicit/dir");
    });

    it("COMPANION_DEPLOYMENT_MODE 环境变量同样驱动默认目录", () => {
      process.env.COMPANION_DEPLOYMENT_MODE = "server";
      const dir = bootstrapDataDir(["serve"]);

      expect(dir).toBe(join(homedir(), ".gpt-image-studio-docker"));
    });
  });
});
