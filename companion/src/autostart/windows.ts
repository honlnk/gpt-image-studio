/**
 * Windows 开机自启——HKCU 注册表 Run 键。
 *
 * 写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下的一个值（免提权，用户登录时触发）。
 * - 值名：GPTImageStudioCompanion
 * - 值数据：`"node.exe" "main.js" start ...`（全路径，含空格用引号包裹）
 *
 * 用 `reg add` / `reg delete` / `reg query` 命令行工具（Windows 自带）。
 */

import { execFileSync } from "node:child_process";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME = "GPTImageStudioCompanion";

export type LaunchCommand = { node: string; main: string; args: string[] };

type PlatformStatus = { enabled: boolean; error?: string };

export function getStatus(): PlatformStatus {
  return { enabled: queryRunValue() };
}

export function enable(cmd: LaunchCommand): PlatformStatus {
  const valueData = `"${cmd.node}" "${cmd.main}" ${cmd.args.map((a) => `"${a}"`).join(" ")}`;
  try {
    execFileSync("reg", ["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", valueData, "/f"], {
      stdio: "pipe",
    });
  } catch (e) {
    return { enabled: false, error: `写入注册表失败：${String(e)}` };
  }
  return { enabled: true };
}

export function disable(): PlatformStatus {
  try {
    execFileSync("reg", ["delete", RUN_KEY, "/v", VALUE_NAME, "/f"], { stdio: "pipe" });
  } catch (e) {
    // 值不存在时 reg delete 返回 1；判断一下是不是"找不到"这种良性情况
    const msg = String(e);
    if (/unable|not found|找不到|无法/i.test(msg)) {
      return { enabled: false };
    }
    return { enabled: queryRunValue(), error: `删除注册表值失败：${msg}` };
  }
  return { enabled: false };
}

/** 查询 Run 键下值是否存在。 */
function queryRunValue(): boolean {
  try {
    const out = execFileSync("reg", ["query", RUN_KEY, "/v", VALUE_NAME], {
      stdio: "pipe",
      encoding: "utf-8",
    });
    return out.includes(VALUE_NAME);
  } catch {
    return false;
  }
}
