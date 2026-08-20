import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPANION_VERSION } from "./version.js";

describe("companion version", () => {
  it("reads the version from the package root package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(COMPANION_VERSION).toBe(pkg.version);
  });
});
