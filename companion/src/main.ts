#!/usr/bin/env node
import { createInterface } from "node:readline";
import { existsSync, statSync } from "node:fs";
import { Option, program } from "commander";
import type { CompanionHealthResponse, PairWaitResponse } from "./types.js";
import { loadCredentials, saveCredentials, clearCredentials, maskApiKey } from "./credentials.js";
import { clearSession, getSessionInfo, loadSession } from "./pairingState.js";
import { createSecurityConfig } from "./securityConfig.js";
import {
  getLogFilePath,
  isProcessRunning,
  readLastLines,
  readLogChunkSince,
  readManagedProcessInfo,
  startManagedProcess,
  stopManagedProcess,
} from "./processManager.js";

const VERSION = "0.3.0";
const DEFAULT_PORT = "19750";
const DEFAULT_SESSION_TTL_DAYS = "30";

/**
 * login 命令的 provider 预设：每个 provider 的默认 base url + 默认 model + 简介。
 * 新增 provider 时在这里加一项即可（adapter 在 registry 注册后，login 这里就能选）。
 */
type ProviderPreset = {
  id: string;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
};
const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI 兼容（gpt-image-2 / 中转站）",
    defaultBaseUrl: "https://api.packyapi.com/v1/images",
    defaultModel: "gpt-image-2",
  },
  {
    id: "glm",
    label: "GLM-Image（智谱 Zhipu）",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4/images",
    defaultModel: "glm-image",
  },
  {
    id: "doubao",
    label: "豆包 Seedream（火山方舟 ByteDance）",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3/images",
    defaultModel: "doubao-seedream-5-0-lite",
  },
];

type ServeLikeOptions = {
  port: string;
  channel?: string;
  allowOrigin?: string[];
  sessionTtlDays: string;
  managed?: boolean;
};

function addServeOptions(command: ReturnType<typeof program.command>) {
  return command
    .option("-p, --port <port>", "监听端口", DEFAULT_PORT)
    .option("--channel <channel>", "安全渠道：stable 或 dev", process.env.GPT_IMAGE_STUDIO_COMPANION_CHANNEL)
    .option("--allow-origin <origin...>", "额外允许的完整 origin，例如 http://localhost:5173")
    .option("--session-ttl-days <days>", "配对 session 有效天数", DEFAULT_SESSION_TTL_DAYS)
    .addOption(new Option("--managed", "由 start 命令托管的后台服务").hideHelp());
}

program
  .name("gpt-image-studio")
  .description("GPT Image Studio 本地 CLI Companion")
  .version(VERSION);

addServeOptions(program
  .command("serve")
  .description("前台启动本地 companion HTTP 服务"))
  .action(async (opts: ServeLikeOptions) => {
    const { startServer } = await import("./server.js");
    await startServer({
      port: Number(opts.port),
      security: createSecurityConfig({
        channel: opts.channel,
        allowOrigins: opts.allowOrigin ?? [],
        sessionTtlDays: Number(opts.sessionTtlDays),
      }),
      runMode: opts.managed ? "managed" : "serve",
    });
  });

addServeOptions(program
  .command("start")
  .description("后台启动本地 companion 服务"))
  .action(async (opts: ServeLikeOptions) => {
    const info = startManagedProcess({
      port: Number(opts.port),
      channel: opts.channel ?? "stable",
      allowOrigins: opts.allowOrigin ?? [],
      sessionTtlDays: Number(opts.sessionTtlDays),
    });

    console.log(`Companion 已在后台启动: http://127.0.0.1:${info.port}`);
    console.log(`PID: ${info.pid}`);
    console.log(`日志: ${info.logFile}`);
    console.log("需要配对时请运行：gpt-image-studio pair");
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

    const info = startManagedProcess({
      port: Number(opts.port),
      channel: opts.channel ?? "stable",
      allowOrigins: opts.allowOrigin ?? [],
      sessionTtlDays: Number(opts.sessionTtlDays),
    });
    console.log(`Companion 已在后台重启: http://127.0.0.1:${info.port}`);
    console.log(`PID: ${info.pid}`);
    console.log(`日志: ${info.logFile}`);
    console.log("需要配对时请运行：gpt-image-studio pair");
  });

