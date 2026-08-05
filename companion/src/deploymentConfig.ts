import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 部署形态配置（阶段三 PR1 引入）。
 *
 * 阶段三让 Companion 从"单机 loopback"升级为"可远程访问的网络服务"。
 * 通过 `mode` 区分两种部署形态，控制监听地址等行为：
 *   - `local`（默认，向后兼容阶段二）：恒监听 127.0.0.1，行为与阶段二完全一致。
 *   - `server`：监听地址可配置（默认 0.0.0.0），后续 PR 接入 JWT / 多租户 / STS。
 *
 * 本 PR 只解析 mode/host，server 模式行为暂时与 local 一致（PR2 起接入 JWT）。
 */
export type DeploymentMode = "local" | "server";

export type DeploymentConfig = {
  mode: DeploymentMode;
  /** 监听地址：local 恒为 127.0.0.1，server 可配（默认 0.0.0.0）。 */
  host: string;
  /**
   * 数据根目录。显式 GPT_IMAGE_STUDIO_CONFIG_DIR 优先；默认按部署形态隔离：
   * local = ~/.gpt-image-studio，server = ~/.gpt-image-studio-docker。
   */
  dataDir: string;
};

/** local 模式忽略用户传入的 host 时打印的 warning（仅在显式传 host 时触发）。 */
export class HostIgnoredWarning {
  constructor(public readonly requestedHost: string, public readonly reason: string) {}
}

const LOCAL_HOST = "127.0.0.1";
const SERVER_DEFAULT_HOST = "0.0.0.0";

/**
 * 解析部署形态配置。优先级：环境变量 > opts 参数 > 默认值。
 *
 * local 模式下 host 恒为 127.0.0.1（本机信任模型不可破坏）；若用户显式传了 host，
 * 返回的 config 仍是 127.0.0.1，但通过 warning 回调让调用方打印提示。
 */
export function resolveDeploymentConfig(
  opts: {
    mode?: string;
    host?: string;
  } = {},
  onWarning?: (w: HostIgnoredWarning) => void,
): DeploymentConfig {
  const mode = resolveMode(
    process.env.COMPANION_DEPLOYMENT_MODE ?? opts.mode ?? "local",
  );
  const dataDir = process.env.GPT_IMAGE_STUDIO_CONFIG_DIR ?? defaultDataDir(mode);
  const requestedHost = process.env.COMPANION_HOST ?? opts.host;

  if (mode === "local") {
    if (requestedHost && requestedHost !== LOCAL_HOST) {
      onWarning?.(
        new HostIgnoredWarning(
          requestedHost,
          "local 模式恒监听 127.0.0.1（本机信任模型），忽略传入的 --host。如需远程访问请用 --deployment-mode server。",
        ),
      );
    }
    return { mode, host: LOCAL_HOST, dataDir };
  }

  // server 模式
  return {
    mode,
    host: requestedHost ?? SERVER_DEFAULT_HOST,
    dataDir,
  };
}

function resolveMode(value: string): DeploymentMode {
  if (value === "local" || value === "server") return value;
  throw new Error(
    `无效的部署形态：${value}（仅支持 local 或 server，检查 COMPANION_DEPLOYMENT_MODE 环境变量或 --deployment-mode 参数）`,
  );
}

function defaultDataDir(mode: DeploymentMode): string {
  // local/server 使用独立默认目录，避免两种运行形态互相读写凭据、SQLite 与图片数据。
  // Docker 显式设置 GPT_IMAGE_STUDIO_CONFIG_DIR=/data，不经过这里。
  return join(
    homedir(),
    mode === "server" ? ".gpt-image-studio-docker" : ".gpt-image-studio",
  );
}
