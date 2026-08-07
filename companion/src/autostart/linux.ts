/**
 * Linux 开机自启——systemd user service。
 *
 * 写 `~/.config/systemd/user/gpt-image-studio-companion.service`。
 * - Type=oneshot + RemainAfterExit=yes（start 是 fork-and-exit，oneshot 不守护，避免 Restart 循环）
 * - WantedBy=default.target（用户会话默认目标）
 * - Environment=PATH=...（systemd user 单元 PATH 极简）
 *
 * 关于"开机即启" vs "登录即启"：
 * - 默认行为：用户首次登录时 user manager 启动 → 触发 default.target → 跑本 unit（登录即启）
 * - 真正"开机即启"（无需登录）：需要 `loginctl enable-linger $USER`，这步要 sudo。
 *   本模块尝试无 sudo 开 linger，失败则降级为登录启动并在 error 字段给出手动命令提示。
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";

const SERVICE_NAME = "gpt-image-studio-companion";

/** systemd user unit 目录。惰性求值，便于测试 mock homedir。 */
function systemdUserDir(): string {
  return join(homedir(), ".config", "systemd", "user");
}

/** unit 文件路径。惰性求值。 */
function unitPath(): string {
  return join(systemdUserDir(), `${SERVICE_NAME}.service`);
}

export type LaunchCommand = { node: string; main: string; args: string[] };

type PlatformStatus = { enabled: boolean; linger?: boolean; error?: string };

/** 检测 systemd 是否作为 PID 1 运行（user 单元的前置条件）。 */
function hasSystemd(): boolean {
  try {
    const comm = readFileSync("/proc/1/comm", "utf-8").trim();
    if (comm === "systemd") return true;
  } catch {
    // 非 Linux 或读取失败
  }
  return existsSync("/run/systemd/system");
}

export function getStatus(): PlatformStatus {
  if (!hasSystemd()) {
    return { enabled: false, error: "未检测到 systemd（仅支持 systemd 发行版）。" };
  }
  const enabled = existsSync(unitPath());
  return { enabled, linger: enabled ? readLinger() : undefined };
}

export function enable(cmd: LaunchCommand): PlatformStatus {
  if (!hasSystemd()) {
    return { enabled: false, error: "未检测到 systemd（仅支持 systemd 发行版），无法启用开机自启。" };
  }

  const dir = systemdUserDir();
  const file = unitPath();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const unit = buildUnit(cmd);
  writeFileSync(file, unit, { mode: 0o644 });

  try {
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "pipe" });
    // enable 但不 --now（避免和已手动运行的服务重复；登录时才触发）
    execFileSync("systemctl", ["--user", "enable", SERVICE_NAME], { stdio: "pipe" });
  } catch (e) {
    return { enabled: false, error: `systemctl enable 失败：${String(e)}` };
  }

  // 可选 linger：尝试无 sudo 开（多半会失败），失败降级为登录启动并提示
  const linger = tryEnableLinger();
  return {
    enabled: true,
    linger: linger.enabled,
    error: linger.enabled ? undefined : linger.reason,
  };
}

export function disable(): PlatformStatus {
  if (!hasSystemd()) {
    return { enabled: false };
  }

  const file = unitPath();
  try {
    execFileSync("systemctl", ["--user", "disable", SERVICE_NAME], { stdio: "pipe" });
  } catch {
    // 未 enable 或文件已删，忽略
  }

  if (existsSync(file)) {
    try {
      unlinkSync(file);
    } catch (e) {
      return { enabled: true, error: `删除 unit 文件失败，请手动删除：${file}（${String(e)}）` };
    }
  }

  try {
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "pipe" });
  } catch {
    // daemon-reload 失败不影响 disable 语义
  }

  return { enabled: false };
}

/** 构建 systemd unit 文本（纯函数，导出供测试）。 */
export function buildUnit(cmd: LaunchCommand): string {
  const execStartArgs = [cmd.node, `"${cmd.main}"`, ...cmd.args.map((a) => `"${a}"`)].join(" ");
  const workingDir = dirname(cmd.main);
  // systemd user 单元 PATH 极简，补上常见 node 路径
  const pathEnv = [
    join(homedir(), ".local", "bin"),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].join(":");

  return `# 由 gpt-image-studio autostart enable 生成，请勿手动编辑。
[Unit]
Description=GPT Image Studio Companion（开机自启）
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${execStartArgs}
WorkingDirectory=${workingDir}
Environment=PATH=${pathEnv}
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target
`;
}

/** 尝试无 sudo 开 linger（多半失败，失败时返回手动命令提示）。 */
function tryEnableLinger(): { enabled: boolean; reason?: string } {
  try {
    execFileSync("loginctl", ["enable-linger", userInfo().username], { stdio: "pipe" });
    return { enabled: true };
  } catch {
    return {
      enabled: false,
      reason: `已启用"登录即启"。如需"开机即启"（无需登录），请手动执行：sudo loginctl enable-linger ${userInfo().username}`,
    };
  }
}

/** 读当前 linger 状态。 */
function readLinger(): boolean {
  try {
    const out = execFileSync("loginctl", ["show-user", userInfo().username], {
      stdio: "pipe",
      encoding: "utf-8",
    });
    return /^Linger=yes$/m.test(out);
  } catch {
    return false;
  }
}
