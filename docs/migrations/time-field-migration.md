# 时间字段迁移记录

## 背景

早期数据模型里，`createdAt` / `updatedAt` 曾经保存展示文案，例如 `"刚刚"`，真实时间另存为 `createdAtMs` / `updatedAtMs`。

这个设计把数据层和展示层混在一起，会导致历史消息、图片和对话在刷新后仍然显示 `"刚刚"`。当前新数据已经改为：

- `createdAt`：ISO 时间字符串，例如 `2026-05-08T10:00:00.000Z`
- `updatedAt`：ISO 时间字符串
- 页面展示时动态计算相对时间
- 新写入流程不再写 `createdAtMs` / `updatedAtMs`

## 当前自动修复逻辑

自动修复逻辑集中在 `src/services/timeFieldMigration.ts`，会在应用启动读取本地数据前执行：

- 扫描 `conversations`、`messages`、`imageAssets`。
- 如果 `createdAt` / `updatedAt` 是旧展示文案，例如 `"刚刚"` 或其它无法解析的字符串，并且存在对应 legacy `createdAtMs` / `updatedAtMs`，就改写为 ISO 时间。
- 修复后写回 IndexedDB，并删除记录中的 `createdAtMs` / `updatedAtMs`。
- UI 和排序逻辑只读取 `createdAt` / `updatedAt`，不再在显示阶段兼容 legacy 毫秒字段。

IndexedDB schema 已升级到 v2，`src/services/db.ts` 会把索引从旧字段切到新字段：

- `conversations.updatedAtMs` -> `conversations.updatedAt`
- `messages.createdAtMs` -> `messages.createdAt`
- `imageAssets.createdAtMs` -> `imageAssets.createdAt`

也就是说，如果 IndexedDB 中已有记录是：

```json
{
  "createdAt": "刚刚",
  "createdAtMs": 1778217000000
}
```

应用启动时会把它保存回：

```json
{
  "createdAt": "2026-05-08T09:30:00.000Z"
}
```

当前迁移测试覆盖：

- 旧消息 `createdAt: "刚刚"` + `createdAtMs` 被转为 ISO。
- 旧对话 `updatedAt: "刚刚"` + `updatedAtMs` 被转为 ISO。
- 旧图片 `createdAt: "刚刚"` + `createdAtMs` 被转为 ISO。
- 已经是 ISO 的新数据不会被改动。

## 移除兼容代码的条件

建议满足以下条件后再移除 legacy 兼容：

- 自动改写的数据迁移已经上线并稳定运行至少一个小版本周期。
- 没有收到时间显示、排序或备份恢复相关回归反馈。
- 备份恢复流程也能处理迁移后的纯 ISO 数据。
- 当前用户数据中无需继续支持 `createdAt: "刚刚"` 这类记录。

清理时可以移除：

- `src/services/timeFieldMigration.ts`
- `src/services/timeFieldMigration.test.ts`
- `src/services/db.ts` 中旧索引迁移分支
