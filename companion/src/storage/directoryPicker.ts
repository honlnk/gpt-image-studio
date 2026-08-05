import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * 原生目录选择器：管理页「选择文件夹…」按钮的后端支撑。
 *
 * 浏览器拿不到用户本机目录的绝对路径（安全限制），而 Companion 与管理页同机运行，
 * 可以直接弹操作系统的原生目录选择框：
 * - macOS：osascript choose folder
 * - Windows：PowerShell FolderBrowserDialog
 * - Linux：zenity（未安装时返回结构化错误，用户仍可手输路径）
 *
 * 命令构建与输出解析是纯函数（可单测）；实际弹窗的 pickDirectoryNative 不进测试
 * （CI/开发机上弹原生对话框不可控）。
 */

const execFileAsync = promisify(execFile);

/** 弹窗最长等待 5 分钟（等用户操作），超时按取消处理。 */
const PICK_TIMEOUT_MS = 5 * 60 * 1000;

export type PickDirectoryResult =
  | { ok: true; path: string }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; error: string };

/** 按平台返回选择器命令；不支持的平台返回 undefined。 */
export function buildPickerCommand(
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } | undefined {
  if (platform === "darwin") {
    return {
      cmd: "osascript",
      args: ["-e", 'POSIX path of (choose folder with prompt "选择图片存储目录")'],
    };
  }
  if (platform === "win32") {
    return {
      cmd: "powershell.exe",
      args: [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; " +
          "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
          "$d.Description = '选择图片存储目录'; " +
          "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }",
      ],
    };
  }
  if (platform === "linux") {
    return {
      cmd: "zenity",
      args: ["--file-selection", "--directory", "--title=选择图片存储目录"],
    };
  }
  return undefined;
}

/**
 * 解析选择器输出：去空白 + 去尾部路径分隔符（根目录 "/" 保留）。
 * osascript 的 POSIX path 固定带尾斜杠（如 /Users/x/Pictures/）。
 */
export function parsePickerPath(stdout: string): string {
  const trimmed = stdout.trim();
  if (trimmed === "/" || trimmed === "") return trimmed;
  return trimmed.replace(/[\\/]+$/, "");
}

/** 弹原生目录选择框，结构化返回结果（永不抛异常）。 */
export async function pickDirectoryNative(): Promise<PickDirectoryResult> {
  const command = buildPickerCommand();
  if (!command) {
    return {
      ok: false,
      canceled: false,
      error: `当前平台（${process.platform}）不支持原生目录选择，请手动输入路径`,
    };
  }
  try {
    const { stdout } = await execFileAsync(command.cmd, command.args, {
      timeout: PICK_TIMEOUT_MS,
    });
    const path = parsePickerPath(stdout);
    // Windows 取消时退出码正常但无输出
    if (!path) return { ok: false, canceled: true };
    return { ok: true, path };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT/.test(message)) {
      return {
        ok: false,
        canceled: false,
        error: "系统缺少目录选择组件（Linux 需安装 zenity），请手动输入路径",
      };
    }
    // 用户取消：osascript 退出码 1 + "User canceled"；zenity 取消退出码 1；超时视同取消
    const code = (err as { code?: number | string } | null)?.code;
    if (/user canceled/i.test(message) || code === 1 || /TIMEOUT/.test(message)) {
      return { ok: false, canceled: true };
    }
    return { ok: false, canceled: false, error: message };
  }
}
