import type {
  CompanionAuthStatusResult,
  CompanionAuthStatus,
  CompanionHealthResponse,
} from "../types/companion";
import { COMPANION_DEFAULT_PORT, COMPANION_HEALTH_TIMEOUT_MS } from "../shared/constants";

/**
 * Companion 连接相关 API（健康检查 + auth/status 探测）。
 *
 * 阶段零之后，provider 凭据管理已迁移到 Companion 自带管理页
 * （127.0.0.1:${COMPANION_DEFAULT_PORT}/admin），
 * Web 项目不再触碰凭据，只保留以下两个能力感知端点——驱动 ChatWorkspace 的状态徽标
 * 和 localCompanion 模式下的 provider 能力/尺寸约束渲染。
 *
 * 这两个端点都需要 accessKey（走 Companion 的 authMiddleware bearer 守卫）。
 */

export async function checkCompanionHealth(
  url: string,
): Promise<CompanionHealthResponse | null> {
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(COMPANION_HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getCompanionAuthStatus(
  url: string,
  accessKey: string,
): Promise<CompanionAuthStatus | null> {
  const result = await getCompanionAuthStatusResult(url, accessKey);
  return result.ok ? result.status : null;
}

export async function getCompanionAuthStatusResult(
  url: string,
  accessKey: string,
): Promise<CompanionAuthStatusResult> {
  if (!accessKey) return { ok: false, invalidToken: false };
  try {
    const res = await fetch(`${url}/auth/status`, {
      headers: { Authorization: `Bearer ${accessKey}` },
      signal: AbortSignal.timeout(COMPANION_HEALTH_TIMEOUT_MS),
    });
    if (res.status === 401) return { ok: false, invalidToken: true };
    if (!res.ok) return { ok: false, invalidToken: false };
    return { ok: true, status: await res.json() };
  } catch {
    return { ok: false, invalidToken: false };
  }
}

// ─── 阶段二：存储数据集管理 API ───

/** 数据集视图（is_active 已转 boolean）。 */
export type DatasetView = {
  id: string;
  label: string;
  storage_kind: "filesystem" | "oss";
  storage_config: string;
  fingerprint: string;
  db_path: string;
  image_store_kind: "filesystem-default" | "filesystem-custom" | "oss";
  created_at: string;
  activated_at: string;
  is_active: boolean;
};

/** 获取当前激活数据集。 */
export async function getActiveDataset(
  url: string,
  accessKey: string,
): Promise<DatasetView | null> {
  try {
    const res = await fetch(`${url}/storage/datasets/active`, {
      headers: { Authorization: `Bearer ${accessKey}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.dataset as DatasetView;
  } catch {
    return null;
  }
}

/** 列出全部数据集。 */
export async function listDatasets(
  url: string,
  accessKey: string,
): Promise<DatasetView[]> {
  try {
    const res = await fetch(`${url}/storage/datasets`, {
      headers: { Authorization: `Bearer ${accessKey}` },
    });
    if (!res.ok) return [];
    const body = await res.json();
    return body.datasets as DatasetView[];
  } catch {
    return [];
  }
}

export type ActivateDatasetInput = {
  storageKind: "filesystem" | "oss";
  storageConfig: { directory: string } | { endpoint: string; bucket: string; prefix: string };
  imageStoreKind: "filesystem-default" | "filesystem-custom" | "oss";
  label?: string;
};

/** 激活/切换数据集。返回 { ok, dataset?, error? }。 */
export async function activateDataset(
  url: string,
  accessKey: string,
  input: ActivateDatasetInput,
): Promise<{ ok: true; dataset: DatasetView; created: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${url}/storage/datasets/activate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    const body = await res.json();
    return { ok: true, dataset: body.dataset, created: body.created };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── 阶段二：OSS 凭据管理 API（loopback 保护，本机调用） ───

export type OssCredentialsView = {
  endpoint: string;
  bucket: string;
  accessKeyIdMasked: string;
  configured: true;
  configuredAt?: string;
};

/** 获取 OSS 配置（脱敏）。未配置返回 null。 */
export async function getOssConfig(
  url: string,
): Promise<OssCredentialsView | null> {
  try {
    const res = await fetch(`${url}/storage/oss/config`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** 保存 OSS 配置（含连通性测试）。 */
export async function saveOssConfig(
  url: string,
  input: { endpoint: string; bucket: string; accessKeyId: string; accessKeySecret: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${url}/storage/oss/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
