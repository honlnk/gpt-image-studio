# 阶段一测试清单

验证「行为零变化 + 能力驱动机制正确生效」。分两层：先验现状没坏，再验能力驱动本身。

## 启动

```bash
# 终端 1：companion（前台 dev 渠道）
pnpm dev:companion

# 终端 2：web（vite 热重载）
pnpm dev
# 打开 http://127.0.0.1:8888
```

> **⚠️ 关键坑**：改 companion 源码（`companion/src/**`）后，**必须手动重启 companion 进程**（Ctrl+C 重跑 `pnpm dev:companion`）。companion 用 tsx 源码直跑，**不热重载**；web 端 vite 才热重载。否则改了 capability 代码但 `/auth/status` 还返回旧结构，UI 不变，会误判为 bug。

---

## 第一层：OpenAI 用户零回归

前提：用现有 OpenAI 中转站凭据（companion 已 pair + login），连接模式 = localCompanion。

| # | 操作 | 预期（=改动前行为） |
|---|------|---------------------|
| A1 | 打开设置面板看 Companion 状态 | 在线、已配对、显示 accountLabel |
| A2 | 看参数栏「模型」tag | 显示 `gpt-image-2`（companion 回流） |
| A3 | 点「背景」展开 | 只有「自动 / 不透明」，**「透明」不出现** |
| A4 | 点「格式」展开 | PNG / WebP / JPEG 三项都在 |
| A5 | 参数栏有「区域编辑」tag | 可见、能开关 |
| A6 | 文生图：选 16:9 + 2K，发一张图 | 正常生成，尺寸正确 |
| A7 | 文生图：选「自动」尺寸 | 正常生成 |
| A8 | 区域编辑：贴图 + mask → 生成 | 正常编辑（edits multipart 重建没坏） |

> A1–A5 是 UI 静态检查，1 分钟搞定。最关键的是 **A3**（透明被过滤）和 **A6**（尺寸没坏）。
> 流式（原 A9）：Companion 模式下无流式开关，流式仅走浏览器本地 apikey，且多数模型不支持——本轮不验，已知非目标。

---

## 第二层：能力驱动机制验证（无需配 GLM）

临时改 companion openai adapter 的 capability 模拟 GLM，重启 companion 看 UI 变化。

### 步骤

1. 编辑 `companion/src/providers/openai.ts`，把 `OPENAI_CAPABILITY` 改成模拟 GLM：

```ts
const OPENAI_CAPABILITY: ProviderCapability = {
  generate: true,
  edit: false,                    // 原本 true
  mask: false,                    // 原本 true
  backgrounds: ["auto", "opaque"],
  outputFormats: ["png", "jpeg"], // 去掉 webp
};
```

2. **重启 companion**（Ctrl+C → `pnpm dev:companion`）
3. 刷新 web，打开设置面板触发 checkStatus
4. 回参数栏观察

| # | 预期 |
|---|------|
| B1 | 「区域编辑」tag **消失**（mask=false） |
| B2 | 若之前区域编辑是「开」→ 自动变「关」（editModeEnabled 重置） |
| B3 | 「格式」只剩 PNG / JPEG（WebP 没了） |
| B4 | 若之前格式选 WebP → 自动回退到 PNG（失效值校正） |
| B5 | 「背景」仍只有 自动/不透明 |
| B6 | capability 改回原值 + 重启 companion → 区域编辑/全格式都恢复 |

### 收尾（重要）

测完把 `OPENAI_CAPABILITY` 改回原值再提交：

```ts
const OPENAI_CAPABILITY: ProviderCapability = {
  generate: true,
  edit: true,
  mask: true,
  backgrounds: ["auto", "opaque"],
  outputFormats: ["png", "webp", "jpeg"],
};
```

---

## 已知测试结果（2026-06-20）

- 第一层（A1–A8）：通过
- 第二层（B1–B6）：通过（需重启 companion 才生效）
- 单测：web 141 通过 / companion 47 通过 / vue-tsc + tsc 干净
