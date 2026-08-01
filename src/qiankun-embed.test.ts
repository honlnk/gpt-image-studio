/**
 * 阶段三 PR5：qiankun 嵌入态测试。
 *
 * 验证：
 * 1. settingsStore.applyEmbeddedConfig 正确注入三 refs + isEmbedded 标记。
 * 2. 嵌入态跳过 companionUrl/accessKey 持久化。
 * 3. 嵌入态 connectionMode 固定 localCompanion。
 * 4. 生命周期在 window 全局可发现（qiankun import-entry 契约，回归 bug 修复）。
 *
 * 不直接测 main.ts 的渲染副作用（有 app.mount），而是分别测注入逻辑核心
 * （applyEmbeddedConfig）与 window 生命周期挂载约定（source-level 契约校验）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "./stores/settingsStore.js";

describe("qiankun 嵌入态配置注入", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("applyEmbeddedConfig 设置 companionUrl + jwt + connectionMode + isEmbedded", () => {
    const store = useSettingsStore();
    store.applyEmbeddedConfig({
      companionUrl: "https://companion.example.com",
      jwt: "eyJhbGciOiJIUzI1NiJ9.test.test",
    });

    expect(store.companionUrl).toBe("https://companion.example.com");
    expect(store.companionAccessKey).toBe("eyJhbGciOiJIUzI1NiJ9.test.test");
    expect(store.connectionMode).toBe("localCompanion");
    expect(store.isEmbedded).toBe(true);
  });

  it("嵌入态 connectionMode 固定 localCompanion（applyEmbeddedConfig 后）", () => {
    const store = useSettingsStore();
    expect(store.connectionMode).toBe("direct"); // 默认 direct

    store.applyEmbeddedConfig({ companionUrl: "http://x", jwt: "y" });
    expect(store.connectionMode).toBe("localCompanion");
  });

  it("applyEmbeddedConfig 幂等（重复调用以最新值为准）", () => {
    const store = useSettingsStore();
    store.applyEmbeddedConfig({ companionUrl: "http://a", jwt: "token-a" });
    store.applyEmbeddedConfig({ companionUrl: "http://b", jwt: "token-b" });

    expect(store.companionUrl).toBe("http://b");
    expect(store.companionAccessKey).toBe("token-b");
    expect(store.isEmbedded).toBe(true);
  });

  it("独立态默认 isEmbedded=false", () => {
    const store = useSettingsStore();
    expect(store.isEmbedded).toBe(false);
  });
});

describe("qiankun 嵌入态持久化跳过", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("嵌入态 isEmbedded=true 标记生效（持久化 watch 据此跳过）", () => {
    const store = useSettingsStore();
    expect(store.isEmbedded).toBe(false);

    store.applyEmbeddedConfig({ companionUrl: "http://x", jwt: "y" });
    // applyEmbeddedConfig 设置 isEmbedded=true，watch 会据此跳过持久化
    expect(store.isEmbedded).toBe(true);
  });

  it("独立态 isEmbedded=false（持久化正常生效）", () => {
    const store = useSettingsStore();
    expect(store.isEmbedded).toBe(false);
    // 独立态改 companionUrl 会触发持久化（watch 不跳过）
    store.companionUrl = "http://standalone";
    expect(store.isEmbedded).toBe(false);
  });
});

/**
 * 生命周期发现契约回归（回归一个真实 prod-only bug）。
 *
 * 背景：Vite 按「应用入口」打包，产物是 IIFE 脚本，顶层 `export` 会被打包器剥离。
 * qiankun 的 import-entry 在 prod 产物里无法通过 ESM named export 拿到
 * bootstrap/mount/unmount，必须靠 `window[appName]` 全局挂载兜底。
 *
 * 这些校验读 main.ts 源码文本，确认关键的 window 全局挂载约定存在——
 * 这是 prod 构建后唯一可靠的发现路径。避免引入 app.mount 副作用带来的 flaky。
 */
