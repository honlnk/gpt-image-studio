# 桌面端分发方案（免签名路线）

> 状态：**草案，待审阅**（2026-09 起草）。
> 前置依赖：`feat/desktop-companion-sidecar` 分支（内嵌 Companion 首期）合入后再实施。
> 定位：回答「桌面版怎么让别人用起来，且不花一分钱签名费」。

## 一、背景与决策

桌面版首期已完成：Tauri 壳 + 内嵌 Companion sidecar，本地构建验证通过（macOS arm64，未签名）。要让别人用，绕不开「分发」问题——而 Apple 的签名 + 公证没有任何免费通道，硬性绑定 Apple Developer Program（$99/年）。

**决策：走免费路线——绕开各平台的安全检查机制，而不是花钱满足它。**

| 平台 | 方案 | 成本 | 用户感受 |
|---|---|---|---|
| macOS | `curl \| sh` 安装脚本 + 文档缓解 | 0 | 走脚本的用户**零警告**；浏览器直下用户需手动放行一次 |
| Windows | 暂不签名，文档说明；将来可申请 SignPath 免费签名 | 0 | 首次运行 SmartScreen 蓝色提示，点「仍要运行」即过 |
| Linux | 无需任何处理 | 0 | 无任何拦截 |

## 二、十分钟科普：为什么会弹「不安全」警告

（如果已经了解 Gatekeeper / SmartScreen，可直接跳到第三节。）

### macOS：Gatekeeper 与「隔离属性」

- macOS 对**从网络下载**的文件会打上一个 `com.apple.quarantine` 扩展属性（俗称隔离标记），首次打开这类 app 时由 Gatekeeper 检查：有没有有效签名？有没有经过 Apple 公证？两者任一不满足就拦截。
- **关键机制**：隔离标记**只由浏览器、AirDrop 等 GUI 途径写入**；用 `curl`、`wget`、`git` 等命令行工具下载的文件**没有这个标记**，Gatekeeper 根本不会检查。这就是免签名免费分发的原理基础。
- 我们目前不签名，用户浏览器下载 DMG 后首次打开会看到「无法打开，因为无法验证开发者」。macOS 15（Sequoia）起连「右键 → 打开」这个老旁路都被砍了，只能：系统设置 → 隐私与安全性 → 往下翻点「仍要打开」，或在终端执行 `xattr -cr /Applications/xxx.app` 清除标记。
- 两个概念区分（都不打算买）：
  - **签名（codesign）**：用「Developer ID Application」证书对 app 签名，证明身份，需要 $99/年账号；
  - **公证（notarization）**：把签好名的包上传给 Apple 扫描，通过后 Gatekeeper 放行，同样需要付费账号。

### Windows：SmartScreen

- 未签名（或「未知发布者」）的 exe 安装包首次运行，SmartScreen 弹蓝色全屏「Windows 已保护你的电脑」，点「**更多信息 → 仍要运行**」即可正常使用。有摩擦但不拦截。
- 想彻底消除要买代码签名证书：OV 证书是「信誉积累制」（签了名初期仍可能弹，下载量上去后自动消失）；EV 证书即时消除但贵且基本要求公司实体。开源项目有免费选项（见下文 SignPath）。

### Linux

没有任何等价机制。AppImage 加执行权限就能跑，deb/rpm 直接安装，系统不做来源检查。

### 2025-11 重要变化：Homebrew 这条老路已经死了

过去开源 Mac 应用的标准免费做法是「Homebrew cask + `--no-quarantine`」（brew 安装时自动跳过隔离标记）。但 **Homebrew 5.1 已彻底移除该 flag**，官方 cask 仓库也开始清退所有未签名应用（Alacritty、LibreWolf 等知名项目都被清退），**自定义 tap 同样无法跳过**——装完还得手动 `xattr`，和直接下载没有区别。

所以仍然有效的免费通道只剩：**安装脚本（curl 下载不写隔离标记）+ 文档缓解**。

