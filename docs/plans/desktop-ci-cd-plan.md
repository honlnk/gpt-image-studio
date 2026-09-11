# 桌面端 CI/CD（自动构建与发布）计划

> 状态：**草案，待审阅**（2026-09-11 起草）。
> 衔接文档：
> - [desktop-distribution-plan.md](./desktop-distribution-plan.md) —— 本文档是其 **§4.1「CI 自动构建」的细化设计**（其余待办 4.2 安装脚本、4.3 文档模板均以本计划为前提）；
> - [download-page-plan.md](./download-page-plan.md) —— 下载页的 `releaseClient` 资产模式匹配与本计划 §六 的命名规范互为契约。

## 一、背景与现状

现有两条 workflow，均不覆盖桌面端：

| Workflow | 触发 | 职责 |
|---|---|---|
| `deploy.yml` | push/PR to `main` | Web 构建（vite-ssg）→ GitHub Pages 部署 → IndexNow |
| `release.yml` | tag `companion-v*` | Companion npm 发布（Trusted Publishing/OIDC）+ Docker 多架构镜像（ghcr + Docker Hub） |

桌面端目前完全手动：本机 `pnpm build:desktop` 构建、网页手工上传 Release 资产（`desktop-v0.1.0` 就是这么来的，资产名被 GitHub 网页端把空格改写成点，变成 `GPT.Image.Studio_0.1.0_aarch64.dmg`）。

**免签名决策的 CI 红利**（分发方案已明确）：不买 Apple 证书、不签名不公证 ⇒ CI 不需要任何签名凭据，默认 `GITHUB_TOKEN` 即可跑通全链路。这也顺带绕开了 sidecar 二进制的公证已知问题（tauri#11992 与我们无关）。

## 二、目标与非目标

**目标**：

1. 打 `desktop-vX.Y.Z` tag 即全自动产出三平台安装包并挂到 GitHub Release（prerelease）；
2. 资产名固定规范（连字符命名），供安装脚本（§4.2）和下载页确定性引用；
3. Release 说明由模板生成（含 macOS Gatekeeper / Windows SmartScreen 放行指引，分发方案 §4.3 的 Release 侧）；
4. 幂等可重跑（资产 `--clobber` 覆盖，Release 已存在则复用）；
5. `workflow_dispatch` 提供「只构建不发布」的验证通道。

**非目标（与分发方案一致，明确不做）**：

- macOS 签名/公证、Windows 签名（SignPath 属 §4.4 触发式后置）；
- Tauri updater 与 latest.json（未签名的 macOS 用不了 updater，§4.5 用轻量检查更新替代）；
- macOS Intel / Universal 包（v1 只出 Apple Silicon；Intel 后续可加 `macos-13` 矩阵项）；
- PR 级桌面构建冒烟（Rust 构建太贵；列为可选后续）。

## 三、触发设计

```yaml
on:
  push:
    tags: ["desktop-v*"]      # 与 companion-v* 的模式一致
  workflow_dispatch:           # 手动触发：只构建 + 上传 artifact 验证，不碰 Release
```

并发控制：`concurrency: group: desktop-release-${{ github.ref }}`，同 tag 重复推送取消在跑的旧任务。

## 四、总体流程

```
tag desktop-vX.Y.Z push
        │
        ▼
┌─────────────────────┐
│ Job 1: prepare      │  ubuntu-latest，两分钟
│ - 校验版本号三处一致  │  tag = tauri.conf.json = Cargo.toml
│ - 创建 prerelease    │  gh release create --prerelease --notes-file（幂等：已存在则跳过创建）
└─────────┬───────────┘
          │ needs
          ▼
┌─────────────────────────────────────────────┐
│ Job 2: build（matrix，fail-fast: false）      │
│  macos-latest │ windows-latest │ ubuntu-latest│
│  各自原生构建（无交叉编译）                      │
│  → 重命名为固定资产名                           │
│  → gh release upload --clobber               │
└─────────────────────────────────────────────┘
```

为什么拆 prepare 而不是让每个 matrix job 各自建 Release：Release 只建一次，避免三 job 竞态；版本号校验也只跑一次、失败即整体 fail fast。

## 五、构建 Job 细节

### 5.1 共用步骤（三平台一致）

