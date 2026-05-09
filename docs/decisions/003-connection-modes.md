# ADR 003：连接模式

## 状态

已提议。

## 背景

当前 Web App 会直接调用用户配置的 Images API Base URL。计划中的 companion 会增加第二条传输路径：Web App 调用 `127.0.0.1` 上的本地服务，再由 companion 代理到真实 provider。

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
