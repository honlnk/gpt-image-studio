# ADR 003：连接模式

## 状态

已接受。`ConnectionMode` 类型已落地于 `src/types/studio.ts`，两个 `ImageClient` 实现均已运行。

## 背景

Web App 可直接调用用户配置的 Images API Base URL。Companion 增加第二条传输路径：Web App 调用 Companion 服务，再由 Companion 代理到真实 provider。Companion 自身又分 local（`127.0.0.1` + 连接密钥）和 server（可远程监听 + JWT 多租户）两种部署形态。

## 决策

将图片 API 传输方式建模为显式连接模式：

```ts
type ConnectionMode = "direct" | "localCompanion";
```

`direct` 继续作为默认模式，保留当前纯浏览器工作流。

`localCompanion` 通过 `ImageClient` 边界接入：

- `directImagesClient`
- `localCompanionImagesClient`

生成流程应该依赖 client 接口，而不是依赖具体 `fetch` 细节。

## 影响

- 现有用户继续使用当前配置方式。
- 接入 companion 时不需要重写消息和图片持久化流程。
- 设置需要迁移策略：旧设置缺少 `connectionMode` 时默认视为 `"direct"`。
- 备份继续不包含敏感凭据，包括 companion secret。除非后续有新的架构决策明确改变这一点。
