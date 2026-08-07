/**
 * macOS 开机自启——launchd LaunchAgent。
 *
 * 写 `~/Library/LaunchAgents/com.honlnk.image-studio-companion.plist`。
 * - RunAtLoad=true（登录时触发）
 * - KeepAlive=false（不守护；start 自己 fork 后台进程即退出，KeepAlive 会反复重启启动器）
 * - ProgramArguments=[node, main.js, start, ...]
 * - 显式设 PATH/HOME（launchd 用户会话 PATH 极简）
 *
 * launchctl 现代 API：
 * - bootstrap gui/$(id -u) <plist文件>  —— 加载（已 loaded 会失败，故先 bootout）
 * - bootout gui/$(id -u)/<label>        —— 卸载（容忍未 loaded）
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";

const LABEL = "com.honlnk.image-studio-companion";

/** launchd domain target，如 gui/501。惰性求值，便于测试 mock。 */
function domain(): string {
  return `gui/${userInfo().uid}`;
}

/** plist 路径。惰性求值，便于测试 mock homedir。 */
function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

export type LaunchCommand = { node: string; main: string; args: string[] };

type PlatformStatus = { enabled: boolean; error?: string };

export function getStatus(): PlatformStatus {
  return { enabled: existsSync(plistPath()) };
}

export function enable(cmd: LaunchCommand): PlatformStatus {
  const file = plistPath();
  const dir = dirname(file);
  // 确保目录存在
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const plist = buildPlist(cmd);
  writeFileSync(file, plist, { mode: 0o644 });
  chmodSync(file, 0o644);

  // plutil 校验语法
  try {
    execFileSync("plutil", ["-lint", file], { stdio: "pipe" });
  } catch (e) {
    return { enabled: false, error: `plist 校验失败：${String(e)}` };
  }

  // 已 loaded 先 bootout（容忍未 loaded 的错误）
  try {
    execFileSync("launchctl", ["bootout", `${domain()}/${LABEL}`], { stdio: "pipe" });
  } catch {
    // 未 loaded 是正常的，忽略
  }

  // bootstrap 加载
  try {
    execFileSync("launchctl", ["bootstrap", domain(), file], { stdio: "pipe" });
  } catch (e) {
    return { enabled: false, error: `launchctl bootstrap 失败：${String(e)}` };
  }

  return { enabled: true };
}

export function disable(): PlatformStatus {
  const file = plistPath();
  // bootout（容忍未 loaded）
  try {
    execFileSync("launchctl", ["bootout", `${domain()}/${LABEL}`], { stdio: "pipe" });
  } catch {
    // 未 loaded 是正常的
  }

  if (existsSync(file)) {
    try {
      unlinkSync(file);
    } catch (e) {
      return { enabled: true, error: `删除 plist 失败，请手动删除：${file}（${String(e)}）` };
    }
  }

  return { enabled: false };
}

/** 构建 plist XML（纯函数，导出供测试）。 */
export function buildPlist(cmd: LaunchCommand): string {
  const programArgs = [cmd.node, cmd.main, ...cmd.args];
  const argsXml = programArgs.map((a) => `        <string>${escapeXml(a)}</string>`).join("\n");

  // WorkingDirectory 用 main.js 所在目录
  const workingDir = dirname(cmd.main);

  // launchd PATH 极简，显式补上常见 node 安装路径
  const pathEnv = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>WorkingDirectory</key>
    <string>${escapeXml(workingDir)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${pathEnv}</string>
        <key>HOME</key>
        <string>${escapeXml(homedir())}</string>
    </dict>
</dict>
</plist>
`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
