import { createInterface } from "node:readline";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { Option, program } from "commander";
import type { CompanionHealthResponse } from "./types.js";
import type { CredentialEntry, CredentialInput } from "./credentials.js";
import {
  CredentialStoreError,
  listCredentials,
  addCredential,
  updateCredential,
  removeCredential,
  activateCredential,
} from "./credentials.js";
import { loadOrCreateAccessKey, resetAccessKey, getAccessKey } from "./accessKey.js";
import { createSecurityConfig } from "./securityConfig.js";
import { resolveDeploymentConfig, HostIgnoredWarning } from "./deploymentConfig.js";
import { PROVIDER_PRESETS } from "./providerPresets.js";
import {
  getLogFilePath,
  isProcessRunning,
  readLastLines,
  readLogChunkSince,
  readManagedProcessInfo,
  startManagedProcess,
  stopManagedProcess,
} from "./processManager.js";
import {
  getAutostartStatus,
  enableAutostart,
  disableAutostart,
} from "./autostart/index.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
const COMPANION_VERSION = packageJson.version;
const DEFAULT_PORT = "19750";

/**
 * 包住 CLI action 函数，统一处理凭据文件损坏。
 *
 * loadStore 损坏时抛 CredentialStoreError（已备份损坏文件）。CLI 层不崩栈，
 * 只打印可读错误信息 + 设 exitCode=1，让用户知道发生了什么、原文件备份在哪。
 * 覆盖 sync 和 async 两种 action 签名。
 */
function withCredentialStoreErrorCLI<TArgs extends unknown[]>(
  fn: (...args: TArgs) => unknown,
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        result.catch((e) => {
          if (e instanceof CredentialStoreError) {
            console.error(e.message);
            process.exitCode = 1;
          } else {
            console.error(e);
            process.exitCode = 1;
          }
        });
      }
    } catch (e) {
      if (e instanceof CredentialStoreError) {
        console.error(e.message);
        process.exitCode = 1;
      } else {
        throw e;
      }
    }
  };
}

type ServeLikeOptions = {
  port: string;
  host?: string;
  deploymentMode?: string;
  channel?: string;
  allowOrigin?: string[];
  managed?: boolean;
};

/**
 * 从环境变量解析 --allow-origin 默认值：空格/逗号分隔多个完整 origin。
 * CLI 显式传 --allow-origin 时优先（commander 行为：显式值覆盖默认值）。
 * 无环境变量时返回 undefined（等价于"无默认值"），调用方按 [] 兜底。
 */
function parseAllowOriginsEnv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const list = value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

function addServeOptions(command: ReturnType<typeof program.command>) {
  return command
    .option("-p, --port <port>", "监听端口", DEFAULT_PORT)
    .option("-H, --host <host>", "监听地址（local 模式忽略，恒为 127.0.0.1）", process.env.COMPANION_HOST)
    .option("--deployment-mode <mode>", "部署形态：local 或 server", process.env.COMPANION_DEPLOYMENT_MODE)
    .option("--channel <channel>", "安全渠道：stable 或 dev", process.env.GPT_IMAGE_STUDIO_COMPANION_CHANNEL)
    .option(
      "--allow-origin <origin...>",
      "额外允许的完整 origin，例如 http://localhost:5173（也可用 COMPANION_ALLOW_ORIGINS，空格/逗号分隔多个）",
      parseAllowOriginsEnv(process.env.COMPANION_ALLOW_ORIGINS),
    )
    .addOption(new Option("--managed", "由 start 命令托管的后台服务").hideHelp());
}

program
  .name("gpt-image-studio")
  .description("GPT Image Studio 本地 CLI Companion")
  .version(COMPANION_VERSION);

addServeOptions(program
  .command("serve")
  .description("前台启动本地 companion HTTP 服务"))
  .action(async (opts: ServeLikeOptions) => {
    const { startServer } = await import("./server.js");
    const deployment = resolveDeploymentConfig(
      { mode: opts.deploymentMode, host: opts.host },
      (w: HostIgnoredWarning) => console.warn(`⚠️  ${w.reason}`),
    );
    await startServer({
      port: Number(opts.port),
      host: deployment.host,
      deployment,
      security: createSecurityConfig({
        channel: opts.channel,
        allowOrigins: opts.allowOrigin ?? [],
      }),
    });
  });