```bash
checkout
→ pnpm/action-setup@v4（版本读 package.json packageManager 字段，与现有 workflow 一致）
→ actions/setup-node@v4（node 20，cache: pnpm —— 与 deploy.yml 对齐）
→ oven-sh/setup-bun@v2                              # sidecar 编译
→ swatinem/rust-cache@v2（按 matrix.os 分 shared-key）
→ pnpm install --frozen-lockfile
→ pnpm build:sidecar                                # 产出 binaries/companion-<triple> + admin 资源
→ pnpm exec tauri build --bundles <平台包型>          # beforeBuildCommand 已配置 pnpm run build，dist/ 自动产出
```

要点：

- **CI 命令与本地命令完全一致**（`build:sidecar` + `tauri build`），本地能过 = CI 能过，排查心智成本低；
- `tauri build` 的 `beforeBuildCommand` 会自动跑 `pnpm run build`（vite-ssg），无需单独一步；
- **不引入 `tauri-apps/tauri-action`**，决策记录见 §九；
- matrix 各 job 原生编译 sidecar（host triple 即目标 triple），**无交叉编译**；runner 镜像已预装 Rust toolchain。

### 5.2 平台差异

| | macOS | Windows | Linux |
|---|---|---|---|
| runner | `macos-latest`（arm64） | `windows-latest` | `ubuntu-latest` |
| sidecar triple | `aarch64-apple-darwin` | `x86_64-pc-windows-msvc` | `x86_64-unknown-linux-gnu` |
| `--bundles` | `dmg` | `nsis` | `appimage,deb` |
| 额外系统依赖 | 无 | 无 | `apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf` |
| 产物目录 | `bundle/dmg/` | `bundle/nsis/` | `bundle/appimage/` + `bundle/deb/` |

（`tauri.conf.json` 的 `targets: "all"` 保持不动——本地构建行为不变；CI 用 `--bundles` 按平台收窄，例如 Windows 不产出 MSI。）

### 5.3 产物收集与上传

每个 job 末尾：把 `desktop/src-tauri/target/release/bundle/` 下的目标产物按 §六 重命名，然后：

- tag 触发：`gh release upload "$TAG" <files> --clobber`（`GH_TOKEN` 用自动注入的 `GITHUB_TOKEN`）；
- dispatch 触发：改用 `actions/upload-artifact` 暂存，供下载验证，不碰 Release。

## 六、资产命名规范（重命名映射表）

Tauri 原始输出跟随 `productName`（含空格），统一重命名为连字符风格——**这就是分发方案 §4.1 的「固定命名」，也是安装脚本和下载页解析的契约**：

| 平台 | Tauri 原始输出 | 上传资产名 |
|---|---|---|
| macOS | `GPT Image Studio_<ver>_aarch64.dmg` | `GPT-Image-Studio_<ver>_aarch64.dmg` |
| Windows | `GPT Image Studio_<ver>_x64-setup.exe` | `GPT-Image-Studio_<ver>_x64-setup.exe` |
| Linux | `GPT Image Studio_<ver>_amd64.AppImage` | `GPT-Image-Studio_<ver>_amd64.AppImage` |
| Linux | `gpt-image-studio_<ver>_amd64.deb`（deb 包名被 Debian 规范小写化） | `GPT-Image-Studio_<ver>_amd64.deb` |

下载页 `releaseClient` 的正则按上表右列设计，同时兼容三种历史命名（点/空格/连字符），所以即便命名规范将来再变，页面也不会坏。

## 七、前置修复清单（CI 落地前必须先进 main 的代码改动）

1. **`companion/scripts/build-sidecar.mjs` 补 Windows `.exe` 后缀**：产物名改为 `companion-<triple>${triple.includes("windows") ? ".exe" : ""}`（Tauri externalBin 约定 Windows 必须带后缀）；同时确认 bun 在 Windows 下 `--outfile` 的扩展名行为（bun 可能对无扩展名输出自动补 `.exe`，重命名前用 `existsSync` 兼容两种情况）。`SIDECAR_TRIPLE` 环境变量已预留，无需新机制。
2. **新增 `.github/release-notes-desktop.md` 模板**：含版本号占位符（CI `sed` 替换），内容按分发方案 §4.3——macOS 放行两法（系统设置 → 隐私与安全性 →「仍要打开」/ `xattr -cr`）、Windows SmartScreen「更多信息 → 仍要运行」、以及「这是开源免签名软件的正常提示」的定调文案。
3. （可选）`scripts/bump-desktop-version.sh`：一键同步三处版本号（见 §八），第一期可手动，脚本后置。

