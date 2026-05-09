# 备份格式

GPT Image Studio 会将当前本地项目导出为一个完整 ZIP 备份。

备份包含会话、消息、图片元数据、不含 API key 的应用设置，以及图片 Blob。它的目标是恢复当前浏览器本地工作区，不是做跨用户同步。

## ZIP 结构

```text
manifest.json
data.json
blobs/<encoded blob key>
```

## Manifest

```ts
type BackupManifest = {
  app: "gpt-image-studio";
  version: number;
  exportedAt: string;
  excludes: string[];
};
```

当前版本：`1`。

`excludes` 当前包含 `apiKey`，用于明确说明备份不会包含 API key。

## Data 文件

```ts
type BackupData = {
  conversations: Conversation[];
  messages: Message[];
  imageAssets: ImageAsset[];
  settings?: Omit<AppSettings, "apiKey">;
};
```

`ImageAsset.previewUrl` 只存在于内存中，不能写入备份。

## Blob 文件

每个图片 Blob 会写入：

```text
blobs/${encodeURIComponent(blobKey)}
```

恢复时，所有带 `blobKey` 的图片资源都必须有对应 Blob 文件。缺失 Blob 会被视为无效备份。

## 恢复行为

当前恢复流程会先校验 manifest、基础数据结构和 Blob 完整性，然后清空并重写本地 IndexedDB stores。

重要约束：

- 恢复设置时保留当前已有 API key。
- 备份设置永远不会引入 API key。
- 恢复会覆盖当前本地会话、消息、图片资源、图片 Blob 和设置。

后续优化方向：让恢复流程在相关 object store 之间具备原子性，或者在清空当前数据前使用 staging 策略。
