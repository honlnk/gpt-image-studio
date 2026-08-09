/**
 * 开机自启（三平台）——平台分发层。
 *
 * 三平台统一语义：**用户登录时触发一次 `start`**（免提权的跨平台交集）。
 * - macOS：`~/Library/LaunchAgents/com.honlnk.image-studio-companion.plist`（launchd，RunAtLoad=true / KeepAlive=false）
 * - Linux：`~/.config/systemd/user/gpt-image-studio-companion.service`（systemd user unit，Type=oneshot）；可选 `loginctl enable-linger` 获得"开机即启"
 * - Windows：HKCU `Software\Microsoft\Windows\CurrentVersion\Run` 注册表键（免提权，登录触发）
 *
 * 不做崩溃自动重启（与现有手动 `start` 行为一致，零回归）。
 * start 的 detach-and-exit 模式与 KeepAlive/Type=simple 冲突，故 macOS 用 KeepAlive=false、Linux 用 oneshot 规避。
 *
 * Companion 是状态权威源：status 实时检查 plist/unit/注册表是否存在，不维护独立状态文件。
 */

import { resolve } from "node:path";
import { detectPlatform, type AutostartPlatform } from "./platform.js";
import * as macos from "./macos.js";
import * as linux from "./linux.js";
import * as windows from "./windows.js";

export type { AutostartPlatform };

export type AutostartStatus = {
  enabled: boolean;
  platform: AutostartPlatform;
  /** 仅 Linux：true 表示已开 linger（真·开机启动），false 表示仅登录启动。其它平台 undefined。 */
  linger?: boolean;
  /** enable 失败原因或降级提示（如 Linux 无 sudo 无法开 linger）。 */
  error?: string;
  /** 当前注册的启动命令（供诊断）。 */
  command?: string;
};

/**
 * 重建"让现在这个 Companion 自启"的命令行。
 *
 * 当前进程是 `serve` 进程（被 `start` 用 `[node, main.js, serve, --port, ..., --managed]` 拉起）。
 * 复刻 processManager.startManagedProcess 拼 argv 的逻辑，把 `serve` 换成 `start`，
 * 这样自启会走完整的 PID 文件 / 日志 / 单例守卫路径。
 *
 * 返回绝对路径：node 二进制 + dist/main.js + args（含 "start" 子命令）。
 * launchd/systemd 用户会话 PATH 极简，必须用绝对路径，不能依赖 PATH shim。
 */
export function getLaunchCommand(): { node: string; main: string; args: string[] } {
  const node = process.execPath;
  // process.argv[1] 是 dist/main.js 的路径（可能相对，resolve 成绝对）
  const main = resolve(process.argv[1]);
  // argv[2..] 是传给脚本的参数，如 ["serve", "--port", "19750", "--channel", "stable", "--managed"]
  const scriptArgs = process.argv.slice(2);
  // 把第一个 "serve" 替换成 "start"（自启应走 start 的托管路径）
  const args = scriptArgs[0] === "serve" ? ["start", ...scriptArgs.slice(1)] : ["start", ...scriptArgs];
  return { node, main, args };
}

/**
 * 拼接诊断用的完整命令字符串（写入 plist/unit/注册表的同款命令）。
 */
export function getLaunchCommandString(): string {
  const { node, main, args } = getLaunchCommand();
  return [node, main, ...args].join(" ");
}

export function getAutostartStatus(): AutostartStatus {
  const platform = detectPlatform();
  if (platform === "unsupported") {
    return { enabled: false, platform, command: getLaunchCommandString() };
  }
  switch (platform) {
    case "macos":
      return { ...macos.getStatus(), platform, command: getLaunchCommandString() };
    case "linux":
      return { ...linux.getStatus(), platform, command: getLaunchCommandString() };
    case "windows":
      return { ...windows.getStatus(), platform, command: getLaunchCommandString() };
  }
}

export function enableAutostart(): AutostartStatus {
  const platform = detectPlatform();
  if (platform === "unsupported") {
    return {
      enabled: false,
      platform,
      error: "当前平台不支持开机自启（仅支持 macOS / Linux (systemd) / Windows）。",
    };
  }
  const cmd = getLaunchCommand();
  switch (platform) {
    case "macos":
      return { ...macos.enable(cmd), platform, command: getLaunchCommandString() };
    case "linux":
      return { ...linux.enable(cmd), platform, command: getLaunchCommandString() };
    case "windows":
      return { ...windows.enable(cmd), platform, command: getLaunchCommandString() };
  }
}

export function disableAutostart(): AutostartStatus {
  const platform = detectPlatform();
  if (platform === "unsupported") {
    return { enabled: false, platform };
  }
  switch (platform) {
    case "macos":
      return { ...macos.disable(), platform };
    case "linux":
      return { ...linux.disable(), platform };
    case "windows":
      return { ...windows.disable(), platform };
  }
}