## 三、具体方案

### 3.1 macOS：安装脚本（主力分发方式）

用户侧最终体验是一行命令（托管在仓库 `scripts/` 下，走 raw.githubusercontent 或 image.honlnk.com）：

```bash
curl -fsSL https://raw.githubusercontent.com/honlnk/gpt-image-studio/main/scripts/install-desktop.sh | sh
```

脚本职责（全部在用户终端里完成，产物始终不带隔离标记 → 全程零警告）：

1. `uname -m` 检测架构（arm64 / x86_64），暂不支持时给出明确提示（首期只发 arm64）；
2. 调 GitHub API `releases/latest` 取最新版本号；
3. `curl` 下载对应架构的 DMG（固定命名，见 4.1）；
4. `hdiutil attach` 挂载 → 把 `.app` 复制进 `/Applications`（已有旧版先删再装）→ 卸载 DMG；
5. 防御性 `xattr -cr`（万一用户环境的下载链路写了标记）；
6. 输出安装结果和启动方式。

Bun、rustup、Homebrew 本体都是这么装的，对技术用户是完全主流的接受度。我们的受众（要配 API key、跑本地服务的开发者）恰好全是技术用户。

### 3.2 浏览器直接下载的用户：文档缓解（无法消除，只能引导）

README「桌面端」小节 + 每个 Release 的发布说明里，写清两步：

- **macOS**：打开「系统设置 → 隐私与安全性」，往下翻到被拦记录，点「仍要打开」；或在终端执行 `xattr -cr /Applications/GPT\ Image\ Studio.app`。说明这是「未购买 Apple 签名（$99/年）的开源软件的正常现象，不是恶意软件」。
- **Windows**：SmartScreen 弹窗点「更多信息 → 仍要运行」。

### 3.3 Windows：先不签名，留一个免费后手

