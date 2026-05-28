import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "companion-pairing-"));
  vi.stubEnv("GPT_IMAGE_STUDIO_CONFIG_DIR", configDir);
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(configDir, { recursive: true, force: true });
});

describe("pairing state", () => {
  it("requires explicit pairing mode by default", async () => {
    const { startPairing } = await import("./pairingState.js");

    expect(startPairing()).toBeNull();
  });

  it("allows direct pairing for foreground serve mode", async () => {
    const { startPairing } = await import("./pairingState.js");

    expect(startPairing({ requirePairingMode: false })).toEqual({
      expiresInSeconds: 300,
    });
  });

  it("allows pairing after the CLI opens the wait window", async () => {
    const { enterPairingMode, startPairing } = await import("./pairingState.js");

    enterPairingMode(60_000);

    expect(startPairing()).toEqual({
      expiresInSeconds: 300,
    });
  });
});
