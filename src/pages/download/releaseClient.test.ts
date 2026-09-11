import { describe, expect, it } from "vitest";
import { FALLBACK_RELEASE } from "../../shared/downloads";
import {
  classifyAssets,
  detectPlatform,
  formatAssetSize,
  pickLatestDesktopRelease,
} from "./releaseClient";

describe("classifyAssets", () => {
  it("matches CI hyphenated names (desktop-ci-cd-plan §六 contract)", () => {
    const assets = classifyAssets([
      { name: "GPT-Image-Studio_0.2.0_aarch64.dmg", url: "u1", sizeBytes: 1 },
      { name: "GPT-Image-Studio_0.2.0_x64-setup.exe", url: "u2", sizeBytes: 2 },
      { name: "GPT-Image-Studio_0.2.0_amd64.AppImage", url: "u3", sizeBytes: 3 },
      { name: "GPT-Image-Studio_0.2.0_amd64.deb", url: "u4", sizeBytes: 4 },
    ]);
    expect(assets.macArm64?.url).toBe("u1");
    expect(assets.windowsX64?.url).toBe("u2");
    expect(assets.linuxAppImage?.url).toBe("u3");
    expect(assets.linuxDeb?.url).toBe("u4");
  });

  it("matches historical naming styles (dots / spaces from manual uploads)", () => {
    // GitHub 网页上传会把空格改写成点；Tauri 原始输出带空格
    const dotted = classifyAssets([
      { name: "GPT.Image.Studio_0.1.0_aarch64.dmg", url: "u1", sizeBytes: 1 },
    ]);
    expect(dotted.macArm64?.name).toBe("GPT.Image.Studio_0.1.0_aarch64.dmg");
    const spaced = classifyAssets([
      { name: "GPT Image Studio_0.1.0_aarch64.dmg", url: "u2", sizeBytes: 1 },
    ]);
    expect(spaced.macArm64?.url).toBe("u2");
  });

  it("returns empty slots for platforms without assets", () => {
    const assets = classifyAssets([
      { name: "GPT-Image-Studio_0.1.0_aarch64.dmg", url: "u1", sizeBytes: 1 },
    ]);
    expect(assets.macArm64).toBeDefined();
    expect(assets.windowsX64).toBeUndefined();
    expect(assets.linuxAppImage).toBeUndefined();
    expect(assets.linuxDeb).toBeUndefined();
  });

  it("ignores unrelated assets (signatures, source archives, updater json)", () => {
    const assets = classifyAssets([
      { name: "GPT-Image-Studio_0.2.0_aarch64.dmg.sig", url: "s", sizeBytes: 1 },
      { name: "latest.json", url: "j", sizeBytes: 1 },
      { name: "GPT-Image-Studio_0.2.0_aarch64.dmg", url: "u", sizeBytes: 1 },
    ]);
    expect(assets.macArm64?.url).toBe("u");
    expect(Object.keys(assets)).toHaveLength(1);
  });

  it("keeps the first asset when duplicates match one platform", () => {
    const assets = classifyAssets([
      { name: "a_aarch64.dmg", url: "first", sizeBytes: 1 },
      { name: "b_aarch64.dmg", url: "second", sizeBytes: 2 },
    ]);
    expect(assets.macArm64?.url).toBe("first");
  });
});

describe("pickLatestDesktopRelease", () => {
  const ghAsset = (name: string) => ({
    name,
    browser_download_url: `https://example.com/${name}`,
    size: 100,
  });

  it("picks the first desktop-v* release from the newest-first list", () => {
    const release = pickLatestDesktopRelease([
      { tag_name: "companion-v1.2.0", published_at: "2026-09-01", assets: [] },
      {
        tag_name: "desktop-v0.2.0",
        published_at: "2026-09-10",
        assets: [ghAsset("GPT-Image-Studio_0.2.0_aarch64.dmg")],
      },
      { tag_name: "desktop-v0.1.0", published_at: "2026-06-19", assets: [] },
    ]);
    expect(release?.version).toBe("0.2.0");
    expect(release?.tag).toBe("desktop-v0.2.0");
    expect(release?.assets.macArm64?.sizeBytes).toBe(100);
  });

  it("skips draft releases", () => {
    const release = pickLatestDesktopRelease([
      { tag_name: "desktop-v0.3.0", draft: true, assets: [] },
      { tag_name: "desktop-v0.2.0", published_at: "2026-09-10", assets: [] },
    ]);
    expect(release?.version).toBe("0.2.0");
  });

  it("returns null when no desktop release exists", () => {
    expect(
      pickLatestDesktopRelease([{ tag_name: "companion-v1.1.0", assets: [] }]),
    ).toBeNull();
    expect(pickLatestDesktopRelease([])).toBeNull();
  });

  it("tolerates malformed asset entries", () => {
    const release = pickLatestDesktopRelease([
      {
        tag_name: "desktop-v0.2.0",
        published_at: "2026-09-10",
        assets: [null, 42, { name: 1 }, ghAsset("GPT-Image-Studio_0.2.0_x64-setup.exe")],
      },
    ]);
    expect(release?.assets.windowsX64?.name).toBe("GPT-Image-Studio_0.2.0_x64-setup.exe");
    expect(release?.assets.macArm64).toBeUndefined();
  });
});

describe("detectPlatform", () => {
  it("detects windows / mac / linux from UA", () => {
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe("unknown");
  });
});

describe("formatAssetSize", () => {
  it("formats bytes as 约 x.x MB", () => {
    expect(formatAssetSize(1972875)).toBe("约 1.9 MB");
  });

  it("returns empty string for zero/invalid sizes", () => {
    expect(formatAssetSize(0)).toBe("");
    expect(formatAssetSize(Number.NaN)).toBe("");
  });
});

describe("FALLBACK_RELEASE 自洽性", () => {
  // 手动更新兜底版本时 URL/tag/name/version 容易改漏（曾出现 tag 已升 0.2.1
  // 而 URL 文件名还是 0.2.0 的 404 状态），这里把一致性钉死。
  it("asset URLs match tag, name and version", () => {
    for (const asset of Object.values(FALLBACK_RELEASE.assets)) {
      expect(asset).toBeDefined();
      expect(asset!.url).toContain(`/download/${FALLBACK_RELEASE.tag}/`);
      expect(asset!.url.endsWith(`/${asset!.name}`)).toBe(true);
      expect(asset!.name).toContain(`_${FALLBACK_RELEASE.version}_`);
      expect(asset!.sizeBytes).toBeGreaterThan(0);
    }
  });
});