- 现阶段：不签。用户点一下「仍要运行」，可接受。
- 将来如果 Windows 用户反馈多，申请 **[SignPath Foundation](https://signpath.org/)**：给合格开源项目的**免费**代码签名（免费 OV 证书 + 免费 HSM 云端签名 + GitHub Actions 集成），LocalSend 在用，微软官方文档也把它列为开源项目的推荐选项。申请制，要求项目公开且有一定活跃度。注意 OV 证书有信誉积累期，刚签完 SmartScreen 仍可能弹一阵。

### 3.4 Linux：无动作

构建出 AppImage / deb 即可分发，不需要任何签名或说明。

## 四、待办清单（按依赖排序）

### 4.1 CI 自动构建（其余一切的前置）

> ✅ **已落地（2026-09-11）**：细化设计见 [desktop-ci-cd-plan.md](./desktop-ci-cd-plan.md)，workflow 为 `.github/workflows/desktop-release.yml`（tag `desktop-v*` 触发三平台构建 + prerelease 发布；`workflow_dispatch` 只构建不发布）。与细化设计的一处偏差：构建/上传用 `pnpm tauri build` + `gh` CLI 而非 tauri-action（决策记录见细化设计 §九）。首次真实发布与 `desktop-v0.2.0` 合并验证。

现在桌面版是本地手动构建的；安装脚本要有稳定的下载源，必须先有 CI 把产物发布到 GitHub Releases。

- GitHub Actions 三平台 matrix：`macos-latest` / `windows-latest` / `ubuntu-latest`；
- 每个平台：pnpm 装依赖 → `oven-sh/setup-bun` 装 Bun → `pnpm build:sidecar`（Rust 侧由 tauri-action 处理）→ `tauri-apps/tauri-action` 构建并上传 Release 资产；
- **免签名路线的工程红利：CI 不需要配置任何签名凭据**，一个默认 `GITHUB_TOKEN` 就够；
- 前置小改动：`build-sidecar.mjs` 在 Windows triple 下补 `.exe` 后缀（`SIDECAR_TRIPLE` 参数已预留）；Linux 侧补 webkit2gtk 系统依赖；
- 产物固定命名（脚本和文档都依赖它）：
  - macOS：`GPT-Image-Studio_<version>_aarch64.dmg`
  - Windows：`GPT-Image-Studio_<version>_x64-setup.exe`（NSIS）
  - Linux：`GPT-Image-Studio_<version>_amd64.AppImage` + `.deb`

### 4.2 安装脚本 `scripts/install-desktop.sh`（依赖 4.1）

> ✅ **已落地（2026-09-12）**：按 3.1 职责清单实现。两处与早期设想的偏差：① 版本解析走 Releases **列表** API 而非 `/releases/latest`（桌面版是 prerelease，后者取不到，与下载页 releaseClient 同理）；② 旧版替换前先 `osascript` 尝试退出运行中的 app。已通过真实 Release 资产验证版本解析与下载链接有效性；发布前仍建议在新机器/已有旧版两种场景各跑一遍。

按 3.1 的职责清单实现。发布前用真实 Release 资产完整跑一遍（新机器、已有旧版两种情况）。

### 4.3 README + Release 说明模板（不依赖 CI，可立即做）

> ✅ **已落地（2026-09-12）**：`.github/release-notes-desktop.md`（CI `sed` 替换 `{{VERSION}}`，随 desktop-release.yml 注入）；README「方式四：桌面端」补了一行命令安装入口（curl\|sh）与 macOS / Windows / Linux 三平台放行说明。

按 3.2 写好两平台文案；Release notes 做成可复用模板（放 `.github/` 或文档里）。

### 4.4 （后置，有触发条件再做）SignPath Foundation 申请

触发条件：Windows 用户对 SmartScreen 提示反馈较多。通过后把签名步骤接进 4.1 的 Windows job。

### 4.5 （后置）应用内「检查更新」

> ✅ **已落地（2026-09-12）**：`src/services/desktopUpdate.ts` + 设置 → 关于面板的桌面端专属卡片（仅 Tauri 运行时渲染）。版本号经 `getVersion()`（`@tauri-apps/api/app`）读取，capability 增加 `core:app:allow-version`；有新版时 `openExternalUrl` 打开对应 Release 页。与下载页的差异：API 失败**不**回落 FALLBACK_RELEASE（对硬编码旧版本比较会误报「已是最新」），明确报错让用户重试。

macOS 未签名**做不了 Tauri updater 静默自动更新**（updater 要求已签名 app）。替代轻方案：设置里加「检查更新」，对比 GitHub `releases/latest` 与当前版本，有新版则提示并打开 Release 页（复用已有的 `openExternalUrl`）。Windows/Linux 将来如果做了签名可再评估真 updater。

## 五、代价与边界（诚实清单）

- 浏览器直下 macOS 的警告**无法消除**，只能靠文档引导走「仍要打开」或改用安装脚本；
- 放弃 macOS 静默自动更新（签名前置不满足），用轻量检查更新替代；
- SignPath 是 OV 证书，签完初期 SmartScreen 仍可能弹（信誉积累期）；
- 好消息：**不公证 ⇒ tauri#11992（sidecar 导致 notarization 失败的已知 bug）与我们无关**，TODO-PENDING 里对应的风险项直接消解；
- 受众判断：本产品需要用户自备 API key / 本地服务，天然过滤出技术用户，上述摩擦均在可接受范围。

## 六、与现有文档的关系（本方案审阅通过后同步）

- `docs/guides/desktop-packaging.md`：「后续路线」从「签名优先」改写为本文的免费路线；
- `docs/TODO-PENDING.md`：A 组的签名 / CI / 跨平台条目按本文第四节重排，tauri#11992 风险项标记消解；
- `docs/plans/evolution-roadmap.md`：阶段四补充分发路线决策；
- `README.md`：「方式四：桌面端」补安装脚本入口与各平台打开说明。
