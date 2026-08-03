# 阶段三 PR1：Companion 监听地址可配置 + Docker 化

> 状态：✅ 已完成
> 依赖：无（阶段二已完成）
> 纲领：[`./phase3-overview.md`](./phase3-overview.md) §三「部署形态开关」+ §四 PR1

## 一、目标

让 Companion 的监听地址从硬编码 `127.0.0.1` 改为可配置，并打通 Docker 部署链路。本 PR **不引入任何阶段三行为变化**（不启用 JWT / 多租户 / STS），合并后阶段二功能 100% 回归通过。这是后续 PR2-PR4 的地基。

## 二、改造清单

### 2.1 引入部署形态配置模块（新文件）

**新建 `companion/src/deploymentConfig.ts`**：

```ts
export type DeploymentMode = "local" | "server";

export type DeploymentConfig = {
  mode: DeploymentMode;
  host: string;          // 监听地址：local 模式恒为 127.0.0.1，server 模式可配
  dataDir: string;       // 数据根目录（替代散落各处的 GPT_IMAGE_STUDIO_CONFIG_DIR 读取）
};

export function resolveDeploymentConfig(opts?: {
  mode?: string;         // 来自 --deployment-mode 或 COMPANION_DEPLOYMENT_MODE
  host?: string;         // 来自 --host 或 COMPANION_HOST
}): DeploymentConfig;
```

**解析规则**：
- `mode`：`process.env.COMPANION_DEPLOYMENT_MODE ?? opts.mode ?? "local"`。值只能是 `"local"|"server"`，其他值抛错。
- `host`：
  - `local` 模式：**恒为 `127.0.0.1`**（忽略传入的 host，保证本机信任模型不被破坏）。打印 warning 若用户显式传了 `--host`。
  - `server` 模式：`process.env.COMPANION_HOST ?? opts.host ?? "0.0.0.0"`。
- `dataDir`：`process.env.GPT_IMAGE_STUDIO_CONFIG_DIR ?? ~/.gpt-image-studio`（沿用现有约定，不改变量名以保持兼容）。

> **注意**：本 PR 只引入 `mode`/`host` 解析，`server` 模式下行为暂时与 `local` 完全一致（PR2 才接入 JWT）。`dataDir` 字段先定义但本 PR 不重构现有 `storage/db.ts` 的 `CONFIG_DIR`（避免大改动），留作 PR2 顺手统一。

### 2.2 server.ts 接受 host 参数

**改 `companion/src/server.ts`**：

`startServer` 签名加 `host`：

```ts
export async function startServer(opts: {
  port: number;
  host: string;            // ← 新增
  security: CompanionSecurityConfig;
}) {
  // ...
  await app.listen({ host: opts.host, port: opts.port });
  // ...
  console.log(`Companion 服务已启动: http://${opts.host}:${opts.port}`);
  // admin URL 用实际 host（server 模式下可能是 0.0.0.0，提示用户用实际访问地址）
  const displayHost = opts.host === "0.0.0.0" ? "127.0.0.1" : opts.host;
  console.log(`  管理页：http://${displayHost}:${opts.port}/admin`);
}
```

监听地址从硬编码 `127.0.0.1` 改为 `opts.host`。日志里的 `127.0.0.1` 字面量改为 `opts.host`（admin URL 提示用 `displayHost`，因为 `0.0.0.0` 不能直接浏览器访问）。

### 2.3 main.ts CLI 加 --host / --deployment-mode 选项

**改 `companion/src/main.ts`**：

`addServeOptions` 增加：
```ts
.option("-H, --host <host>", "监听地址（local 模式忽略，恒为 127.0.0.1）", process.env.COMPANION_HOST)
.option("--deployment-mode <mode>", "部署形态：local 或 server", process.env.COMPANION_DEPLOYMENT_MODE)
```

`ServeLikeOptions` 类型加 `host?: string; deploymentMode?: string;`。

`serve` action 调用 `resolveDeploymentConfig` 后传给 `startServer`：
```ts
.action(async (opts) => {
  const { startServer } = await import("./server.js");
  const deployment = resolveDeploymentConfig({ mode: opts.deploymentMode, host: opts.host });
  await startServer({
    port: Number(opts.port),
    host: deployment.host,
    security: createSecurityConfig({ channel: opts.channel, allowOrigins: opts.allowOrigin ?? [] }),
  });
});
```

`start` / `restart` 命令的 `startManagedProcess` 入参也透传 `host`/`deploymentMode`（见 2.4）。

### 2.4 processManager.ts 透传 host

**改 `companion/src/processManager.ts`**：

`StartManagedProcessInput` 加 `host?: string; deploymentMode?: string;`（都可选，默认 local）。

`startManagedProcess` 的 `args` 数组在 `--managed` 后追加：
```ts
if (input.host) args.push("--host", input.host);
if (input.deploymentMode) args.push("--deployment-mode", input.deploymentMode);
```

`ManagedProcessInfo` 加 `host?: string; deploymentMode?: string;` 字段并写入进程信息文件（便于 `status` 命令展示）。

`main.ts` 的 `start`/`restart` action 把 `opts.host`/`opts.deploymentMode` 传给 `startManagedProcess`。

### 2.5 status 命令展示 host/mode

**改 `companion/src/main.ts` 的 `status` action**：
- `ManagedProcessInfo` 有 host/mode 时打印 `地址: ${host}` 和 `形态: ${mode}`。
- health 检查的 URL：local 模式用 `127.0.0.1`，server 模式用进程记录的 host（若是 `0.0.0.0` 则探测 `127.0.0.1`，因为 status 是本机跑的）。

### 2.6 完善 Dockerfile（启用 companion stage）

**改根 `Dockerfile`** 的 Stage 3：

```dockerfile
# ---- Stage 3: companion server ----
FROM node:20-alpine AS companion

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY companion/package.json ./companion/package.json

