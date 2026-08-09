import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 开机自启单元测试。
 *
 * 不做真机集成测试（不真跑 launchctl/systemctl/reg）。
 * 重点验证：
 * - getLaunchCommand：把 serve 换成 start、绝对路径化
 * - macOS：buildPlist 纯函数内容 + enable/disable 文件写入与 launchctl 调用
 * - Linux：buildUnit 纯函数内容（enable/disable 因 hasSystemd 守卫在非 Linux 测试环境不可达，
 *   由 CI Linux 容器集成测试覆盖）
 * - Windows：enable/disable 的 reg 命令拼接
 *
 * mock 策略（仅 macOS enable/disable 需要）：
 * - node:child_process 的 execFileSync → 返回空，记录调用参数断言命令正确性
 * - node:os 的 homedir/userInfo → 指向临时目录，让 plist 写到可控位置
 */

const ORIGINAL_ARGV = [...process.argv];

function setArgv(script: string, ...args: string[]) {
  Object.defineProperty(process, "argv", {
    value: [process.argv[0], script, ...args],
    configurable: true,
  });
}

function restoreArgv() {
  Object.defineProperty(process, "argv", {
    value: ORIGINAL_ARGV,
    configurable: true,
  });
}

describe("getLaunchCommand", () => {
  afterEach(() => {
    restoreArgv();
    vi.resetModules();
  });

  it("把 serve 子命令换成 start（自启走 start 托管路径）", async () => {
    setArgv("/abs/dist/main.js", "serve", "--port", "19750", "--channel", "stable", "--managed");
    const { getLaunchCommand } = await import("./index.js");
    const cmd = getLaunchCommand();
    expect(cmd.args[0]).toBe("start");
    expect(cmd.args).toContain("--port");
    expect(cmd.args).toContain("19750");
    expect(cmd.args).toContain("--managed");
  });

  it("main.js 解析成绝对路径", async () => {
    setArgv("/abs/dist/main.js", "serve");
    const { getLaunchCommand } = await import("./index.js");
    const cmd = getLaunchCommand();
    expect(cmd.main.startsWith("/")).toBe(true);
    expect(cmd.main).toBe("/abs/dist/main.js");
  });

  it("已经是 start 时保持 start", async () => {
    setArgv("/abs/dist/main.js", "start", "--channel", "dev");
    const { getLaunchCommand } = await import("./index.js");
    const cmd = getLaunchCommand();
    expect(cmd.args[0]).toBe("start");
  });
});

describe("平台分发（detectPlatform）", () => {
  it("process.platform 映射正确", async () => {
    const { detectPlatform } = await import("./platform.js");
    const p = detectPlatform();
    expect(["macos", "linux", "windows", "unsupported"]).toContain(p);
    if (process.platform === "darwin") expect(p).toBe("macos");
    if (process.platform === "linux") expect(p).toBe("linux");
    if (process.platform === "win32") expect(p).toBe("windows");
  });
});

describe("macOS buildPlist（纯函数）", () => {
  it("含 RunAtLoad=true / KeepAlive=false / 绝对路径 ProgramArguments / PATH 环境变量", async () => {
    const { buildPlist } = await import("./macos.js");
    const xml = buildPlist({
      node: "/usr/local/bin/node",
      main: "/Users/test/dist/main.js",
      args: ["start", "--port", "19750"],
    });
    expect(xml).toContain("<key>Label</key>");
    expect(xml).toContain("com.honlnk.image-studio-companion");
    expect(xml).toContain("<key>RunAtLoad</key>");
    expect(xml).toContain("<true/>");
    expect(xml).toContain("<key>KeepAlive</key>");
    expect(xml).toContain("<false/>");
    expect(xml).toContain("<string>/usr/local/bin/node</string>");
    expect(xml).toContain("<string>/Users/test/dist/main.js</string>");
    expect(xml).toContain("<string>start</string>");
    expect(xml).toContain("<string>--port</string>");
    expect(xml).toContain("<string>19750</string>");
    expect(xml).toContain("<key>EnvironmentVariables</key>");
    expect(xml).toContain("/opt/homebrew/bin");
    expect(xml).toContain("<key>HOME</key>");
  });

  it("XML 特殊字符转义", async () => {
    const { buildPlist } = await import("./macos.js");
    const xml = buildPlist({
      node: "/path/with <&> \"'\"/node",
      main: "/main.js",
      args: ["start"],
    });
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&quot;");
    expect(xml).not.toContain("<&>");
  });
});

// ===== macOS enable/disable：mock node:os + node:child_process =====
const state = vi.hoisted(() => ({ tmpHome: "", execCalls: [] as string[][] }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => state.tmpHome,
    userInfo: () => ({ uid: 501, username: "testuser" }),
  };
});

