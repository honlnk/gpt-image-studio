/**
 * OSS 凭据管理（阿里云 OSS AccessKey）。
 *
 * 独立文件 ~/.gpt-image-studio/oss-credentials.json（0600），不与 provider 凭据
 * credentials.json 混。理由：OSS 凭据是「存储层」的凭证，provider 凭据是「模型调用层」
 * 的凭证，职责正交，分开管理更清晰。
 *
 * 本机模式（阶段二）存长期 AccessKey；服务器模式（阶段三）改为 STS 临时凭证（D11），
 * 本模块届时会被 STS 客户端替代。
 *
 * 安全：
 * - 明文 JSON + 0600 文件权限（与 credentials.json 同级别）。
 * - 不进项目备份（备份只导出业务数据，不含任何凭据）。
 * - GET 接口不返回 accessKeySecret（只返回 endpoint/bucket 让前端显示配置状态）。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR =
  process.env.GPT_IMAGE_STUDIO_CONFIG_DIR ?? join(homedir(), ".gpt-image-studio");
const OSS_CREDENTIALS_FILE = join(CONFIG_DIR, "oss-credentials.json");

export type OssCredentials = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  /** 配置时间，ISO。 */
  configuredAt?: string;
};

/** GET 接口返回的视图（剥离 accessKeySecret）。 */
export type OssCredentialsView = {
  endpoint: string;
  bucket: string;
  accessKeyIdMasked: string;
  configured: true;
  configuredAt?: string;
};

/** 读取 OSS 凭据。未配置返回 undefined（不抛错）。 */
export function loadOssCredentials(): OssCredentials | undefined {
  if (!existsSync(OSS_CREDENTIALS_FILE)) return undefined;
  try {
    const raw = readFileSync(OSS_CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<OssCredentials>;
    if (
      typeof parsed.endpoint !== "string" ||
      typeof parsed.bucket !== "string" ||
      typeof parsed.accessKeyId !== "string" ||
      typeof parsed.accessKeySecret !== "string"
    ) {
      return undefined;
    }
    return parsed as OssCredentials;
  } catch {
    return undefined;
  }
}

/** 保存 OSS 凭据（0600）。覆盖式写入。 */
export function saveOssCredentials(creds: OssCredentials): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const data: OssCredentials = {
    ...creds,
    configuredAt: new Date().toISOString(),
  };
  writeFileSync(OSS_CREDENTIALS_FILE, JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
  chmodSync(OSS_CREDENTIALS_FILE, 0o600);
}

/** 删除 OSS 凭据文件。不存在是 no-op。 */
export function clearOssCredentials(): void {
  if (existsSync(OSS_CREDENTIALS_FILE)) {
    try {
      unlinkSync(OSS_CREDENTIALS_FILE);
    } catch {
      // 删除失败不阻断
    }
  }
}

/** 返回脱敏视图（GET 接口用，不泄露 accessKeySecret）。 */
export function toOssCredentialsView(creds: OssCredentials): OssCredentialsView {
  const masked = maskAccessKeyId(creds.accessKeyId);
  return {
    endpoint: creds.endpoint,
    bucket: creds.bucket,
    accessKeyIdMasked: masked,
    configured: true,
    configuredAt: creds.configuredAt,
  };
}

function maskAccessKeyId(key: string): string {
  if (key.length <= 6) return "***";
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}
