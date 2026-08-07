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

第一版（macOS arm64，未签名）已完成。以下均为 ⏸️，详见 `docs/guides/desktop-packaging.md`。

- 🔲 macOS 代码签名 + notarization（需 Apple Developer 账号）
- 🔲 Windows / Linux 跨平台构建（第一版只验证了 macOS arm64）
- 🔲 Tauri updater 自动更新
- 🔲 CI 自动构建 + 发布 dmg（需签名凭据）
- 🔲 内嵌 Companion 为 sidecar —— 需先解决 Node 二进制化（Node SEA/pkg）+ macOS notarization 对 sidecar 的已知问题（[tauri#11992](https://github.com/tauri-apps/tauri/issues/11992)）

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

- 🔲 更细的图片库筛选（按来源、格式、时间等）
- 🔲 继续打磨错误提示和操作反馈（单张删除、会话删除、存储失败回滚提示）
- 🔲 Analytics V2 分析层 —— V1 采集层已全部完成，V2 预留但未开始：
  - 基于事件计算满意度代理指标
  - 比较不同 prompt 模式下的结果操作分布
  - 输出可用性漏斗与关键路径转化

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
- ❌ File System Access API 本地目录导出 —— 已废弃，本地文件化能力改由 Companion 后端化承担
- ❌ 后端物理嵌入宿主项目（拆 package / SpringBoot 包装 / Node 子进程混部）—— 决策 D8 否决，Companion 作为独立服务部署
- ❌ 每用户自配 OSS（服务器模式）—— 决策 D11 否决，改为平台统一 OSS + STS
- ❌ API key 加密存储进备份 —— 已定 `stripCompanionCredentials` 剥离方案，未采用加密

</details>