RUN pnpm install --frozen-lockfile --filter @honlnk/image-studio-companion...

COPY companion ./companion

RUN pnpm --filter @honlnk/image-studio-companion build

# 数据持久化挂载点（SQLite + 图片文件）
ENV GPT_IMAGE_STUDIO_CONFIG_DIR=/data
RUN mkdir -p /data

EXPOSE 19750

# server 模式默认（PR2 起生效，PR1 阶段仍是 local 行为但可远程访问）
CMD ["node", "dist/main.js", "serve", "--host", "0.0.0.0", "--port", "19750"]
```

关键：`ENV GPT_IMAGE_STUDIO_CONFIG_DIR=/data` 让容器内所有持久化走 `/data`（SQLite + 图片 + 凭据），宿主挂卷到 `/data` 即可持久化。`CMD` 默认 `--host 0.0.0.0` 让容器外可访问。

**移除** Stage 3 注释里关于 `127.0.0.1` 限制的说明（已解决）。

### 2.7 启用 docker-compose.yml 的 companion 服务

**改根 `docker-compose.yml`**：

取消 `companion` 服务注释，完善配置：
```yaml
  companion:
    profiles: ["companion"]
    build:
      context: .
      target: companion
    image: gpt-image-studio-companion:latest
    container_name: gpt-image-studio-companion
    ports:
      - "19750:19750"
    volumes:
      - companion-data:/data
    environment:
      # PR1 阶段：仍是 local 行为，但可远程访问
      # PR2 起补 JWT_SECRET / ADMIN_API_KEY 等
      - GPT_IMAGE_STUDIO_CONFIG_DIR=/data
    restart: unless-stopped
    command: ["node", "dist/main.js", "serve", "--host", "0.0.0.0", "--port", "19750"]

volumes:
  companion-data:
```

移除文件顶部关于 `127.0.0.1` 限制的注释（已解决）。

## 三、验收门槛

### 功能验证

- [ ] `pnpm dev:companion` 仍正常工作（local 模式，监听 127.0.0.1，行为同阶段二）
- [ ] `gpt-image-studio serve --host 0.0.0.0 --port 19750` 在 local 模式下**忽略** host 仍监听 127.0.0.1（打印 warning）
- [ ] `COMPANION_DEPLOYMENT_MODE=server gpt-image-studio serve` 监听 `0.0.0.0`，可从其他主机访问
- [ ] `gpt-image-studio serve --deployment-mode server --host 127.0.0.1` 显式指定 host 生效
- [ ] `gpt-image-studio status` 展示 host 和 mode 字段

### Docker 验证

- [ ] `docker build --target companion -t gpt-image-studio-companion:test .` 成功
- [ ] `docker run -p 19750:19750 -v companion-data:/data gpt-image-studio-companion:test` 启动后，宿主 `curl http://127.0.0.1:19750/health` 返回 200 + version
- [ ] 容器重启后 `/data` 数据持久化（写入一条数据 → 重启 → 数据仍在）
- [ ] `docker compose --profile companion up` 启动 companion 服务可访问

### 回归验证

- [ ] `pnpm test` 全绿（1003+ tests）
- [ ] `pnpm typecheck` + `pnpm typecheck:companion` 无错
- [ ] 阶段二所有功能（存储位置切换、数据集管理、OSS 配置、Companion 连接）行为不变

## 四、新增测试

**新建 `companion/src/deploymentConfig.test.ts`**：
- `resolveDeploymentConfig()` 默认 local + 127.0.0.1
- `mode: "server"` + 无 host → 0.0.0.0
- `mode: "local"` + 传入 host → 忽略，仍 127.0.0.1（打印 warning）
- `mode: "server"` + 传入 host → 用传入 host
- 非法 mode 值 → 抛错
- 环境变量 `COMPANION_DEPLOYMENT_MODE`/`COMPANION_HOST` 优先级（env > opts > default）

## 五、回滚策略

本 PR 纯增量（新文件 `deploymentConfig.ts` + 参数透传），无破坏性改动。回滚 = `git revert`。revert 后回到阶段二硬编码 `127.0.0.1` 行为，Docker companion stage 重新变为注释状态。

## 六、实施记录

> （PR 合并后填写：实际改了什么、与计划的偏差、遗留问题）
