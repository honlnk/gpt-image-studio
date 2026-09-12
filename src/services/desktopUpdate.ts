/**
 * 桌面端「检查更新」轻量方案（免签名分发 §4.5）。
 *
 * 背景：未签名的 macOS app 无法使用 Tauri updater 静默更新（updater 要求已签名
 * 包），因此采用「手动检查 + 跳转 Release 页」的替代方案：
 * 对比 GitHub Releases 列表 API 与当前 app 版本，有新版则提示并外开 Release 页。
 *
 * 注意：桌面版以 prerelease 发布，/releases/latest 端点取不到，必须用列表 API
 * （与下载页 releaseClient 相同的数据源；解析逻辑直接复用其纯函数）。
 * 与下载页不同：检查更新在 API 失败时不回落 FALLBACK_RELEASE——对一个硬编码的
 * 旧版本号做比较会得出误导性的「已是最新」，明确报错更符合预期。
 */
import { GITHUB_RELEASES_URL, type DesktopReleaseInfo } from "../shared/downloads";
import { pickLatestDesktopRelease } from "../pages/download/releaseClient";
import { isTauriRuntime } from "./storage/resolveStorage";

const RELEASES_API =
  "https://api.github.com/repos/honlnk/gpt-image-studio/releases?per_page=20";

export type DesktopUpdateStatus =
  | {
      kind: "update-available";
      currentVersion: string;
      latestVersion: string;
      /** 对应 Release 页 URL（…/releases/tag/desktop-vX.Y.Z）。 */
      releaseUrl: string;
    }
  | { kind: "up-to-date"; currentVersion: string; latestVersion: string }
  | { kind: "error" };

/**
 * 语义化版本比较：a < b 返回 -1，相等返回 0，a > b 返回 1。
 * 容忍 v 前缀、缺失段按 0 计（"0.2" == "0.2.0"），非数字段按 0 处理——
 * 桌面版 tag 是干净的三段 semver，这里只需避免 "0.2.10" < "0.2.9" 的字符串比较陷阱。
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(/[.-]/);
  const pb = b.replace(/^v/i, "").split(/[.-]/);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10);
    const nb = Number.parseInt(pb[i] ?? "0", 10);
    const va = Number.isNaN(na) ? 0 : na;
    const vb = Number.isNaN(nb) ? 0 : nb;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

/**
 * 取当前桌面 app 版本（tauri.conf.json 的 version，经 @tauri-apps/api）。
 * 非 Tauri 运行时或读取失败返回 null。`@tauri-apps/api` 动态 import：
 * Web 构建（GitHub Pages）不打包该依赖。
 */
export async function getDesktopAppVersion(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return null;
  }
}

/**
 * 检查桌面端是否有新版本。任何失败（网络、限流、超时、无 desktop tag、
 * 版本号读不到）都收敛为 { kind: "error" }，由 UI 提示稍后重试。
 */
export async function checkDesktopUpdate(options?: {
  /** 缺省时经 Tauri API 读取；测试/桌面外调用可显式传入。 */
  currentVersion?: string | null;
  /** 缺省用全局 fetch；测试注入。 */
  fetchImpl?: typeof fetch;
}): Promise<DesktopUpdateStatus> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const currentVersion =
    options?.currentVersion !== undefined
      ? options.currentVersion
      : await getDesktopAppVersion();
  if (!currentVersion) return { kind: "error" };

  let latest: DesktopReleaseInfo | null = null;
  try {
    const response = await fetchImpl(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { kind: "error" };
    const releases: unknown = await response.json();
    if (!Array.isArray(releases)) return { kind: "error" };
    latest = pickLatestDesktopRelease(releases);
  } catch {
    return { kind: "error" };
  }
  if (!latest) return { kind: "error" };

  if (compareVersions(latest.version, currentVersion) > 0) {
    return {
      kind: "update-available",
      currentVersion,
      latestVersion: latest.version,
      releaseUrl: `${GITHUB_RELEASES_URL}/tag/${latest.tag}`,
    };
  }
  return { kind: "up-to-date", currentVersion, latestVersion: latest.version };
}
