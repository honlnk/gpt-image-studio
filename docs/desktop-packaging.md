# 桌面端打包方案

更新日期：2026-06-19

## 方向

GPT Image Studio 的第一版桌面端基于 **Tauri v2**，把现有 Web App（Vue 3 + Vite 构建产物）原样嵌入系统 webview。

第一版只打包 Web App 本身，**Companion 保持外部独立**：桌面端仍然通过 `127.0.0.1` 连接用户手动安装并启动的本地 Companion，体验与浏览器端完全一致。内嵌 Companion 为 sidecar 的方案明确后置（见文末「不在第一版范围」）。

## 选型理由

| 方案 | 结论 |
|------|------|
| Tauri v2 | 选中。系统 webview，体积小（约 3-10MB 壳），macOS 最成熟，直接消费现有 `dist/`，无需改动 Vue 代码 |
| Electron | 不选。第一版不内嵌 Companion，Electron 的 150-300MB 体积劣势无意义 |
| PWA | 不选。无法管理 Companion 进程；HTTPS 页面调用 `http://127.0.0.1` 会触发混合内容阻塞 |

可行性已验证：

- 现有 `dist/` 是 `base: './'` 相对路径、单 JS chunk + 单 CSS，Tauri 可直接嵌入。
- IndexedDB、`URL.createObjectURL`、`navigator.clipboard`、SSE streaming 在 macOS WKWebView 下都能正常工作。
- `urlSettings.ts` 在桌面环境下 `window.location.search` 为空，自动走无参数分支，无需改动。
- Companion 连接（`fetch("http://127.0.0.1:19750")`）正常，只需在 CSP 放行 loopback。

## 目录结构

```
gpt-image-studio/
├── src/                          # Web App 源码（不变）
├── companion/                    # 本地 CLI Companion（不变）
├── dist/                         # Vite 构建产物（桌面端和 Web 共用）
└── desktop/
    └── src-tauri/
        ├── Cargo.toml            # Rust 依赖
        ├── build.rs              # tauri-build 入口
        ├── tauri.conf.json       # Tauri 配置（frontendDist 指回 ../../dist）
        ├── capabilities/
        │   └── default.json      # 最小权限声明
        ├── icons/                # 应用图标（多尺寸 + icns/ico）
        └── src/
            ├── main.rs           # 二进制入口
            └── lib.rs            # 应用装配（仅启动 webview）
```

桌面端与 Web App、Companion 三权分立，`desktop/` 不污染根目录，也不修改 `src/` 下任何文件。

## 前置依赖

桌面端构建需要 Rust toolchain（一次性安装）：

```bash
# macOS
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version    # 需要 >= 1.77.2

# 还需要 Xcode Command Line Tools（用于系统 webview 链接）
xcode-select --install
```

Node 端依赖（`@tauri-apps/cli`）已在项目 `devDependencies` 中：

```bash
pnpm install
```

## 开发与构建命令

```bash
pnpm dev:desktop     # 开发模式：启动 Vite dev server + 热重载 webview
pnpm build:desktop   # 生产构建：先 vite build，再 cargo build --release，产出 .app / .dmg
```

产物位置（macOS）：

```
desktop/src-tauri/target/release/bundle/
├── macos/
│   └── GPT Image Studio.app
└── dmg/
    └── GPT Image Studio_0.1.0_aarch64.dmg
```

## 关键配置说明

### frontendDist

`tauri.conf.json` 中 `build.frontendDist` 设置为 `../../dist`（相对于 `desktop/src-tauri/`），指向项目根的 Vite 构建产物。桌面端和 Web 端共享同一份构建产物，不重复构建。

### CSP

Tauri 的默认 CSP 比 GitHub Pages 严格。`tauri.conf.json` 的 `app.security.csp` 显式放行了：

- `connect-src http://127.0.0.1:* http://localhost:*` — Companion loopback 通信
- `connect-src https:` — 浏览器直连模式调用图片 API
- `img-src data: blob:` — base64 图片预览和 `URL.createObjectURL`
- `style-src 'unsafe-inline'` — Tailwind 注入的样式
- `script-src 'unsafe-inline'` — Vite 内联入口

如果未来 CSP 导致某个功能被拦（表现为 webview 控制台的 CSP 违规报错），优先在这里放行对应来源。

### 权限最小化

`capabilities/default.json` 只授予 `core:default`（核心 window 权限），不开放 shell / filesystem / http 插件。Companion 走 webview 原生 `fetch`，不需要 Tauri 的 http 插件。

### Vite 配置

`vite.config.ts` 新增两项，专供 Tauri dev 模式：

- `clearScreen: false` — 避免 Vite 清屏抹掉 Tauri 的 Rust 日志
- `server.strictPort: true` — 固定 8888 端口，避免端口漂移导致 webview 加载空白页

## 图标

第一版图标从 `public/favicon.svg` 生成（带深色圆角背景的画布 + spark 图标）。源 PNG 是 `desktop/src-tauri/app-icon.png`（1024×1024，gitignored）。

重新生成所有尺寸：

```bash
pnpm tauri icon desktop/src-tauri/app-icon.png -o desktop/src-tauri/icons
```

正式发布前应替换为品牌方提供的 1024×1024 PNG 源图，再跑一次上面的命令。

## 与 Companion 的关系

桌面端**不内嵌** Companion。使用 Companion 模式时：

1. 用户照常 `npm install -g @honlnk/image-studio-companion` 安装并 `gpt-image-studio start` 启动。
2. 桌面端在设置页切换到「本地 Companion」，检测 `127.0.0.1:19750` 健康状态。
3. 配对流程（6 位配对码）与浏览器端完全一致。

桌面端的 IndexedDB 数据与浏览器端隔离（不同 webview 实例，不同 origin 数据分区），互不影响。

## 验收标准

- `pnpm dev:desktop` 能在 macOS 上打开桌面窗口，Web App 功能完整可用。
- `pnpm build:desktop` 产出可安装的 `.app` 和 `.dmg`。
- 安装后关闭重开，IndexedDB 数据持久。
- 外部 Companion（`gpt-image-studio start`）能被桌面端检测和连接。
- 现有 Web App 部署（GitHub Pages）和 Companion 发布（npm）不受任何影响。

## 不在第一版范围

以下明确后置：

- **内嵌 Companion 为 sidecar**：需要把 Node Companion 打包成单文件二进制（Node SEA / pkg），且 macOS notarization 在处理 sidecar 时有已知问题（[tauri#11992](https://github.com/tauri-apps/tauri/issues/11992)）。等桌面壳稳定后再做。
- **macOS 代码签名 / notarization**：需要 Apple Developer 账号。当前 `pnpm build:desktop` 产出的是未签名 app，首次打开需在「系统设置 → 隐私与安全性」里手动允许。
- **Windows / Linux 跨平台构建**：第一版只验证 macOS arm64。
- **自动更新（Tauri updater）**。
- **CI 自动构建 + 发布 dmg**：需要签名凭据，留到后续。

## 后续路线

1. 内嵌 Companion sidecar（需先解决 Node 二进制化 + notarization）。
2. macOS 代码签名 + notarization（Apple Developer 账号）。
3. Windows / Linux 构建 + 跨平台 CI。
4. Tauri updater 自动更新。
5. 评估是否需要把 IndexedDB 迁移到 Tauri 的文件系统存储（目前 IndexedDB 在 WKWebView 下持久化正常，暂无必要）。
