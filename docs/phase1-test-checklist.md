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

## 阶段二：GLM 文生图真实联调（需智谱 API Key）

> 这部分需要真实智谱 API Key，由用户侧完成。代码已就位、单测全绿，只差端到端跑一次。

### 配置 GLM 凭据

> **⚠️ 必须用源码版 companion，不能用全局 `gpt-image-studio` 命令**：全局安装版本可能落后于当前源码，不含阶段二的 login provider 选择和 GLM adapter。所有命令都在 `companion/` 目录下用 `npx tsx src/main.ts` 直跑源码。

```bash
cd companion

# 1. 停掉正在跑的 companion 服务（占用 19750 端口的那个终端 Ctrl+C）
# 2. 用源码版 login（不是全局 gpt-image-studio login！）
npx tsx src/main.ts login
#   选 2 (GLM-Image)
#   Base URL 回车用默认 (https://open.bigmodel.cn/api/paas/v4/images)
#   Model 回车用默认 (glm-image)
#   粘贴智谱 API Key
npx tsx src/main.ts status   # 确认 Provider=GLM-Image, Model=glm-image

# 3. 重启 companion 服务（源码版）
pnpm dev:companion
```

**跳过 login 的替代方案**（更快，直接写凭据文件）：

```bash
cat > ~/.gpt-image-studio/credentials.json <<'EOF'
{
  "provider": "glm",
  "apiBaseUrl": "https://open.bigmodel.cn/api/paas/v4/images",
  "apiKey": "你的智谱API Key",
  "model": "glm-image",
  "savedAt": "2026-06-20T00:00:00.000Z"
}
EOF
# 然后 pnpm dev:companion 重启服务
```

> 历史说明：本文执行时使用 `session.json` 和配对 session token。当前实现已改用持久化
> 连接密钥；切换 Provider 不会更换连接密钥，Web 端无需重新连接。

### 联调清单

| # | 操作 | 预期 |
|---|------|------|
| C1 | web 打开设置面板触发 checkStatus | Companion 在线、显示 GLM accountLabel |
| C2 | 看参数栏「模型」tag | 显示 `glm-image`（companion 回流） |
| C3 | 「区域编辑」tag | **消失**（GLM mask=false） |
| C4 | 「背景」展开 | 只有 自动/不透明（无透明） |
| C5 | 「格式」展开 | 只有 PNG/JPEG（无 WebP） |
| C6 | 文生图：随便一个 prompt + 1:1 | 正常生成图片（GLM URL→b64 翻译跑通） |
| C7 | 文生图：选 16:9 | 正常生成（比例→尺寸规整跑通） |
| C8 | 区域编辑（带 mask）→ 生成 | 报「当前 provider 不支持图片编辑」(501) |

**C6 是核心**——验证 GLM 完整链路（请求翻译 + URL→b64）。如果 C6 失败，看 companion 终端日志和返回的错误信息。

### 联调后回切 OpenAI

```bash
cd companion
npx tsx src/main.ts login   # 选 1 (OpenAI)，填回原凭据
pnpm dev:companion          # 重启（回到 companion/ 目录或项目根都行）
```

---

## 已知测试结果（2026-06-20）

- 第一层（A1–A8）：通过
- 第二层（B1–B6）：通过（需重启 companion 才生效）
- 阶段二联调（C1–C8）：待用户侧（需智谱 API Key）
- 单测：web 141 通过 / companion 70 通过 / vue-tsc + tsc + build 干净