program
  .command("logs")
  .description("查看后台 companion 日志")
  .option("--lines <count>", "显示最后多少行", "100")
  .option("--date <date>", "查看指定日期日志，格式 YYYY-MM-DD")
  .option("-f, --follow", "持续跟随日志")
  .action(async (opts) => {
    const logFile = opts.date
      ? getLogFilePath(new Date(`${opts.date}T00:00:00.000Z`))
      : readManagedProcessInfo()?.logFile ?? getLogFilePath();
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

program
  .command("pair")
  .description("进入配对模式，等待网页端发起配对并完成确认")
  .option("-p, --port <port>", "companion 服务端口", DEFAULT_PORT)
  .option("--timeout <seconds>", "等待配对成功的秒数", "300")
  .action(async (opts: { port: string; timeout: string }) => {
    const port = Number(opts.port);
    const timeoutSeconds = Number(opts.timeout);
    const baseUrl = `http://127.0.0.1:${port}`;
    const managed = readManagedProcessInfo();
    if (!managed || !isProcessRunning(managed.pid) || managed.port !== port) {
      console.log(`没有找到由 start 启动的后台 Companion：${baseUrl}`);
      console.log("请先运行 gpt-image-studio start，或确认 pair 使用了正确的 --port。");
      return;
    }
    const logFile = managed.logFile;
    let offset = existsSync(logFile) ? statSync(logFile).size : 0;

    let result: PairWaitResponse;
    try {
      const res = await fetch(`${baseUrl}/pair/wait`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeoutSeconds }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(await res.text());
      result = await res.json() as PairWaitResponse;
    } catch {
      console.log(`无法连接 Companion 服务：${baseUrl}`);
      console.log("请先运行 gpt-image-studio start，或确认 serve 正在前台运行。");
      return;
    }

    console.log(`已进入配对模式，有效期 ${Math.floor(result.expiresInSeconds / 60)} 分钟。`);
    console.log("请在网页设置中点击「开始配对」，随后在此处查看配对码。");
    console.log("按 Ctrl+C 可停止等待，后台服务会继续运行。");

    const paired = await waitForPairingFromLog(baseUrl, logFile, offset, timeoutSeconds * 1000);
    if (paired) {
      console.log("配对成功。");
    } else {
      console.log("等待超时。请重新运行 gpt-image-studio pair 后再在网页端开始配对。");
    }
  });

program
  .command("login")
  .description("配置 API 凭据")
  .action(async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, resolve));

    // 1. 选 provider
    console.log("选择 Provider：");
    PROVIDER_PRESETS.forEach((p, i) => console.log(`  ${i + 1}. ${p.label}`));
    const providerChoice = (await ask(`输入序号（默认 1）: `)).trim();
    const providerIndex =
      Number(providerChoice) >= 1 && Number(providerChoice) <= PROVIDER_PRESETS.length
        ? Number(providerChoice) - 1
        : 0;
    const preset = PROVIDER_PRESETS[providerIndex];

    // 2. base url（带 provider 默认值）
    const apiBaseUrl =
      (await ask(`API Base URL（默认 ${preset.defaultBaseUrl}）: `)).trim() ||
      preset.defaultBaseUrl;

    // 3. model（带 provider 默认值；模型 ID 会漂移，让用户可改）
    const model =
      (await ask(`Model（默认 ${preset.defaultModel}）: `)).trim() || preset.defaultModel;

    // 4. api key（隐藏输入）
    const apiKey = await new Promise<string>((resolve) => {
      process.stdout.write("API Key: ");
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
          // 之前漏了 0x7f，导致按退格时 DEL 字符被当普通字符存进 key（污染凭据）。
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

    rl.close();

    if (!apiKey.trim()) {
      console.log("未输入 API Key，取消操作。");
      return;
    }

    saveCredentials(apiBaseUrl, apiKey.trim(), { provider: preset.id, model });
    console.log("");
    console.log("凭据已保存。");
    console.log(`  Provider:     ${preset.label}`);
    console.log(`  API Base URL: ${apiBaseUrl}`);
    console.log(`  Model:        ${model}`);
    console.log(`  API Key:      ${maskApiKey(apiKey.trim())}`);
  });

program
  .command("status")
  .description("查看 companion 状态")
  .action(async () => {
    loadSession();
    const creds = loadCredentials();
    const session = getSessionInfo();

    console.log("┌─────────────────────────────────┐");
    console.log("│  GPT Image Studio Companion     │");
    console.log("└─────────────────────────────────┘");
    console.log("");

    if (creds) {
      const providerId = creds.provider ?? "openai";
      const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
      console.log(`凭据:    已配置`);
      console.log(`  Provider: ${preset ? preset.label : providerId}`);
      console.log(`  Model:    ${creds.model ?? "(未设置)"}`);
      console.log(`  Base URL: ${creds.apiBaseUrl}`);
      console.log(`  API Key:  ${maskApiKey(creds.apiKey)}`);
      console.log(`  保存时间: ${creds.savedAt}`);
    } else {
      console.log("凭据:    未配置（运行 gpt-image-studio login 进行配置）");
    }

    console.log(`配对:    ${session.paired ? "已配对" : "未配对"}`);
    if (session.expiresAt) {
      console.log(`  过期时间: ${session.expiresAt}`);
    }

    const managed = readManagedProcessInfo();
    if (managed) {
      const running = isProcessRunning(managed.pid);
      console.log(`后台:    ${running ? "运行中" : "记录已失效"}`);
      console.log(`  PID: ${managed.pid}`);
      console.log(`  端口: ${managed.port}`);
      console.log(`  渠道: ${managed.channel}`);
      console.log(`  日志: ${managed.logFile}`);
      console.log(`  启动时间: ${managed.startedAt}`);
    }

    const statusPort = managed?.port ?? 19750;
    try {
      const res = await fetch(`http://127.0.0.1:${statusPort}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log(`服务:    运行中 (127.0.0.1:${statusPort})`);
      } else {
        console.log("服务:    未运行");
      }
    } catch {
      console.log("服务:    未运行");
    }
  });

program
  .command("logout")
  .description("清除已保存的凭据")
  .action(async () => {
    clearCredentials();
    console.log("凭据已清除。");
  });

program
  .command("unpair")
  .description("清除网页端配对 session")
  .action(async () => {
    clearSession();
    console.log("配对 session 已清除。");
  });

program.parse();

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

async function waitForPairingFromLog(
  baseUrl: string,
  logFile: string,
  offset: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1000);
    if (existsSync(logFile)) {
      const size = statSync(logFile).size;
      if (size > offset) {
        const chunk = readLogChunkSince(logFile, offset);
        offset = size;
        chunk
          .split(/\r?\n/)
          .filter((line) => /配对码|请在网页端输入此配对码|有效期/.test(line))
          .forEach((line) => console.log(line));
      }
    }
    if (await isRemotePaired(baseUrl)) return true;
  }
  return false;
}

async function isRemotePaired(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const health = await res.json() as CompanionHealthResponse;
    return health.paired;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