addServeOptions(program
  .command("start")
  .description("后台启动本地 companion 服务"))
  .action(async (opts: ServeLikeOptions) => {
    const deployment = resolveDeploymentConfig(
      { mode: opts.deploymentMode, host: opts.host },
      (w: HostIgnoredWarning) => console.warn(`⚠️  ${w.reason}`),
    );
    const info = startManagedProcess({
      port: Number(opts.port),
      host: deployment.host,
      deploymentMode: deployment.mode,
      dataDir: deployment.dataDir,
      channel: opts.channel ?? "stable",
      allowOrigins: opts.allowOrigin ?? [],
    });

    console.log(`Companion 已在后台启动: http://${deployment.host}:${info.port}`);
    console.log(`PID: ${info.pid}`);
    console.log(`部署形态: ${deployment.mode}`);
    console.log(`日志: ${info.logFile}`);
    console.log("启动日志中包含连接密钥，可用 gpt-image-studio status 查看。");
  });

program
  .command("stop")
  .description("停止后台 companion 服务")
  .action(() => {
    const result = stopManagedProcess();
    if (result.stopped && result.info) {
      console.log(`已停止后台 Companion，PID: ${result.info.pid}`);
    } else if (result.stale && result.info) {
      console.log(`后台 PID 已失效，已清理记录：${result.info.pid}`);
    } else {
      console.log("没有找到由 start 启动的后台 Companion。");
    }
  });

addServeOptions(program
  .command("restart")
  .description("重启后台 companion 服务"))
  .action(async (opts: ServeLikeOptions) => {
    const stopped = stopManagedProcess();
    if (stopped.stopped && stopped.info) {
      console.log(`已停止后台 Companion，PID: ${stopped.info.pid}`);
    }

    const deployment = resolveDeploymentConfig(
      {
        mode: opts.deploymentMode ?? stopped.info?.deploymentMode,
        host: opts.host ?? stopped.info?.host,
      },
      (w: HostIgnoredWarning) => console.warn(`⚠️  ${w.reason}`),
    );
    const info = startManagedProcess({
      port: Number(opts.port),
      host: deployment.host,
      deploymentMode: deployment.mode,
      dataDir: stopped.info?.dataDir ?? deployment.dataDir,
      channel: opts.channel ?? "stable",
      allowOrigins: opts.allowOrigin ?? [],
    });
    console.log(`Companion 已在后台重启: http://${deployment.host}:${info.port}`);
    console.log(`PID: ${info.pid}`);
    console.log(`部署形态: ${deployment.mode}`);
    console.log(`日志: ${info.logFile}`);
    console.log("启动日志中包含连接密钥，可用 gpt-image-studio status 查看。");
  });

program
  .command("logs")
  .description("查看后台 companion 日志")
  .option("--lines <count>", "显示最后多少行", "100")
  .option("--date <date>", "查看指定日期日志，格式 YYYY-MM-DD")
  .option("-f, --follow", "持续跟随日志")
  .action(async (opts) => {
    const managed = readManagedProcessInfo();
    const logFile = opts.date
      ? getLogFilePath(
          new Date(`${opts.date}T00:00:00.000Z`),
          managed?.dataDir,
        )
      : managed?.logFile ?? getLogFilePath();
    const lines = readLastLines(logFile, Number(opts.lines));
    if (lines.length === 0) {
      console.log(`没有日志：${logFile}`);
    } else {
      lines.forEach((line) => console.log(line));
    }
    if (opts.follow) {
      console.log(`\n正在跟随日志：${logFile}`);
      await followLogFile(logFile);
    }
  });

// ==================== provider 子命令组 ====================

const providerCmd = program
  .command("provider")
  .description("管理 provider 配置列表（增删改查 + 激活切换）");

providerCmd
  .command("list")
  .description("列出所有 provider 配置")
  .action(withCredentialStoreErrorCLI(() => {
    const store = listCredentials();
    if (store.entries.length === 0) {
      console.log("暂无 provider 配置，用 gpt-image-studio provider add 添加。");
      return;
    }
    console.log("=".repeat(60));
    store.entries.forEach((entry) => {
      const active = entry.id === store.activeId ? " [激活中]" : "";
      console.log(`${entry.label}${active}`);
      console.log(`  ID:       ${entry.id}`);
      console.log(`  Provider: ${entry.provider}`);
      console.log(`  Model:    ${entry.model || "(未设置)"}`);
      console.log(`  Base URL: ${entry.apiBaseUrl}`);
      console.log(`  API Key:  ${entry.apiKey}`);
      console.log("");
    });
    console.log("=".repeat(60));
  }));

