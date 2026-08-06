# 阶段二 PR6：前端 CompanionStorage 填充 + resolveStorage 切换

> **状态：✅ 已完成（2026-07-27）**
>
> 依赖：PR1-5（Companion 后端 /storage/* 路由就绪）
>
> 目标：把前端 CompanionStorage 骨架替换为 fetch 调用 Companion 后端的真实实现，让 resolveStorage 在 localCompanion 模式下返回 CompanionStorage。

## 1. 装配顺序难点（探查结论）

ViewModel 第 72 行调 resolveStorage() 时，settingsStore（第 87 行才创建）尚未实例化；且 settingsStore 内部（131/133 行）也调 resolveStorage()。这是循环依赖。

**方案：CompanionStorage 构造时接收 getter 函数（惰性读取），resolveStorage 改为接收选项对象。**

```ts
// resolveStorage 改造
export function resolveStorage(opts?: {
  connectionMode?: ConnectionMode;
  getCompanionUrl?: () => string;
  getCompanionAccessKey?: () => string;
}): StudioStorage {
  if (opts?.connectionMode === "localCompanion" && opts.getCompanionUrl && opts.getCompanionAccessKey) {
    return new CompanionStorage({
      getCompanionUrl: opts.getCompanionUrl,
      getCompanionAccessKey: opts.getCompanionAccessKey,
    });
  }
  return new IndexedDbStorage();
}
```

**ViewModel 装配顺序调整**：先创建 settingsStore（拿到 companionUrl/companionAccessKey/connectionMode 的 ref），再调 resolveStorage 传入 getters。

## 2. CompanionStorage 实现设计

构造参数：
```ts
new CompanionStorage({
  getCompanionUrl: () => string,      // 惰性读，每次 fetch 时取最新
  getCompanionAccessKey: () => string,
})
```

每个方法用 fetch 调 `${companionUrl}/storage/*`，Authorization: Bearer ${accessKey}。

错误映射：HTTP 非 2xx → StorageError（code 按 status 映射：401→BACKEND_UNAVAILABLE，404→KEY_NOT_FOUND，400→SERIALIZATION_ERROR，其它→UNKNOWN）。

Blob 类型：saveImageBlob 收 Blob，转 ArrayBuffer 后 multipart 上传；loadImageBlob 收 Buffer 响应，转 Blob。

## 3. 改造范围

### 改动文件
- `src/services/storage/CompanionStorage.ts` —— 骨架替换为 fetch 实现
- `src/services/storage/resolveStorage.ts` —— resolveStorage 接收 opts，按 connectionMode 分叉
- `src/app/studio/useStudioViewModel.ts` —— 装配顺序调整，先 settings 后 storage
- `src/services/storage/storage-skeletons.test.ts` —— 移除 CompanionStorage BACKEND_UNAVAILABLE 断言，改为接入 contract test
- `src/services/storage/storage.contract.test.ts` —— 接入 CompanionStorage（用 mock fetch 或 FakeFetch）

### 不动文件
- 所有 store（service 注入不变）
- IndexedDbStorage（direct 模式不变）

## 4. 测试计划

- CompanionStorage 接入 storage.contract.test.ts（mock fetch 用 vi.fn 或 msw）
- resolveStorage 分叉测试：无参→IndexedDb，direct→IndexedDb，localCompanion→CompanionStorage
- 错误映射测试：404→KEY_NOT_FOUND，401→BACKEND_UNAVAILABLE

## 5. 验收
- typecheck + test 全绿
- CompanionStorage 契约测试通过（换实现不改接口验证）
- direct 模式行为完全不变（兼容性回归）
