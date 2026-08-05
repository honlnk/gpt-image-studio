import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManagedProcessEnv,
  cleanupOldLogs,
  getLogFilePath,
  readLastLines,
  readLogChunkSince,
} from "./processManager.js";

describe("process manager helpers", () => {
  it("uses dated companion log file names", () => {
    const path = getLogFilePath(new Date(2026, 4, 25, 12, 0, 0));

    expect(path).toContain("companion-2026-05-25.log");
  });

  it("reads the requested number of trailing lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "companion-log-"));
    const file = join(dir, "test.log");
    writeFileSync(file, "one\ntwo\nthree\n");

    expect(readLastLines(file, 2)).toEqual(["two", "three"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads chunks by byte offset when logs contain multibyte characters", () => {
    const dir = mkdtempSync(join(tmpdir(), "companion-log-"));
    const file = join(dir, "test.log");
    writeFileSync(file, "等待网页端发起配对...\n");
    const offset = statSync(file).size;
    writeFileSync(file, "│  配对码: 123456                  │\n", { flag: "a" });

    expect(readLogChunkSince(file, offset)).toContain("配对码: 123456");
    rmSync(dir, { recursive: true, force: true });
  });

  it("removes old dated logs from the provided directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "companion-logs-"));
    const oldLog = join(dir, "companion-2026-05-01.log");
    const freshLog = join(dir, "companion-2026-05-25.log");
    writeFileSync(oldLog, "old\n");
    writeFileSync(freshLog, "fresh\n");

    const removed = cleanupOldLogs(new Date("2026-05-25T12:00:00.000Z"), dir);

    expect(removed).toEqual([oldLog]);
    expect(readLastLines(freshLog, 1)).toEqual(["fresh"]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("process manager dataDir isolation", () => {
  it("日志路径跟随传入的 dataDir", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "companion-server-"));
    const path = getLogFilePath(new Date(2026, 4, 25, 12, 0, 0), dataDir);

    expect(path).toBe(join(dataDir, "logs", "companion-2026-05-25.log"));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("子进程环境显式注入 dataDir", () => {
    const env = buildManagedProcessEnv("/opt/server-data");

    expect(env.GPT_IMAGE_STUDIO_CONFIG_DIR).toBe("/opt/server-data");
  });

  it("子进程环境保留父进程既有变量", () => {
    process.env.PLACEHOLDER_MARKER = "keep-me";
    const env = buildManagedProcessEnv("/opt/server-data");

    expect(env.PLACEHOLDER_MARKER).toBe("keep-me");
    delete process.env.PLACEHOLDER_MARKER;
  });
});
