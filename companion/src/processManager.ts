import { spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const CONTROL_DIR = join(homedir(), ".gpt-image-studio");
const PID_FILE = join(CONTROL_DIR, "companion.pid");
const LOG_RETENTION_DAYS = 7;

export type ManagedProcessInfo = {
  pid: number;
  port: number;
  channel: string;
  logFile: string;
  startedAt: string;
  /** 监听地址（阶段三 PR1）。旧版记录无此字段，读取时为 undefined。 */
  host?: string;
  /** 部署形态 local/server（阶段三 PR1）。旧版记录无此字段，读取时为 undefined。 */
  deploymentMode?: string;
  /** 业务数据和日志目录。旧版记录无此字段，读取时为 undefined。 */
  dataDir?: string;
};

export type StartManagedProcessInput = {
  port: number;
  channel: string;
  allowOrigins: string[];
  /** 监听地址（阶段三 PR1）。 */
  host?: string;
  /** 部署形态 local/server（阶段三 PR1）。 */
  deploymentMode?: string;
  /** 业务数据和日志根目录。 */
  dataDir: string;
};

export function getPidFilePath(): string {
  return PID_FILE;
}

export function getLogsDir(dataDir = getCurrentDataDir()): string {
  return join(dataDir, "logs");
}

export function getLogFilePath(date = new Date(), dataDir = getCurrentDataDir()): string {
  const yyyyMmDd = formatLocalDate(date);
  return join(getLogsDir(dataDir), `companion-${yyyyMmDd}.log`);
}

export function readManagedProcessInfo(): ManagedProcessInfo | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const info = JSON.parse(readFileSync(PID_FILE, "utf-8")) as ManagedProcessInfo;
    if (!info.pid || !info.logFile) return null;
    return info;
  } catch {
    return null;
  }
}

export function writeManagedProcessInfo(info: ManagedProcessInfo): void {
  ensureControlDir();
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2), { mode: 0o600 });
}

export function clearManagedProcessInfo(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}
}

export function ensureRuntimeDirs(dataDir = getCurrentDataDir()): void {
  ensureControlDir();
  const logsDir = getLogsDir(dataDir);
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true, mode: 0o700 });
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function cleanupOldLogs(now = new Date(), logsDir = getLogsDir()): string[] {
  const cutoffMs = now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  if (!existsSync(logsDir)) return removed;

  for (const fileName of readdirSync(logsDir)) {
    const match = /^companion-(\d{4}-\d{2}-\d{2})\.log$/.exec(fileName);
    if (!match) continue;
    const filePath = join(logsDir, fileName);
    try {
      const logDateMs = new Date(`${match[1]}T00:00:00.000Z`).getTime();
      if (logDateMs < cutoffMs) {
        unlinkSync(filePath);
        removed.push(filePath);
      }
    } catch {}
  }

  return removed;
}

export function buildManagedProcessEnv(dataDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GPT_IMAGE_STUDIO_CONFIG_DIR: dataDir,
  };
}

export function readLastLines(filePath: string, lineCount: number): string[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  if (!content) return [];
  return content.trimEnd().split(/\r?\n/).slice(-Math.max(1, lineCount));
}

export function appendLogLine(filePath: string, message: string): void {
  appendFileSync(filePath, `${message}\n`);
}

export function readLogChunkSince(filePath: string, byteOffset: number): string {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath).subarray(byteOffset).toString("utf-8");
}

export function startManagedProcess(input: StartManagedProcessInput): ManagedProcessInfo {
  ensureRuntimeDirs(input.dataDir);
  cleanupOldLogs(new Date(), getLogsDir(input.dataDir));

  const existing = readManagedProcessInfo();
  if (existing && isProcessRunning(existing.pid)) {
    throw new Error(`Companion 已在后台运行，PID: ${existing.pid}`);
  }
  if (existing) clearManagedProcessInfo();

  const logFile = getLogFilePath(new Date(), input.dataDir);
  const out = openSync(logFile, "a");
  const err = openSync(logFile, "a");
  const args = [
    ...process.execArgv,
    process.argv[1],
    "serve",
    "--port",
    String(input.port),
    "--channel",
    input.channel,
    "--managed",
  ];

  if (input.host) {
    args.push("--host", input.host);
  }
  if (input.deploymentMode) {
    args.push("--deployment-mode", input.deploymentMode);
  }

  input.allowOrigins.forEach((origin) => {
    args.push("--allow-origin", origin);
  });

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", out, err],
    env: buildManagedProcessEnv(input.dataDir),
  });
  child.unref();
  closeSync(out);
  closeSync(err);

  const info: ManagedProcessInfo = {
    pid: child.pid!,
    port: input.port,
    channel: input.channel,
    logFile,
    startedAt: new Date().toISOString(),
    host: input.host,
    deploymentMode: input.deploymentMode,
    dataDir: input.dataDir,
  };
  writeManagedProcessInfo(info);
  appendLogLine(logFile, `[manager] started ${basename(process.argv[1])} PID ${info.pid}`);
  return info;
}

export function stopManagedProcess(): { stopped: boolean; info: ManagedProcessInfo | null; stale: boolean } {
  const info = readManagedProcessInfo();
  if (!info) return { stopped: false, info: null, stale: false };
  if (!isProcessRunning(info.pid)) {
    clearManagedProcessInfo();
    return { stopped: false, info, stale: true };
  }

  process.kill(info.pid, "SIGTERM");
  clearManagedProcessInfo();
  return { stopped: true, info, stale: false };
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ensureControlDir(): void {
  if (!existsSync(CONTROL_DIR)) {
    mkdirSync(CONTROL_DIR, { recursive: true, mode: 0o700 });
  }
}

function getCurrentDataDir(): string {
  return process.env.GPT_IMAGE_STUDIO_CONFIG_DIR ?? CONTROL_DIR;
}
