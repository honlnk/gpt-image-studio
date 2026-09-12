import { describe, expect, it } from "vitest";
import { checkDesktopUpdate, compareVersions } from "./desktopUpdate";

const RELEASES_WITH_DESKTOP_021 = [
  {
    tag_name: "desktop-v0.2.1",
    published_at: "2026-09-12T00:00:00Z",
    draft: false,
    assets: [
      {
        name: "GPT-Image-Studio_0.2.1_aarch64.dmg",
        browser_download_url: "https://example.com/dmg",
        size: 1,
      },
    ],
  },
  {
    tag_name: "desktop-v0.2.0",
    published_at: "2026-09-11T00:00:00Z",
    draft: false,
    assets: [],
  },
  { tag_name: "companion-v9.9.9", published_at: "2026-09-13T00:00:00Z", draft: false, assets: [] },
];

function okFetch(body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
}

function failingFetch(): typeof fetch {
  return (() => Promise.reject(new Error("network down"))) as typeof fetch;
}

describe("compareVersions", () => {
  it("compares numeric segments, not strings", () => {
    expect(compareVersions("0.2.10", "0.2.9")).toBe(1);
    expect(compareVersions("0.2.9", "0.2.10")).toBe(-1);
  });

  it("treats missing segments as 0 and ignores v prefix", () => {
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  it("orders major/minor/patch", () => {
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
    expect(compareVersions("0.3.0", "0.2.99")).toBe(1);
    expect(compareVersions("0.2.1", "0.2.1")).toBe(0);
  });
});

describe("checkDesktopUpdate", () => {
  it("reports update-available when the latest desktop release is newer", async () => {
    const result = await checkDesktopUpdate({
      currentVersion: "0.2.0",
      fetchImpl: okFetch(RELEASES_WITH_DESKTOP_021),
    });
    expect(result).toEqual({
      kind: "update-available",
      currentVersion: "0.2.0",
      latestVersion: "0.2.1",
      releaseUrl:
        "https://github.com/honlnk/gpt-image-studio/releases/tag/desktop-v0.2.1",
    });
  });

  it("reports up-to-date when current matches or exceeds the latest release", async () => {
    expect(
      await checkDesktopUpdate({
        currentVersion: "0.2.1",
        fetchImpl: okFetch(RELEASES_WITH_DESKTOP_021),
      }),
    ).toEqual({ kind: "up-to-date", currentVersion: "0.2.1", latestVersion: "0.2.1" });
    // 本地版本比线上新（开发中）也算 up-to-date，不提示「更新」
    expect(
      await checkDesktopUpdate({
        currentVersion: "0.3.0",
        fetchImpl: okFetch(RELEASES_WITH_DESKTOP_021),
      }),
    ).toEqual({ kind: "up-to-date", currentVersion: "0.3.0", latestVersion: "0.2.1" });
  });

  it("ignores non-desktop tags (companion-v*)", async () => {
    const result = await checkDesktopUpdate({
      currentVersion: "0.2.1",
      fetchImpl: okFetch([
        { tag_name: "companion-v9.9.9", published_at: "", draft: false, assets: [] },
      ]),
    });
    expect(result.kind).toBe("error");
  });

  it("returns error on network failure / non-200 / malformed payloads", async () => {
    expect(
      (await checkDesktopUpdate({ currentVersion: "0.2.0", fetchImpl: failingFetch() })).kind,
    ).toBe("error");
    const notOk = (() =>
      Promise.resolve(new Response("nope", { status: 403 }))) as typeof fetch;
    expect(
      (await checkDesktopUpdate({ currentVersion: "0.2.0", fetchImpl: notOk })).kind,
    ).toBe("error");
    expect(
      (
        await checkDesktopUpdate({
          currentVersion: "0.2.0",
          fetchImpl: okFetch({ not: "an array" }),
        })
      ).kind,
    ).toBe("error");
  });

  it("returns error when current version is unavailable", async () => {
    const result = await checkDesktopUpdate({
      currentVersion: null,
      fetchImpl: okFetch(RELEASES_WITH_DESKTOP_021),
    });
    expect(result.kind).toBe("error");
  });
});
