#!/usr/bin/env node
import { createInterface } from "node:readline";
import { program } from "commander";
import { loadCredentials, saveCredentials, clearCredentials, maskApiKey } from "./credentials.js";
import { clearSession, getSessionInfo, loadSession } from "./pairingState.js";
import { createSecurityConfig } from "./securityConfig.js";

const VERSION = "0.1.1";

program
  .name("gpt-image-studio")
  .description("GPT Image Studio 本地 CLI Companion")
  .version(VERSION);

program
  .command("serve")
  .description("启动本地 companion HTTP 服务")
  .option("-p, --port <port>", "监听端口", "19750")
  .option("--channel <channel>", "安全渠道：stable 或 dev", process.env.GPT_IMAGE_STUDIO_COMPANION_CHANNEL)
  .option("--allow-origin <origin...>", "额外允许的完整 origin，例如 http://localhost:5173")
  .option("--session-ttl-days <days>", "配对 session 有效天数", "30")
  .action(async (opts) => {
    const { startServer } = await import("./server.js");
    await startServer({
      port: Number(opts.port),
      security: createSecurityConfig({
        channel: opts.channel,
        allowOrigins: opts.allowOrigin ?? [],
        sessionTtlDays: Number(opts.sessionTtlDays),
      }),
    });
  });

program
  .command("login")
  .description("配置 API 凭据")
  .action(async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, resolve));

    const apiBaseUrl = (await ask("API Base URL (默认 https://api.openai.com/v1/images): ")).trim()
      || "https://api.openai.com/v1/images";

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
        } else if (c === "" || c === "\b") {
          input = input.slice(0, -1);
        } else if (c === "") {
          process.exit(1);
        } else {
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

    saveCredentials(apiBaseUrl, apiKey.trim());
    console.log("");
    console.log("凭据已保存。");
    console.log(`  API Base URL: ${apiBaseUrl}`);
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
      console.log(`凭据:    已配置`);
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

    try {
      const res = await fetch("http://127.0.0.1:19750/health", { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log("服务:    运行中 (127.0.0.1:19750)");
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
