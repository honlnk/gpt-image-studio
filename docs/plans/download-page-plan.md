# 下载页面（image.honlnk.com/download）实施计划

> 状态：**已完成（2026-09-11）**。实施与本文档一致，两处偏差记录：
> ① vite-ssg 28 的默认 `dirStyle` 是 flat（`dist/download.html`），实际改用 `nested`
> 产出 `dist/download/index.html`，/download 与 /download/ 都能被 GitHub Pages 直接服务；
> ② 复制命令按钮在部分 webview 里 `navigator.clipboard` 不可用，补了
> textarea + execCommand 降级链路（成功才显示「已复制」）。
> 衔接文档：[desktop-distribution-plan.md](./desktop-distribution-plan.md)（免签名分发总方案）。本计划对应其 §3.2「浏览器直接下载的文档缓解」的产品化落地，并为其 §4.2 安装脚本预留页面位置。
> 参考页面：https://mdopener.honlnk.com/ （同作者项目的单页下载站，本页在其骨架上扩展）。

## 一、目标

- 新增下载页 `/download`（vite-ssg 预渲染 + 独立 SEO），顶栏「桌面版」按钮由直链 dmg 改为跳转该页；
- 页面结构参考 mdopener 但更复杂：多平台安装包卡片、macOS 特殊教学（Gatekeeper 放行）、动态「最新版本」解析；
- 平台按钮点击 = **直接下载最新安装包**（不跳 GitHub 页面）；另有独立按钮链到 GitHub Releases 列表页，供下载任意历史版本。

## 二、现状关键事实（调研结论）

- **构建**：`pnpm build` = `vite-ssg build`，无路由单页。`ssgOptions.includedRoutes` 返回 `['/', '/download']` 即可实现无路由多页预渲染（已核对 vite-ssg 28.x 内部行为）；产物 `dist/download/index.html` 会被 GitHub Pages 直接服务在 `/download`（deploy.yml 是纯静态部署 `./dist`）。
- **模板**：`index.html` 是所有路由共用模板（含内联 splash 和首页 SEO meta）→ 用 `ssgOptions.onBeforePageRender` 对 `/download` 改写 title/description/canonical/OG/JSON-LD，并剔除 `#app-splash` 标记。
- **客户端分流**：`main.ts` 会在任何加载主 bundle 的页面上挂载工作室 App → 需按 `location.pathname` 分流；下载页用动态 import 代码分割，不拖入工作室代码与 Pinia hydration（hydration 本就全局禁用，预渲染内容仅供 SEO/首屏）。
- **现有 Release**：仅 `desktop-v0.1.0`（2026-06 手动发布的 Pre-release，**早于 sidecar 内嵌，是旧壳**）；CI 自动构建（分发方案 §4.1）未做，资产命名未统一（现存三种风格：`GPT.Image.Studio_*`（点）/ 方案目标的 `GPT-Image-Studio_*`（连字符）/ Tauri 原始 `GPT Image Studio_*`（空格））→ 页面用 **GitHub Releases API 运行时解析 + 资产名模式匹配**（`.dmg`+`aarch64` / `setup.exe` / `.AppImage` / `.deb`），对命名漂移免疫；CI 落地后 Windows/Linux 按钮自动点亮。
- **杂项**：`DESKTOP_APP_RELEASE_URL` 常量目前无人使用（死代码）；顶栏下载按钮在 Tauri 桌面端内无 `v-if` 门控；`isTauriRuntime()` 已存在于 `src/services/storage/resolveStorage.ts`；sitemap 是手维护静态文件；IndexNow URL 列表硬编码在 `deploy.yml`。

## 三、实施步骤

### 1. 多路由预渲染骨架

- `vite.config.ts`：`ssgOptions.includedRoutes: () => ['/', '/download']`；新增 `onBeforePageRender` 钩子，对 `/download` 做模板改写（替换 title/description/canonical/og:url/og:title/og:description，注入下载页 JSON-LD，剔除 `#app-splash` 标记）。
- `src/entry-ssg.ts`：`createApp(route)` 按路由渲染——`'/'` → 现有 App（含 pinia/track），`'/download'` → 纯静态 DownloadPage（不挂 pinia，避免 IndexedDB hydration）。
- `src/main.ts`：开头按 `location.pathname === '/download'` 分流，动态 `import('./pages/download/DownloadPage.vue')` 挂载（复用现有 mount/splash 退场逻辑的守卫——splash 已被模板剔除，确认空值安全）；首页路径逻辑完全不变。

### 2. 版本解析层 `src/pages/download/releaseClient.ts`（纯函数，可测）

- `fetchLatestDesktopRelease()`：`GET https://api.github.com/repos/honlnk/gpt-image-studio/releases`（list 含 prerelease），取最新 `desktop-v*` tag；失败/超时回落到 `src/shared/downloads.ts` 里的 `FALLBACK_RELEASE` 常量（当前 v0.1.0 资产）。
- `classifyAssets(assets)`：按名称模式分类 → `{ macArm64?, windowsX64?, linuxAppImage?, linuxDeb? }`，每项含直链 URL + 文件大小（API 自带 size，页面展示「约 x MB」）。
- `detectPlatform()`：`navigator.userAgent` 判定 mac/windows/linux + Apple Silicon 提示，用于 hero 区「检测到您的系统，推荐下载」。
- SSG 预渲染时用 FALLBACK_RELEASE 渲染（构建期不发网络请求），保证无 JS 的爬虫也能看到有效下载链接。
- 测试 `releaseClient.test.ts`：三种命名风格（点/连字符/空格）都能匹配、无对应资产时返回空、tag 版本号解析、平台判定。

