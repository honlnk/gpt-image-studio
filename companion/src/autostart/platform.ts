/**
 * 平台检测。
 *
 * process.platform 映射到 autostart 支持的三类平台。
 * macOS = 'darwin'，Linux = 'linux'，Windows = 'win32'，其它一律 unsupported。
 */
export type AutostartPlatform = "macos" | "linux" | "windows" | "unsupported";

export function detectPlatform(): AutostartPlatform {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "unsupported";
  }
}
