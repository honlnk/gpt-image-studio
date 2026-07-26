import type {
  CompanionAuthStatusResult,
  CompanionAuthStatus,
  CompanionHealthResponse,
} from "../types/companion";

/**
 * Companion 连接相关 API（健康检查 + auth/status 探测）。
 *
 * 阶段零之后，provider 凭据管理已迁移到 Companion 自带管理页（127.0.0.1:19750/admin），
 * Web 项目不再触碰凭据，只保留以下两个能力感知端点——驱动 ChatWorkspace 的状态徽标
 * 和 localCompanion 模式下的 provider 能力/尺寸约束渲染。
 *
 * 这两个端点都需要 accessKey（走 Companion 的 authMiddleware bearer 守卫）。
 */

export async function checkCompanionHealth(
  url: string,
): Promise<CompanionHealthResponse | null> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
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
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 401) return { ok: false, invalidToken: true };
    if (!res.ok) return { ok: false, invalidToken: false };
    return { ok: true, status: await res.json() };
  } catch {
    return { ok: false, invalidToken: false };
  }
}