### 3. 下载页 UI `src/pages/download/DownloadPage.vue`（+ 同目录小组件，Tailwind，中文）

结构（mdopener 骨架的加强版）：

1. **Hero**：产品名 + 标语；版本徽章（API 解析出的版本号 + 发布日期）；平台检测推荐主按钮（直链下载）+ 次按钮「全部版本（GitHub Releases）」；信任行（开源 MIT · 本地优先 · 免签名说明）。
2. **平台卡片区**：macOS（Apple Silicon）/ Windows / Linux 三卡，可用性由 `classifyAssets` 结果驱动——当前仅 macOS 可点，Win/Linux 显示「敬请期待」（CI §4.1 后自动点亮）；mac 卡下挂「macOS 安装说明」锚点链接。
3. **macOS 安装教学区**（重点）：分步图文——① 打开 dmg 拖入「应用程序」② 首次打开被拦截时：系统设置 → 隐私与安全性 →「仍要打开」（macOS 15 起右键打开已移除）③ 或终端执行 `xattr -cr /Applications/GPT\ Image\ Studio.app`（一键复制按钮）④ 简短解释「为什么有警告：未购买 Apple 签名，开源软件正常现象」；预留安装脚本（curl|sh）区块的位置，§4.2 完成后补。
4. **为什么用桌面版**：vs 网页版对比点（内置 Companion 开箱即连无需配对、不受浏览器 CORS 限制、本地服务自动管理）。
5. **FAQ**（对应 JSON-LD FAQPage）：安全警告怎么回事 / 收费吗 / 和网页版数据互通吗（不互通，独立分区）/ Windows、Linux 什么时候有。
6. **页脚**：GitHub 仓库、全部版本、返回网页版。

页面不进工作室的 analytics（不初始化 analyticsStore/IndexedDB）。

### 4. SEO

- 路由级 meta（经 `onBeforePageRender`）：title「下载 GPT Image Studio 桌面版 — macOS / Windows / Linux」、description、canonical `https://image.honlnk.com/download`、og:url/og:title/og:description（OG 图复用现有 `og-image.png`）。
- JSON-LD：`SoftwareApplication`（operatingSystem、offers price=0、downloadUrl）+ `FAQPage`（与页面 FAQ 内容一致）。
- `public/sitemap.xml`：手加 `/download` 条目（含 lastmod）。
- `.github/workflows/deploy.yml`：IndexNow `urlList` 增加 `https://image.honlnk.com/download`。

### 5. 顶栏按钮与常量重构

- `src/shared/downloads.ts`：移除硬编码 dmg 直链常量；新增 `DOWNLOAD_PAGE_URL = '/download'`、`GITHUB_RELEASES_URL = 'https://github.com/honlnk/gpt-image-studio/releases'`、`FALLBACK_RELEASE`（版本/资产映射，发新 desktop 版时手动更新；API 主解析、它只做兜底）。
- `ChatWorkspace.vue`：按钮 href → `/download`（`target="_blank" rel="noopener"`，避免丢工作室状态），title 改为「下载桌面版」；`v-if="!isTauriRuntime()"`（桌面 app 内不再显示下载入口）。

### 6. 验证

- `pnpm typecheck`、`pnpm test`（含新增单测）。
- `pnpm build`：断言 `dist/download/index.html` 存在、含下载页 title/canonical/JSON-LD、不含 splash；`pnpm preview` 手动过一遍 `/download`（按钮链接、复制按钮、无 JS 时内容仍在）。
- 不跑 `pnpm build:desktop`（Rust 构建慢），但确认 dist/ 多出 download/index.html 对 Tauri 打包无害（仅体积微增）。

### 7. 文档同步

- `docs/guides/seo-strategy.md`：补 /download 的 P1 记录。
- `AGENTS.md`：一句架构说明（无路由多页预渲染模式 + main.ts 分流）。
- `README.md`「方式四：桌面端」链接改为下载页（小改）。

## 四、明确不在本次范围（后续阶段）

- curl|sh 安装脚本区块（依赖分发方案 §4.2）、Windows/Linux 实际可下载（依赖 §4.1 CI）。
- 应用内「检查更新」（§4.5）、Tauri updater、签名/SignPath。
- 下载点击埋点（页面刻意不进 analytics 体系）。

## 五、连带事项（非代码改动）

页面通过 API 永远解析「最新 desktop release」，而目前线上唯一的 `desktop-v0.1.0` 是 **sidecar 之前的旧壳**。建议本页合并到 main 之前，先用当前代码手动构建发布一个 `desktop-v0.2.0`（含内嵌 Companion），否则下载页会把流量引向旧包。此步为手动发布操作，不包含在本计划的代码改动里。
