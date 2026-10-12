# GPT Image Studio 桌面端 v{{VERSION}}（Pre-release）

本地优先的 AI 图片创作工作台。基于 Tauri v2，**内嵌 Companion 服务**——安装即用，无需安装 Node / npm，启动自动完成连接。界面中英双语，跟随系统语言。

> ⚠️ 这是预发布版本（Pre-release），仅适合早期体验。
>
> 安装包**未做平台签名/公证**（开源免费项目的免签名分发路线），首次打开时系统的安全提示属正常现象，按下面对应平台的说明放行即可。

## 下载

| 文件 | 适用平台 |
|---|---|
| `GPT-Image-Studio_{{VERSION}}_aarch64.dmg` | macOS（Apple Silicon） |
| `GPT-Image-Studio_{{VERSION}}_x64-setup.exe` | Windows（64 位） |
| `GPT-Image-Studio_{{VERSION}}_amd64.AppImage` | Linux（通用） |
| `GPT-Image-Studio_{{VERSION}}_amd64.deb` | Linux（Debian / Ubuntu） |

## macOS：首次打开被拦截怎么办

未签名的 app 会被 Gatekeeper 拦截（提示「无法打开，因为无法验证开发者」）。两种放行方式，二选一：

1. **系统设置** → **隐私与安全性** → 下拉到「安全性」一节 → 点 GPT Image Studio 旁的「**仍要打开**」（macOS 15 起已不再支持右键 → 打开的旁路）；
2. 终端执行：
   ```bash
   xattr -cr /Applications/GPT\ Image\ Studio.app
   ```
   然后正常打开即可。

## Windows：SmartScreen 提示

首次运行安装包时可能出现蓝色「Windows 已保护你的电脑」提示：点「**更多信息**」→「**仍要运行**」即可。

## 更多

- 下载页（含图文安装教程、任意历史版本入口）：https://image.honlnk.com/download
- 网页版（无需安装）：https://image.honlnk.com
- 问题反馈：https://github.com/honlnk/gpt-image-studio/issues

---

# GPT Image Studio Desktop v{{VERSION}} (Pre-release)

A local-first AI image creation workbench. Built on Tauri v2 with an **embedded Companion service** — it works right after installation: no Node/npm to install, and the connection is set up automatically on launch. The UI is bilingual (English / 中文) and follows your system language.

> ⚠️ This is a pre-release build intended for early adopters.
>
> The installers are **not signed or notarized** (unsigned distribution, standard for a free open-source project). The security prompt on first launch is expected — follow your platform's instructions below to allow it.

## Downloads

| File | Platform |
|---|---|
| `GPT-Image-Studio_{{VERSION}}_aarch64.dmg` | macOS (Apple Silicon) |
| `GPT-Image-Studio_{{VERSION}}_x64-setup.exe` | Windows (64-bit) |
| `GPT-Image-Studio_{{VERSION}}_amd64.AppImage` | Linux (universal) |
| `GPT-Image-Studio_{{VERSION}}_amd64.deb` | Linux (Debian / Ubuntu) |

## macOS: first launch is blocked — what to do

Unsigned apps are intercepted by Gatekeeper ("can't be opened because it cannot be checked for malicious software"). Pick either of these:

1. Open **System Settings** → **Privacy & Security**, scroll to the Security section, and click **Open Anyway** next to GPT Image Studio (on macOS 15+ the old right-click → Open bypass no longer works);
2. Or run this in Terminal:
   ```bash
   xattr -cr /Applications/GPT\ Image\ Studio.app
   ```
   Then open the app normally.

## Windows: SmartScreen prompt

On first run you may see the blue "Windows protected your PC" prompt: click **More info** → **Run anyway**.

## More

- Download page (illustrated install guides, all past versions): https://image.honlnk.com/en/download/
- Web app (no install needed): https://image.honlnk.com
- Report an issue: https://github.com/honlnk/gpt-image-studio/issues
