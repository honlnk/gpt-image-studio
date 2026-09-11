/**
 * 桌面版下载相关常量与类型。
 *
 * - 下载页（/download）运行时通过 GitHub Releases API 解析最新 desktop-v* release
 *   （见 src/pages/download/releaseClient.ts），本文件的 FALLBACK_RELEASE 仅在 API
 *   失败/超时时兜底，并作为 SSG 预渲染的初始内容（爬虫可见）。
 * - 发布新桌面版后应手动更新 FALLBACK_RELEASE（发版流程见
 *   docs/plans/desktop-ci-cd-plan.md §八）；不更新只影响兜底版本，不影响主链路。
 */

/** 站内下载页路径（顶栏「桌面版」按钮跳转目标）。 */
export const DOWNLOAD_PAGE_URL = "/download";

/** GitHub Releases 列表页（「全部版本」入口，供下载任意历史版本）。 */
export const GITHUB_RELEASES_URL =
  "https://github.com/honlnk/gpt-image-studio/releases";

/** 安装包平台键。命名与 releaseClient 的资产分类对应。 */
export type DesktopPlatformKey =
  | "macArm64"
  | "windowsX64"
  | "linuxAppImage"
  | "linuxDeb";

/** 单个安装包资产：直链 URL + 展示用文件名与体积。 */
export type DesktopAssetInfo = {
  url: string;
  name: string;
  /** 字节数；展示时格式化为「约 x MB」。 */
  sizeBytes: number;
};

/** 一个桌面 release 的解析结果（API 与兜底常量共用同一形状）。 */
export type DesktopReleaseInfo = {
  /** 语义化版本号（不含 v 前缀），如 "0.1.0"。 */
  version: string;
  /** Git tag，如 "desktop-v0.1.0"。 */
  tag: string;
  /** ISO 发布时间。 */
  publishedAt: string;
  /** 按平台分类的安装包；缺失的平台表示该版本未提供。 */
  assets: Partial<Record<DesktopPlatformKey, DesktopAssetInfo>>;
};

/**
 * 兜底 release（desktop-v0.2.0，CI 首发：首个内嵌 Companion sidecar 的版本）。
 * 资产命名遵循 desktop-release.yml 头部契约；releaseClient 的模式匹配对
 * 点/空格/连字符三种历史命名风格都兼容。
 */
export const FALLBACK_RELEASE: DesktopReleaseInfo = {
  version: "0.2.0",
  tag: "desktop-v0.2.0",
  publishedAt: "2026-09-11T17:24:23Z",
  assets: {
    macArm64: {
      url: "https://github.com/honlnk/gpt-image-studio/releases/download/desktop-v0.2.0/GPT-Image-Studio_0.2.0_aarch64.dmg",
      name: "GPT-Image-Studio_0.2.0_aarch64.dmg",
      sizeBytes: 29279556,
    },
    windowsX64: {
      url: "https://github.com/honlnk/gpt-image-studio/releases/download/desktop-v0.2.0/GPT-Image-Studio_0.2.0_x64-setup.exe",
      name: "GPT-Image-Studio_0.2.0_x64-setup.exe",
      sizeBytes: 32994423,
    },
    linuxAppImage: {
      url: "https://github.com/honlnk/gpt-image-studio/releases/download/desktop-v0.2.0/GPT-Image-Studio_0.2.0_amd64.AppImage",
      name: "GPT-Image-Studio_0.2.0_amd64.AppImage",
      sizeBytes: 112888312,
    },
    linuxDeb: {
      url: "https://github.com/honlnk/gpt-image-studio/releases/download/desktop-v0.2.0/GPT-Image-Studio_0.2.0_amd64.deb",
      name: "GPT-Image-Studio_0.2.0_amd64.deb",
      sizeBytes: 40977026,
    },
  },
};
