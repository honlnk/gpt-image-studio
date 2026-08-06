# Companion 子系统文档

Companion 是可选的本地（或服务器端）助手服务，代理图片生成 / 编辑请求到真实 Provider，并提供凭据管理、多租户存储等能力。本目录集中维护 Companion 子系统的设计、方案和审查文档。

## 文档清单

| 文档 | 说明 |
| :--- | :--- |
| [本地 CLI Companion 方案](companion.md) | Companion 的设计、HTTP 协议、安全要求、分阶段计划和 CLI MVP |
| [多 Provider 翻译层方案](companion-providers-plan.md) | Provider 适配层架构与实施记录。已接 OpenAI、GLM-Image、豆包 Seedream、Qwen-Image、通义万相 Wan、Grok、Gemini、Gemini-OpenAI、DeepInfra 共 9 个 Provider |
| [豆包 Provider 方案](companion-doubao-plan.md) | 火山方舟 Seedream adapter 的独立设计（文生图 + 图生图，minPixels 约束） |
| [多模型适配层审查](companion-provider-adapter-review.md) | 当前 Adapter 架构、已接受的安全决策、已完成整改、剩余风险和建议整改顺序 |

## 相关文档

- [各 Provider 参考图上传限制](../architecture/provider-reference-image-limits.md) — 各 Provider 对参考图的数量、大小和格式限制（跨 provider 参考数据）
- [ADR 002：Companion 安全边界](../decisions/002-companion-security-boundary.md) — 网络边界、连接密钥与 JWT、Provider 凭据管理信任模型
- [部署指南](../guides/deployment-guide.md) — Companion server 模式部署、Docker 编排、JWT 多租户配置
- [架构演进施工记录](../archive/evolution/README.md) — 阶段一/二/三中 Companion 后端化、服务化与可嵌入的完整施工记录

## 维护规则

1. 新增 Provider adapter 时，在 `companion-providers-plan.md` 追加阶段记录，并在本目录或 `../architecture/provider-reference-image-limits.md` 补充参考图限制。
2. 安全边界相关决策以 `../decisions/002-companion-security-boundary.md` 为准，本目录文档不重复维护决策正文。
3. Provider 特定验证、size 翻译、任务轮询等逻辑留在 Companion 代码内，Web 端只感知 capability。
