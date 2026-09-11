/**
 * 下载页的「最新桌面版本」解析层。
 *
 * 数据源优先级：
 * 1. GitHub Releases 列表 API（含 prerelease——桌面版明确以 prerelease 发布，
 *    因此不能用 /releases/latest 端点）；
 * 2. FALLBACK_RELEASE 常量兜底（API 失败/超时；也是 SSG 预渲染的初始内容）。
 *
 * 资产名匹配走后缀特征而非完整文件名：历史上存在三种命名风格（手动网页上传被
 * GitHub 点号化的 `GPT.Image.Studio_*`、Tauri 原始输出的空格命名、CI 的连字符
 * 规范命名 `GPT-Image-Studio_*`，见 docs/plans/desktop-ci-cd-plan.md §六），
 * 只要保留 `_aarch64.dmg` 这类架构+格式后缀，页面就不会因命名调整而失效。
 */
import {
  FALLBACK_RELEASE,
  type DesktopAssetInfo,
  type DesktopPlatformKey,
  type DesktopReleaseInfo,
} from "../../shared/downloads";

const RELEASES_API =
  "https://api.github.com/repos/honlnk/gpt-image-studio/releases?per_page=20";

const DESKTOP_TAG_PREFIX = "desktop-v";

/** 资产名后缀特征 → 平台键。CI 固定命名同样命中（契约见 desktop-ci-cd-plan §六）。 */
const ASSET_PATTERNS: ReadonlyArray<readonly [DesktopPlatformKey, RegExp]> = [
  ["macArm64", /_aarch64\.dmg$/i],
  ["windowsX64", /_x64-setup\.exe$/i],
  ["linuxAppImage", /_amd64\.AppImage$/],
  ["linuxDeb", /_amd64\.deb$/i],
];

/** 把一个 release 的资产列表按平台分类（同名后缀取先出现者）。 */
export function classifyAssets(
  assets: ReadonlyArray<{ name: string; url: string; sizeBytes: number }>,
): Partial<Record<DesktopPlatformKey, DesktopAssetInfo>> {
  const result: Partial<Record<DesktopPlatformKey, DesktopAssetInfo>> = {};
  for (const asset of assets) {
    for (const [key, pattern] of ASSET_PATTERNS) {
      if (result[key] || !pattern.test(asset.name)) continue;
      result[key] = { url: asset.url, name: asset.name, sizeBytes: asset.sizeBytes };
    }
  }
  return result;
}

type GitHubReleaseJson = {
  tag_name?: unknown;
  published_at?: unknown;
  draft?: unknown;
  assets?: unknown;
};

/**
 * 从 Releases 列表 JSON 中挑出最新的 desktop-v* release（列表按发布倒序，
 * 取第一个命中者）。无命中返回 null，由调用方回落 FALLBACK_RELEASE。
 */
export function pickLatestDesktopRelease(
  releases: ReadonlyArray<GitHubReleaseJson>,
): DesktopReleaseInfo | null {
  for (const release of releases) {
    if (release.draft === true) continue;
    if (typeof release.tag_name !== "string") continue;
    if (!release.tag_name.startsWith(DESKTOP_TAG_PREFIX)) continue;
    const version = release.tag_name.slice(DESKTOP_TAG_PREFIX.length);
    if (!version) continue;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const classified = classifyAssets(
      assets
        .map((asset): { name: string; url: string; sizeBytes: number } | null => {
          if (!asset || typeof asset !== "object") return null;
          const record = asset as Record<string, unknown>;
          if (
            typeof record.name !== "string" ||
            typeof record.browser_download_url !== "string"
          ) {
            return null;
          }
          return {
            name: record.name,
            url: record.browser_download_url,
            sizeBytes:
              typeof record.size === "number" ? record.size : 0,
          };
        })
        .filter((asset) => asset !== null),
    );
    return {
      version,
      tag: release.tag_name,
      publishedAt:
        typeof release.published_at === "string" ? release.published_at : "",
      assets: classified,
    };
  }
  return null;
}

/**
 * 运行时解析最新桌面 release。任何失败（网络、限流、超时、无 desktop tag）
 * 都回落 FALLBACK_RELEASE——下载页永远有可用按钮。
 */
export async function fetchLatestDesktopRelease(): Promise<DesktopReleaseInfo> {
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return FALLBACK_RELEASE;
    const releases: unknown = await response.json();
    if (!Array.isArray(releases)) return FALLBACK_RELEASE;
    return pickLatestDesktopRelease(releases) ?? FALLBACK_RELEASE;
  } catch {
    return FALLBACK_RELEASE;
  }
}

export type DetectedPlatform = "mac" | "windows" | "linux" | "unknown";

/**
 * 按 UA 粗判访问者平台，用于 hero 区推荐按钮。macOS 无法区分 Intel/ARM
 * （UA 统一报 Intel），一律推荐 Apple Silicon（2026 年存量以 ARM 为主）。
 * 移动设备（含 UA 里带 "Mac OS X" 的 iPhone）判定为 unknown——桌面安装包
 * 对手机用户无意义，不推荐任何平台。
 */
export function detectPlatform(
  userAgent: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): DetectedPlatform {
  if (/iphone|ipad|ipod|android|mobile/i.test(userAgent)) return "unknown";
  if (/windows/i.test(userAgent)) return "windows";
  if (/mac os x|macintosh/i.test(userAgent)) return "mac";
  if (/linux/i.test(userAgent)) return "linux";
  return "unknown";
}

/** 把字节数格式化为「约 x.x MB」（下载按钮旁的体积提示）。 */
export function formatAssetSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "";
  return `约 ${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}