## 八、发版操作流程（人工部分，每次发版）

1. 同步版本号三处：`desktop/src-tauri/tauri.conf.json`、`desktop/src-tauri/Cargo.toml`；若 companion 有改动则同步 `companion/package.json`（sidecar 版本经 `COMPANION_BUILD_VERSION` 从它注入），并按需另发 `companion-v*`（npm/Docker 线不变）。
2. 提交合并进 `main`，打 tag 推送：`git tag desktop-vX.Y.Z && git push origin desktop-vX.Y.Z`。
3. CI 全自动：校验 → 建 prerelease → 三平台构建上传。
4. 手动更新 `src/shared/downloads.ts` 的 `FALLBACK_RELEASE` 兜底常量（下载页主解析走 API，不更也不影响功能，只影响 API 失败时的兜底版本）。
5. 检查下载页 `https://image.honlnk.com/download` 已解析到新版本。

## 九、决策记录：为什么不用 `tauri-apps/tauri-action`

tauri-action 能省步骤（自动建 Release + 上传 + 内置 Rust 缓存），但对我们的路线有三个不合身：

1. **资产命名不可控**——跟随 `productName`（含空格），与 §六 的固定命名契约冲突，而这正是本计划的核心交付物；
2. **默认链路上下文是 updater**——它的 release JSON / 签名产物围绕 Tauri updater 设计，免签名路线用不到 updater，徒增噪音；
3. **Release notes 注入不如 `gh release create --notes-file` 直观**，模板文件可 review、可 diff。

代价是自己维护 Rust 缓存（`swatinem/rust-cache`，社区事实标准）和上传步骤，换来对命名、notes、prerelease 标记的完全控制，且减少一个高权限第三方 action 的供应链面。

## 十、权限、安全与成本

- `permissions: contents: write`（仅 Release 上传需要）；无签名凭据、无新增 secret——延续免签名路线的「CI 零秘密」；
- Release 继续标 **prerelease**：如实反映成熟度，且下载页走 Releases 列表 API（含 prerelease），不受影响；代价是 `/releases/latest/download/...` 短链不可用（下载页本来就不用它）；
- 仓库为公开仓库，GitHub Actions 标准 runner 不计费（macOS 分钟数十倍系数问题仅私有仓存在）。

## 十一、验证与上线顺序

1. 先合入 §七 的前置修复 + 本 workflow，`workflow_dispatch` 跑一次 build-only，确认三平台构建绿、产物命名正确；
2. 首次真实发布与 `desktop-v0.2.0`（首个含内嵌 Companion sidecar 的版本）合并执行——这也正是下载页计划 §五 的前置（避免下载页把流量引向 6 月的旧壳）；
3. 验证下载页解析：`/download` 应自动解析到新版本、各平台按钮按实际资产点亮。

## 十二、与现有文档的关系（本计划通过后同步）

- `docs/plans/desktop-distribution-plan.md`：§4.1 标记为「细化设计见本文档」；
- `docs/guides/desktop-packaging.md`：「不在当前范围」里的「CI 自动构建」一条更新为指向本计划；「后续路线」按分发方案 §六 改写（既定动作）；
- `docs/TODO-PENDING.md`：CI 条目更新状态；
- `AGENTS.md`：Commands 区无需动（CI 复用本地命令），架构说明补一句「桌面发布走 desktop-v* tag 触发」。

## 十三、后续（触发式）

- macOS Intel 包：`macos-13` 矩阵项（交叉编译 sidecar 用 `SIDECAR_TRIPLE=x86_64-apple-darwin`，bun `--target=bun-darwin-x64`）；
- SignPath 批下后：Windows job 加签名步骤（§4.4）；
- PR 桌面构建冒烟：paths-filter 限定 `desktop/**`、`companion/**` 变更时跑 build-only（可选，防破坏）；
- 应用内「检查更新」（§4.5）的轮询端点就是本计划产出的 Releases 列表 API。