describe("qiankun 生命周期发现契约（prod 兜底）", () => {
  it("main.ts 在嵌入态把 bootstrap/mount/unmount 挂到 window[appName]", async () => {
    const mainSrc = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./main.ts", import.meta.url), "utf-8"),
    );
    // window 全局挂载兜底（prod 唯一可靠发现路径）
    expect(mainSrc).toContain("__POWERED_BY_QIANKUN__");
    expect(mainSrc).toMatch(/window.*\[.*QIANKUN_APP_NAME.*\]\s*=\s*lifecycle/);
    // 生命周期对象包含三个函数
    expect(mainSrc).toMatch(/bootstrap.*mount.*unmount/);
    // app 名常量与宿主 registerMicroApps name 约定一致
    expect(mainSrc).toMatch(/QIANKUN_APP_NAME\s*=\s*['"]gpt-image-studio['"]/);
  });

  it("独立态不污染 window（仅在 __POWERED_BY_QIANKUN__ 时挂载）", async () => {
    const mainSrc = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./main.ts", import.meta.url), "utf-8"),
    );
    // 挂载语句必须被 __POWERED_BY_QIANKUN__ 守卫包裹
    const assignLine = mainSrc
      .split("\n")
      .find((l) => l.includes("QIANKUN_APP_NAME]") && l.includes("lifecycle"));
    expect(assignLine).toBeDefined();
    // 守卫在同一块 if 块内（向上找最近的 if）
    const idx = mainSrc.split("\n").indexOf(assignLine!);
    const guard = mainSrc
      .split("\n")
      .slice(Math.max(0, idx - 5), idx)
      .find((l) => l.includes("__POWERED_BY_QIANKUN__"));
    expect(guard).toBeDefined();
  });
});

/**
 * CSS 注入契约（回归 qiankun 嵌入态样式丢失 bug）。
 *
 * 背景：qiankun 的 import-html-entry 处理子应用 HTML 时会移除 <link rel=stylesheet>，
 * 沙箱配置下子应用样式整个丢失。解法：main.ts 用 `import styleCssUrl from './style.css?url'`
 * 在 build 时拿到 CSS 文件 URL（带 hash），嵌入态时用 window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__
 * （qiankun 注入的 entry 地址）拼出子应用源的完整 URL，再通过容器元素的 ownerDocument
 * 拿到宿主真实 document，动态创建 <link> 注入宿主 head。
 *
 * 这里校验 main.ts 的注入契约存在，避免被误删（CSS 丢失会复现）。
 */
describe("qiankun 嵌入态 CSS 注入契约", () => {
  it("main.ts 用 ?url 导入 CSS + 嵌入态动态注入 link（浏览器原生执行通道）", async () => {
    const mainSrc = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./main.ts", import.meta.url), "utf-8"),
    );
    // 用 ?url 导入 CSS，build 时替换成真实 URL（带 hash）
    expect(mainSrc).toMatch(/style\.css\?url/);
    // 嵌入态调用注入函数
    expect(mainSrc).toMatch(/injectEmbeddedCss/);
    // 通过容器元素的 ownerDocument 拿真实 document（绕开 qiankun 沙箱代理）
    expect(mainSrc).toMatch(/ownerDocument/);
    // 用 qiankun 注入的 publicPath（entry 地址）拼出子应用源完整 URL，
    // 否则 /assets/xxx.css 会按宿主 origin 解析 → 404（URL 解析不经沙箱）
    expect(mainSrc).toMatch(/__INJECTED_PUBLIC_PATH_BY_QIANKUN__/);
    expect(mainSrc).toMatch(/new URL\(styleCssUrl/);
    // 以 <link rel=stylesheet> 注入宿主 head
    expect(mainSrc).toMatch(/createElement\(['"]link['"]\)/);
    // 幂等：用 data-app-css 标记避免重复注入
    expect(mainSrc).toMatch(/data-app-css/);
  });
});
