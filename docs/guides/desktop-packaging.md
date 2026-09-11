# 桌面端打包方案

更新日期：2026-08-21

## 方向

GPT Image Studio 的桌面端基于 **Tauri v2**，把现有 Web App（Vue 3 + Vite 构建产物）原样嵌入系统 webview。

**内置 Companion sidecar（阶段四 · 方案 B 首期，2026-08）**：Companion 被 `bun build --compile` 编译成单文件二进制，作为 Tauri sidecar 随 app 分发、启动时自动拉起——用户无需安装 Node 或 npm 包。与 npm CLI 版共享数据目录 `~/.gpt-image-studio`（凭据、数据集互通；19750 上已有本产品 Companion 时直接复用不抢端口）。sidecar 启动失败时 webview 回落 standalone 模式（可手动配对外部 Companion），桌面端不会因此卡死。

## 选型理由

| 方案 | 结论 |
|------|------|
| Tauri v2 | 选中。系统 webview，体积小（壳约 3-10MB），macOS 最成熟，直接消费现有 `dist/`，无需改动 Vue 代码 |
| Electron | 不选。Electron 的 150-300MB 体积劣势无意义 |
| PWA | 不选。无法管理 Companion 进程；HTTPS 页面调用 `http://127.0.0.1` 会触发混合内容阻塞 |

sidecar 二进制化选型：

| 方案 | 结论 |
|------|------|
| Bun `build --compile` | 选中。单文件可执行、原生支持 ESM、零运行时依赖。**注意：better-sqlite3 的 addon 依赖 V8 API（非 N-API），在 Bun 的 JavaScriptCore 运行时无法加载（oven-sh/bun#4290），因此引入 `src/storage/sqliteDriver.ts` 运行时适配层——Node 下照旧用 better-sqlite3，Bun 二进制下用 bun:sqlite** |
| Node SEA | 不支持原生插件打进单文件 |
| @yao-pkg/pkg | ESM 支持不稳、原生插件需运行时解压 |

可行性已验证：

- 现有 `dist/` 是 `base: '/'` 根路径、单 JS chunk + 单 CSS，Tauri 可直接嵌入。
- IndexedDB、`URL.createObjectURL`、`navigator.clipboard`、SSE streaming 在 macOS WKWebView 下都能正常工作。
- `urlSettings.ts` 在桌面环境下 `window.location.search` 为空，自动走无参数分支，无需改动。
- Companion 连接（webview fetch 到 `http://127.0.0.1:19750`）正常：CSP 已放行 loopback；companion 侧 `--allow-origin` 放行 `tauri://localhost`（macOS webview origin）等五个桌面 origin。

## 目录结构

```
gpt-image-studio/
├── src/                          # Web App 源码（不变）
├── companion/                    # 本地 CLI Companion（npm 发布 + sidecar 源）
│   ├── src/storage/sqliteDriver.ts   # SQLite 驱动适配层（Node=better-sqlite3 / Bun=bun:sqlite）
│   └── scripts/build-sidecar.mjs     # sidecar 构建脚本（bun build --compile）
├── dist/                         # Vite 构建产物（桌面端和 Web 共用）
└── desktop/
    └── src-tauri/
        ├── Cargo.toml            # Rust 依赖（含 tauri-plugin-shell / opener）
        ├── build.rs              # tauri-build 入口
        ├── tauri.conf.json       # Tauri 配置（frontendDist / externalBin / resources）
        ├── capabilities/
        │   └── default.json      # 最小权限声明（sidecar 由 Rust 侧 spawn，无需 shell 权限）
        ├── binaries/             # 构建产物：companion-<triple>（gitignored）
        ├── resources/
        │   └── companion-admin/  # 构建产物：admin 管理页静态资源（gitignored）
        ├── icons/                # 应用图标（多尺寸 + icns/ico）
        └── src/
            ├── main.rs           # 二进制入口
            └── lib.rs            # 应用装配 + sidecar 生命周期管理
```

桌面端与 Web App、Companion 三权分立，`desktop/` 不污染根目录，也不修改 `src/` 下任何文件。

## 前置依赖

桌面端构建需要 Rust toolchain + Bun（sidecar 编译）：

```bash
# macOS
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version    # 需要 >= 1.77.2（rustc -vV 的 host triple 也是 externalBin 命名来源）

brew install bun   # sidecar 单文件二进制编译

# 还需要 Xcode Command Line Tools（用于系统 webview 链接）
xcode-select --install
```

Node 端依赖（`@tauri-apps/cli`、`@tauri-apps/api`）已在项目 `devDependencies`/`dependencies` 中：

```bash
pnpm install
```

## 开发与构建命令

```bash
pnpm dev:desktop     # sidecar 构建 + 开发模式：Vite dev server + 热重载 webview
pnpm build:desktop   # sidecar 构建 + 生产构建：vite build → cargo build --release → .app / .dmg
```

两个命令都会先跑 `pnpm build:sidecar`（companion/scripts/build-sidecar.mjs）产出
`desktop/src-tauri/binaries/companion-<triple>` 与 admin 资源。修改 companion 源码后
需重跑（dev 模式下 tauri 不会自动重建 sidecar）。

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

`capabilities/default.json` 只授予 `core:default`（核心 window 权限），不开放 shell / filesystem / http 插件给 webview。**sidecar 由 Rust 侧经 `tauri-plugin-shell` spawn（lib.rs），不经过 IPC，因此无需向 webview 授予 shell 权限**；webview 只通过自定义命令与壳交互：`desktop_companion_info`（拉连接信息）、`open_admin_window`（管理页开应用内原生子窗口，label 固定重复点击聚焦，URL 限 loopback）和 `open_external_url`（opener 开外链）。

