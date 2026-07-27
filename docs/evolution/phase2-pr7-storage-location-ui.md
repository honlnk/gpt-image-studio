# 阶段二 PR7：前端存储位置 UI + 切换 reload 逻辑

> **状态：🚧 进行中**
>
> 依赖：PR1-6
>
> 目标：Companion 模式下，在设置页提供存储位置选择（A/B/C），切换时触发整套 reload。

## 1. 设计决策：切换 = 页面 reload

storage 实例 + services + stores 在 ViewModel setup 时一次性创建，绑定到特定后端。切换 connectionMode 或 storage location 时，重建整套需要：新 storage → 新 services → 清空内存 stores → 重新 hydrate。部分 reload 容易状态错乱。

**方案：切换时页面 reload（window.location.reload）**。ViewModel setup 读 connectionMode + companion 凭据，重新装配正确后端。

理由：
- 符合 D1 数据集隔离——切换 = 新数据集（空状态），reload 最干净。
- 避免部分 reload 的状态泄漏风险（store 残留旧数据集的数据）。
- 切换是低频操作，reload 的体验成本可接受（短暂 loading 后新数据集）。

切换流程：
1. 用户在设置页选存储位置 + 点确认。
2. 调 `POST ${companionUrl}/storage/datasets/activate`（Companion 侧切换 active dataset）。
3. 给确认提示（D1：当前内容将不可见，不会删除）。
4. `window.location.reload()`。
5. 页面重载 → ViewModel setup → resolveStorage 返回新 storage → hydrate 读新数据集。

## 2. UI 设计

设置页新增「存储位置」配置区（仅 Companion 模式显示）：
- 当前存储位置状态（filesystem-default / filesystem-custom / oss）。
- 切换按钮 → 弹出选择面板（A/B/C 三选一）。
- A 选项：目录输入框 + 校验（调 validateCustomDirectory 等效的前端校验 + 后端校验）。
- C 选项：OSS 配置表单（endpoint/bucket/AK/SK）→ 调 `/storage/oss/config` PUT。

顶栏徽标：Companion 模式下显示存储位置（如「Companion 文件系统」/「Companion OSS」）。

## 3. 改造范围

### 新增/改动文件
- `src/services/companionApi.ts` —— 新增 activateDataset / getActiveDataset / OSS config CRUD 方法
- `src/stores/settingsStore.ts` —— 新增 companionStorageLocation 派生状态（从 active dataset 读）
- `src/components/settings/` —— 新增 StorageLocationPanel.vue（存储位置选择 UI）
- `src/app/studio/useStudioViewModel.ts` —— reload 触发逻辑
- 顶栏徽标组件 —— 显示存储位置

## 4. 验收
- Companion 模式设置页可见存储位置切换 UI
- 切换后页面 reload，看到新数据集（空或已有）
- 切换前有确认提示
- direct 模式不显示此 UI
