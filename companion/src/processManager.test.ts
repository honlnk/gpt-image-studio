import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupOldLogs, getLogFilePath, readLastLines } from "./processManager.js";

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
