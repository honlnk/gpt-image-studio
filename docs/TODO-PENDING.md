# 待办清单（临时文档）

> 本文档是临时性的进度跟踪，记录 GPT Image Studio 1.0.0 稳定版之后**还没做的事**。每项做完后从此处删除对应条目；全部清空后可删除本文件。
>
> 正式规划与决策依据仍以 `docs/plans/roadmap.md`、`docs/plans/evolution-roadmap.md`、各专项文档为准——这里只是"可勾选清单"视图，方便快速回顾。

---

## 状态图例

- ⏸️ 明确后置 / 暂不启动（有触发条件，到时再决策）
- 🔲 有计划但还没开始（可随时推进）
- 👀 观察项（需真实运行数据才能判断，非开发任务）

---

## A. 桌面端深化

macOS arm64（未签名）+ **内置 Companion sidecar（2026-08 完成，见下）**。以下均为 ⏸️，详见 `docs/guides/desktop-packaging.md`。

- ✅ 内嵌 Companion 为 sidecar —— 已完成（阶段四 · 方案 B 首期）。Bun `build --compile` 单文件二进制 + `sqliteDriver.ts` 运行时适配（Node=better-sqlite3 / Bun=bun:sqlite，绕过 V8 addon 在 JSC 无法加载的限制）；Tauri 壳管理生命周期（复用 19750 已有实例 / spawn + COMPANION_READY 握手 / 临时端口重试 / 退出清理）；webview 自动连接、模式锁定、回落 standalone。原两个阻塞项的实际情况：Node 二进制化由 Bun 解决；macOS notarization 对 sidecar 的已知问题（tauri#11992）在未签名期不构成阻塞，做签名时再处理。
- 🔲 macOS 代码签名 + notarization（需 Apple Developer 账号；签名时需处理 sidecar 二进制的 notarization）
- 🔲 Windows / Linux 跨平台构建（只验证了 macOS arm64；build-sidecar.mjs 已预留 SIDECAR_TRIPLE）
- 🔲 Tauri updater 自动更新
- 🔲 CI 自动构建 + 发布 dmg（需签名凭据）

---

## B. 架构演进 · 阶段四 APP 化

⏸️ 整体标注"距离落地尚远，暂时不进入实施"，仅保留设计。详见 `docs/plans/evolution-roadmap.md` 第九章。阶段一已预留 `NativeStorage` 接口骨架。

启动时才决策的未决项：

- ⏸️ Companion 内化方案三选一：
  - 方案 A：Rust 重写（最重，最纯净）
  - 方案 B：Node sidecar（复用现有代码）
  - 方案 C：前端直连 provider（最轻，丢失多 provider 管理）
- ⏸️ APP 数据与 Web 数据是否允许手动互导
- ⏸️ APP 管理页形态（取决于内化方案）
- ⏸️ 是否引入 OS keychain 加密凭据 —— 延后依据已写入 `docs/companion/companion.md`「当前策略」节：现状与 Claude Code Linux 版、AWS CLI、gcloud、Aider 同级，触发条件为 server 多租户或 desktop 打包签名

---

## C. 本地 CLI Companion 后置能力

详见 `docs/companion/companion.md` 阶段六、`docs/plans/roadmap.md`。

- ⏸️ ChatGPT/Codex OAuth 评估 —— 涉及 OAuth token sink、refresh token 轮换、账号额度、Codex app-server 路由等复杂边界，需单独评估，第一版不做

---

## D. 业务功能候选方向

详见 `docs/plans/roadmap.md` 后续候选方向。

> 本组三项已全部完成，详情见「已关闭」节。

---



## E. 观察项（非开发任务）

- 👀 CDN 嵌入模式流量/带宽 —— 已有缓解决策（CF 反代 GitHub Pages 方案 2），执行手册见 `docs/guides/cloudflare-cdn-setup.md`，待实际遇到流量压力时按手册执行。仓库零改动，只需 CF 控制台 + DNS 操作。

---

## 已关闭 / 已废弃（仅供参考，不在待办范围内）

<details>
<summary>展开查看已关闭项</summary>

- ✅ Companion Provider 能力协议完善（Gemini 动态能力）—— 不做。决策：改用 `gemini-openai` adapter（兼容 GPT 协议中转），最省事收益最高。决策记录见 `docs/companion/companion-provider-adapter-review.md`
- ✅ CDN 流量观察项 —— 已有缓解决策（见上文 E），状态从"悬而未决"改为"遇压力时执行"
- ✅ keychain 延后依据 —— 已写入 `docs/companion/companion.md`
- ✅ 开机自启（macOS launchd / Linux systemd / Windows 注册表）—— 已完成。三平台「登录即启」+ CLI `autostart enable/disable/status` 子命令 + Companion `/admin` 管理页开关。详见 `docs/companion/companion.md` 阶段五补充节
- ✅ 更细的图片库筛选 —— 已完成。`ImageLibrary.vue` 增加搜索（图片名）、来源筛选（生成/编辑/导入三态，`classifyImageSource`）、格式筛选（动态汇总 mimeType）、排序（时间/名称/大小 + 升降序），「全部图片」范围筛选未载全时显示提示
- ✅ 错误提示与操作反馈打磨 —— 已完成。`feedbackStore` 增加 info/warning 变体；`renameImage`/`setImageTagColor` 持久化失败回滚内存并返回布尔结果（调用方依结果提示，不再假成功）；`deleteImage`/`deleteImages` 失败回滚乐观删除；`generationStore` 把图片保存失败从「生成失败」误判中分离，走独立存储错误通道；`reportStorageError` 加节流去重 toast，让静默存储失败对用户可见但不刷屏；`BatchOperationsPanel` 批量下载加 try/catch
- ✅ Analytics V2 分析层 —— 已完成。补 `generation.requested` 的 promptMode/quality/format/background/resolution 采集；新增 `analyticsAnalysis.ts` 纯函数层（生成漏斗、满意度代理、prompt 模式对比、时间序列、事件分布）+ 单测；新增 `AnalyticsDashboard.vue` 只读仪表盘（设置页「数据分析」tab，纯 CSS/SVG 可视化，无图表库）；`analyticsStore` 加 `refreshAnalyticsInsights`
- ❌ File System Access API 本地目录导出 —— 已废弃，本地文件化能力改由 Companion 后端化承担
- ❌ 后端物理嵌入宿主项目（拆 package / SpringBoot 包装 / Node 子进程混部）—— 决策 D8 否决，Companion 作为独立服务部署
- ❌ 每用户自配 OSS（服务器模式）—— 决策 D11 否决，改为平台统一 OSS + STS
- ❌ API key 加密存储进备份 —— 已定 `stripCompanionCredentials` 剥离方案，未采用加密

</details>