### Sidecar 装配（tauri.conf.json + lib.rs）

- `bundle.externalBin: ["binaries/companion"]` — Tauri 按 `<名称>-<目标三元组>` 约定查找（如 `companion-aarch64-apple-darwin`），打包时随 app 分发，dev 时由 tauri-build 拷入 `target/debug/`。
- `bundle.resources: ["resources/companion-admin/"]` — admin 管理页静态资源，sidecar 经 `COMPANION_ADMIN_DIR` 环境变量指向它。
- 启动流程（lib.rs `start_embedded_companion`，后台线程）：
  1. 预探测 `127.0.0.1:19750/health`，响应体含本产品标识 → **复用**（CLI 后台服务 / 先前的桌面实例；共享数据目录 ⇒ 同一 access key）。
  2. 否则 spawn `serve --port 19750 --allow-origin <五个桌面 origin>`，扫描 stdout 等待 `COMPANION_READY {"port":N}` 握手行。
  3. 子进程握手前早退（19750 被外部进程占用）→ `--port 0` 临时端口重试一次（握手行报告实际端口）。
  4. 从数据目录读 `access-key.json`，连同 URL 写入 `SidecarState`。
- 退出时（`RunEvent::Exit*`）kill spawn 的子进程；复用的外部进程不受影响。
- webview 启动时 `main.ts` 调 `desktop_companion_info`（8s 有界等待握手）→ `applyDesktopCompanionConfig` 自动连接、锁定 Companion 模式；不可用时回落 standalone。

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

桌面端**内置** Companion（sidecar），同时与 npm CLI 版共存：

1. 桌面应用启动 → Rust 壳自动拉起（或复用已在运行的）内置 Companion → webview 自动连接，无需粘贴密钥。
2. 数据目录共享 `~/.gpt-image-studio`：桌面版与 `npm install -g @honlnk/image-studio-companion` 的 CLI 版看到同一份 provider 凭据、数据集、连接密钥。
3. provider 凭据管理仍走 Companion 自带管理页：桌面端设置页/顶栏徽标点击 → 经 opener 在系统浏览器打开 `http://127.0.0.1:<port>/admin`（loopbackGuard 对无 Origin 的浏览器导航放行）。
4. sidecar 启动失败（二进制缺失/损坏、极端端口冲突）时，webview 回落 standalone 模式，可手动配对外部 Companion，桌面端不卡死。

桌面端的 IndexedDB 数据与浏览器端隔离（不同 webview 实例，不同 origin 数据分区），互不影响。

## 验收标准

- `pnpm dev:desktop` 能在 macOS 上打开桌面窗口，Web App 功能完整可用。
- `pnpm build:desktop` 产出可安装的 `.app` 和 `.dmg`。
- 安装后关闭重开，IndexedDB 数据持久。
- **开箱即连**：无需安装 npm Companion，启动后自动连上内置服务（徽标在线、版本正确）。
- **进程生命周期**：退出 app 后 sidecar 进程退出；复用已在运行的 Companion 时不误杀。
- 桌面版能看到 CLI 版配置的 provider 凭据与数据集（共享目录）。
- 现有 Web App 部署（GitHub Pages）和 Companion 发布（npm）不受任何影响。

## 不在当前范围

以下明确后置：

- **macOS 代码签名 / notarization**：需要 Apple Developer 账号。当前决策走**免签名路线**（`docs/plans/desktop-distribution-plan.md`）：`pnpm build:desktop` 产出未签名 app，首次打开需在「系统设置 → 隐私与安全性」里手动允许。若将来做签名，需注意 sidecar 二进制的 notarization 已知问题（[tauri#11992](https://github.com/tauri-apps/tauri/issues/11992)）。
- **Windows / Linux 跨平台构建**：CI 矩阵已就绪（`.github/workflows/desktop-release.yml`，含 Linux webkit2gtk 依赖与 Windows `.exe` 后缀处理），待首次发布实际验证。
- **自动更新（Tauri updater）**：未签名的 macOS 不可用 updater；轻量替代方案「检查更新」见分发方案 §4.5。
- **多 provider 前端管理 UI**：凭据管理仍走 admin 页（阶段四后续项）。
- **NativeStorage（APP 本地文件存储替代 IndexedDB）**：阶段四后续项，接口骨架已预留。

## 后续路线

按免签名分发方案（`docs/plans/desktop-distribution-plan.md` §四）的依赖顺序：

1. ~~CI 自动构建~~ —— 已完成（`desktop-release.yml`，tag `desktop-v*` 触发；细化设计见 `docs/plans/desktop-ci-cd-plan.md`）。
2. 安装脚本 `scripts/install-desktop.sh`（macOS 主力分发方式；下载页已预留位置）。
3. 下载页 `image.honlnk.com/download`（计划见 `docs/plans/download-page-plan.md`）。
4. SignPath Foundation 免费签名（触发式：Windows 用户对 SmartScreen 投诉时申请）。
5. 应用内「检查更新」（对比 GitHub releases 与当前版本，`openExternalUrl` 引导）。
6. 评估是否需要把 IndexedDB 迁移到 Tauri 的文件系统存储（目前 IndexedDB 在 WKWebView 下持久化正常，暂无必要）。
7. 多 provider 前端管理 UI / keychain 凭据加密（阶段四启动时再决策）。
