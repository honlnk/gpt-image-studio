import { createRequire } from "node:module";

/**
 * 解析 Companion 版本号。
 *
 * 优先读包根的 package.json（npm 安装 / tsx 开发 / dist 运行路径）。
 * 单文件二进制形态（bun build --compile，Tauri sidecar）里 import.meta.url
 * 不再指向真实文件系统上的包布局，createRequire 读 ../package.json 会失败，
 * 此时回退到构建期通过 --define 注入的 COMPANION_BUILD_VERSION。
 */
function resolveCompanionVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const packageJson = require("../package.json") as { version: string };
    // bun 编译产物里 createRequire 会命中 bun 合成的 package.json（version 恒为
    // "0.0.0"），视为读取失败，落到构建期 --define 注入的 COMPANION_BUILD_VERSION。
    if (packageJson.version && packageJson.version !== "0.0.0") {
      return packageJson.version;
    }
  } catch {
    // 单文件二进制里 import.meta.url 不指向真实文件系统的包布局，落到下方回退
  }
  return process.env.COMPANION_BUILD_VERSION ?? "0.0.0-unknown";
}

export const COMPANION_VERSION = resolveCompanionVersion();