providerCmd
  .command("show <id>")
  .description("查看单条配置详情")
  .action(withCredentialStoreErrorCLI((id: string) => {
    const store = listCredentials();
    const entry = store.entries.find((e) => e.id === id);
    if (!entry) {
      console.log(`未找到 ID 为 ${id} 的配置。`);
      return;
    }
    const active = entry.id === store.activeId ? " [激活中]" : "";
    console.log(`${entry.label}${active}`);
    console.log(`  ID:       ${entry.id}`);
    console.log(`  Provider: ${entry.provider}`);
    console.log(`  Model:    ${entry.model || "(未设置)"}`);
    console.log(`  Base URL: ${entry.apiBaseUrl}`);
    console.log(`  API Key:  ${entry.apiKey}`);
    console.log(`  创建时间: ${entry.createdAt}`);
    console.log(`  更新时间: ${entry.updatedAt}`);
  }));

providerCmd
  .command("add")
  .description("交互式新增 provider 配置")
  .action(withCredentialStoreErrorCLI(async () => {
    const input = await promptCredentialInput();
    if (!input) return;
    const entry = addCredential(input);
    console.log("");
    console.log("配置已保存。");
    printEntrySummary(entry);
    console.log(`  ID: ${entry.id}`);
  }));

providerCmd
  .command("edit <id>")
  .description("编辑指定 provider 配置")
  .action(withCredentialStoreErrorCLI(async (id: string) => {
    const store = listCredentials();
    const existing = store.entries.find((e) => e.id === id);
    if (!existing) {
      console.log(`未找到 ID 为 ${id} 的配置。`);
      return;
    }
    const input = await promptCredentialInput(existing);
    if (!input) return;
    const entry = updateCredential(id, input);
    if (entry) {
      console.log("");
      console.log("配置已更新。");
      printEntrySummary(entry);
    }
  }));

providerCmd
  .command("remove <id>")
  .description("删除指定 provider 配置")
  .action(withCredentialStoreErrorCLI((id: string) => {
    const removed = removeCredential(id);
    if (removed) {
      console.log("配置已删除。");
    } else {
      console.log(`未找到 ID 为 ${id} 的配置。`);
    }
  }));

providerCmd
  .command("activate <id>")
  .description("将指定配置设为激活")
  .action(withCredentialStoreErrorCLI((id: string) => {
    const ok = activateCredential(id);
    if (ok) {
      console.log("已设为激活。");
    } else {
      console.log(`未找到 ID 为 ${id} 的配置。`);
    }
  }));

// ==================== autostart 子命令组（开机自启）====================

const autostartCmd = program
  .command("autostart")
  .description("管理系统开机自启（macOS launchd / Linux systemd / Windows 注册表）");

autostartCmd
  .command("status")
  .description("查看开机自启状态")
  .action(() => {
    const status = getAutostartStatus();
    const platformLabel = {
      macos: "macOS (launchd)",
      linux: "Linux (systemd)",
      windows: "Windows (注册表)",
      unsupported: "不支持",
    }[status.platform];
    console.log("=".repeat(50));
    console.log("  开机自启状态");
    console.log("=".repeat(50));
    console.log(`平台:     ${platformLabel}`);
    console.log(`自启:     ${status.enabled ? "✅ 已启用" : "❌ 未启用"}`);
    if (status.platform === "linux") {
      console.log(
        `Linger:   ${status.linger ? "✅ 已开启（真·开机启动）" : "⚠️  未开启（仅登录启动）"}`,
      );
    }
    if (status.command) {
      console.log(`启动命令: ${status.command}`);
    }
    if (status.error) {
      console.log(`提示:     ${status.error}`);
    }
    console.log("=".repeat(50));
  });

autostartCmd
  .command("enable")
  .description("启用开机自启（用户登录时触发，免提权）")
  .action(() => {
    const status = enableAutostart();
    if (status.error) {
      console.warn(`⚠️  ${status.error}`);
    }
    console.log(status.enabled ? "✅ 开机自启已启用" : "❌ 启用失败");
    if (status.enabled && status.platform === "linux") {
      console.log("   （登录即启。如需开机即启，执行：sudo loginctl enable-linger $USER）");
    }
  });