vi.mock("node:child_process", () => ({
  execFileSync: (cmd: string, cmdArgs?: string[], _opts?: unknown) => {
    // 记录成扁平数组：[cmd, ...cmdArgs]，便于断言
    state.execCalls.push([cmd, ...(cmdArgs ?? [])]);
    return "";
  },
}));

describe("macOS enable/disable 流程", () => {
  beforeEach(() => {
    state.tmpHome = mkdtempSync(join(tmpdir(), "autostart-macos-")).slice();
    state.execCalls = [];
  });

  afterEach(() => {
    rmSync(state.tmpHome, { recursive: true, force: true });
    vi.resetModules();
  });

  it("enable 写 plist 文件并调 plutil + launchctl bootstrap", async () => {
    const macos = await import("./macos.js");
    const status = macos.enable({
      node: "/usr/local/bin/node",
      main: join(state.tmpHome, "dist", "main.js"),
      args: ["start", "--port", "19750"],
    });

    expect(status.enabled).toBe(true);
    expect(state.execCalls.some((c) => c.join(" ").includes("plutil -lint"))).toBe(true);
    expect(state.execCalls.some((c) => c.join(" ").includes("launchctl bootstrap"))).toBe(true);

    const plistPath = join(state.tmpHome, "Library", "LaunchAgents", "com.honlnk.image-studio-companion.plist");
    expect(existsSync(plistPath)).toBe(true);
  });

  it("status 反映 plist 文件存在性", async () => {
    const macos = await import("./macos.js");
    expect(macos.getStatus().enabled).toBe(false);
    macos.enable({
      node: "/usr/local/bin/node",
      main: join(state.tmpHome, "dist", "main.js"),
      args: ["start"],
    });
    expect(macos.getStatus().enabled).toBe(true);
  });

  it("disable 删除 plist 并调 bootout", async () => {
    const macos = await import("./macos.js");
    macos.enable({
      node: "/usr/local/bin/node",
      main: join(state.tmpHome, "dist", "main.js"),
      args: ["start"],
    });
    const plistPath = join(state.tmpHome, "Library", "LaunchAgents", "com.honlnk.image-studio-companion.plist");
    expect(existsSync(plistPath)).toBe(true);

    const status = macos.disable();
    expect(status.enabled).toBe(false);
    expect(existsSync(plistPath)).toBe(false);
    expect(state.execCalls.some((c) => c.join(" ").includes("launchctl bootout"))).toBe(true);
  });
});

describe("Linux buildUnit（纯函数）", () => {
  it("含 Type=oneshot / RemainAfterExit / WantedBy=default.target / ExecStart 绝对路径 / PATH", async () => {
    const { buildUnit } = await import("./linux.js");
    const unit = buildUnit({
      node: "/usr/bin/node",
      main: "/home/test/dist/main.js",
      args: ["start", "--port", "19750"],
    });
    expect(unit).toContain("Type=oneshot");
    expect(unit).toContain("RemainAfterExit=yes");
    expect(unit).toContain("WantedBy=default.target");
    expect(unit).toContain("After=network-online.target");
    expect(unit).toContain("ExecStart=/usr/bin/node \"/home/test/dist/main.js\" \"start\" \"--port\" \"19750\"");
    expect(unit).toContain("Environment=PATH=");
    expect(unit).toContain("Environment=HOME=");
    expect(unit).toContain("Description=GPT Image Studio Companion");
  });
});

describe("Windows enable/disable 命令拼接", () => {
  beforeEach(() => {
    state.execCalls = [];
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("enable 调 reg add 写入 Run 键（全路径 + 引号）", async () => {
    const windows = await import("./windows.js");
    const status = windows.enable({
      node: "C:\\Program Files\\nodejs\\node.exe",
      main: "C:\\Users\\me\\dist\\main.js",
      args: ["start", "--port", "19750"],
    });

    expect(status.enabled).toBe(true);
    const addCall = state.execCalls.find(
      (c) => c[0] === "reg" && c[1] === "add",
    );
    expect(addCall).toBeTruthy();
    const args = addCall!;
    const dataArg = args[args.indexOf("/d") + 1];
    expect(dataArg).toContain("C:\\Program Files\\nodejs\\node.exe");
    expect(dataArg).toContain("C:\\Users\\me\\dist\\main.js");
    expect(dataArg).toContain("start");
    // 值名正确
    expect(args).toContain("GPTImageStudioCompanion");
    expect(args).toContain("REG_SZ");
  });

  it("disable 调 reg delete", async () => {
    const windows = await import("./windows.js");
    windows.disable();
    const delCall = state.execCalls.find(
      (c) => c[0] === "reg" && c[1] === "delete",
    );
    expect(delCall).toBeTruthy();
    expect(delCall!).toContain("GPTImageStudioCompanion");
  });
});