autostartCmd
  .command("disable")
  .description("停用开机自启")
  .action(() => {
    const status = disableAutostart();
    if (status.error) {
      console.warn(`⚠️  ${status.error}`);
    }
    console.log("✅ 开机自启已停用");
  });

// ==================== status 命令 ====================

program
  .command("status")
  .description("查看 companion 状态")
  .action(async () => {
    const accessKey = getAccessKey();

    console.log("=".repeat(50));
    console.log("  GPT Image Studio Companion");
    console.log("=".repeat(50));
    console.log("");
    console.log(`版本:    v${COMPANION_VERSION}`);

    // 凭据状态：损坏时单独 catch 并展示原因，不阻断后续服务/密钥状态输出。
    // getActiveCredential 内部已 catch CredentialStoreError 返 null，但这里需要
    // 显式探测损坏以展示原因；用 listCredentials 一次性拿 count + active。
    try {
      const store = listCredentials();
      const active = store.activeId ? store.entries.find((e) => e.id === store.activeId) ?? null : null;
      if (active) {
        const preset = PROVIDER_PRESETS.find((p) => p.id === active.provider);
        console.log(`凭据:    已配置（${store.entries.length} 条，当前激活：${active.label}）`);
        console.log(`  Provider: ${preset ? preset.label : active.provider}`);
        console.log(`  Model:    ${active.model || "(未设置)"}`);
        console.log(`  Base URL: ${active.apiBaseUrl}`);
        console.log(`  API Key:  ${active.apiKey}`);
      } else {
        console.log("凭据:    未配置（运行 gpt-image-studio provider add 添加配置）");
      }
    } catch (e) {
      if (e instanceof CredentialStoreError) {
        console.log(`凭据:    ${e.message}`);
      } else {
        throw e;
      }
    }

    const managed = readManagedProcessInfo();
    if (managed) {
      const running = isProcessRunning(managed.pid);
      console.log(`后台:    ${running ? "运行中" : "记录已失效"}`);
      console.log(`  PID: ${managed.pid}`);
      console.log(`  端口: ${managed.port}`);
      // server 模式下 host 可能是 0.0.0.0，status 是本机探测，统一用 127.0.0.1
      const displayHost = managed.host && managed.host !== "0.0.0.0" ? managed.host : "127.0.0.1";
      console.log(`  地址: ${managed.host ?? displayHost}`);
      if (managed.deploymentMode) {
        console.log(`  形态: ${managed.deploymentMode}`);
      }
      console.log(`  渠道: ${managed.channel}`);
      console.log(`  日志: ${managed.logFile}`);
      if (managed.dataDir) {
        console.log(`  数据: ${managed.dataDir}`);
      }
      console.log(`  启动时间: ${managed.startedAt}`);
    }

    const statusPort = managed?.port ?? 19750;
    // status 总是在本机执行，统一用 127.0.0.1 探测（即使 server 模式监听 0.0.0.0，本机回环也能命中）
    try {
      const res = await fetch(`http://127.0.0.1:${statusPort}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const health = await res.json() as CompanionHealthResponse;
        console.log(`服务:    运行中 (127.0.0.1:${statusPort}, v${health.version})`);
      } else {
        console.log("服务:    未运行");
      }
    } catch {
      console.log("服务:    未运行");
    }

    // 连接密钥：服务运行时从内存读，否则从磁盘读。
    if (accessKey) {
      console.log("");
      console.log("=".repeat(60));
      console.log("  连接密钥（请粘进网页 /companion 页面完成连接）");
      console.log(`  ${accessKey}`);
      console.log("=".repeat(60));
    } else if (managed && isProcessRunning(managed.pid)) {
      // 服务在跑但 CLI 进程还没 loadOrCreateAccessKey（正常情况：服务进程持有密钥）。
      // 从磁盘读给用户看。
      const key = loadOrCreateAccessKey();
      console.log("");
      console.log("=".repeat(60));
      console.log("  连接密钥（请粘进网页 /companion 页面完成连接）");
      console.log(`  ${key}`);
      console.log("=".repeat(60));
    }
  });

program
  .command("reset-key")
  .description("重新生成连接密钥（旧密钥立即失效，需在网页重新粘贴新密钥）")
  .action(() => {
    const newKey = resetAccessKey();
    console.log("连接密钥已重新生成。旧密钥已失效。");
    console.log("");
    console.log("=".repeat(60));
    console.log("  新连接密钥（请粘进网页 /companion 页面完成连接）");
    console.log(`  ${newKey}`);
    console.log("=".repeat(60));
  });

program.parse();

// ==================== 交互式输入辅助 ====================

async function promptCredentialInput(existing?: CredentialEntry): Promise<CredentialInput | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  // 1. label
  const defaultLabel = existing?.label ?? "";
  const label =
    (await ask(`配置名称${defaultLabel ? `（默认 ${defaultLabel}）` : "（可选）"}: `)).trim() ||
    defaultLabel;

  // 2. provider
  console.log("选择 Provider：");
  PROVIDER_PRESETS.forEach((p, i) => console.log(`  ${i + 1}. ${p.label}`));
  const currentProviderIndex = existing
    ? PROVIDER_PRESETS.findIndex((p) => p.id === existing.provider)
    : 0;
  const providerChoice = (await ask(`输入序号（默认 ${currentProviderIndex + 1}）: `)).trim();
  const providerIndex =
    Number(providerChoice) >= 1 && Number(providerChoice) <= PROVIDER_PRESETS.length
      ? Number(providerChoice) - 1
      : Math.max(0, currentProviderIndex);
  const preset = PROVIDER_PRESETS[providerIndex];

  // 3. base url
  const baseUrlDefault = existing?.apiBaseUrl || preset.defaultBaseUrl;
  const apiBaseUrl =
    (await ask(`API Base URL（默认 ${baseUrlDefault}）: `)).trim() || baseUrlDefault;

  // 4. model
  const modelDefault = existing?.model || preset.defaultModel;
  const model =
    (await ask(`Model（默认 ${modelDefault}）: `)).trim() || modelDefault;

  // 5. api key
  const keyHint = existing ? `（当前 ${existing.apiKey}，直接回车保留）` : "";
  let apiKey: string;
  if (existing) {
    apiKey = (await ask(`API Key${keyHint}: `)).trim() || existing.apiKey;
  } else {
    apiKey = await promptPassword("API Key: ");
  }

  rl.close();

  if (!apiKey.trim()) {
    console.log("未输入 API Key，取消操作。");
    return null;
  }

  return {
    label: label || undefined,
    provider: preset.id,
    apiBaseUrl,
    apiKey: apiKey.trim(),
    model,
  };
}

/** 隐藏输入读取 API Key。 */
async function promptPassword(prompt: string): Promise<string> {
  return new Promise<string>((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    let input = "";
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r") {
        stdin.removeListener("data", onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        process.stdout.write("\n");
        resolve(input);
      } else if (c === "\b" || c === "\x7f") {
        // 退格：\b (0x08) 和 DEL (0x7f) 都要识别——多数终端退格键发 0x7f。
        input = input.slice(0, -1);
      } else if (c === "\x03") {
        // Ctrl-C
        process.exit(1);
      } else if (c >= " " && c !== "\x7f") {
        // 只接受可打印字符（0x20 起），跳过其他控制字符
        input += c;
      }
    };
    stdin.resume();
    stdin.on("data", onData);
  });
}

function printEntrySummary(entry: CredentialEntry): void {
  const preset = PROVIDER_PRESETS.find((p) => p.id === entry.provider);
  console.log(`  名称:     ${entry.label}`);
  console.log(`  Provider: ${preset ? preset.label : entry.provider}`);
  console.log(`  Model:    ${entry.model || "(未设置)"}`);
  console.log(`  Base URL: ${entry.apiBaseUrl}`);
  console.log(`  API Key:  ${entry.apiKey}`);
}

async function followLogFile(logFile: string): Promise<void> {
  let offset = existsSync(logFile) ? statSync(logFile).size : 0;
  while (true) {
    await sleep(1000);
    if (!existsSync(logFile)) continue;
    const size = statSync(logFile).size;
    if (size <= offset) continue;
    const chunk = readLogChunkSince(logFile, offset);
    offset = size;
    process.stdout.write(chunk);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
