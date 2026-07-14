import type {
  CompanionAuthStatusResult,
  CompanionAuthStatus,
  CompanionHealthResponse,
  CompanionProviderPreset,
  CompanionCredentialsView,
  CompanionCredentialsSaveInput,
  CompanionCredentialsSaveResponse,
  CompanionCredentialsClearResponse,
  CompanionLogsTailResponse,
} from "../types/companion";

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

// ---- 凭证管理（GET /credentials/presets、GET/POST/DELETE /credentials）----
// 凭证接口不走连接密钥——companion 侧用 loopback 来源校验，等同 CLI login 的信任模型。

export async function getCompanionPresets(
  url: string,
): Promise<CompanionProviderPreset[]> {
  const res = await fetch(`${url}/credentials/presets`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error("无法获取 provider 列表");
  return await res.json();
}

export async function getCompanionCredentials(
  url: string,
): Promise<CompanionCredentialsView> {
  const res = await fetch(`${url}/credentials`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error("无法获取当前凭据");
  return await res.json();
}

export async function saveCompanionCredentials(
  url: string,
  input: CompanionCredentialsSaveInput,
): Promise<CompanionCredentialsSaveResponse> {
  const res = await fetch(`${url}/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let message = "保存凭据失败";
    try {
      const data = (await res.json()) as { error?: string };
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }
  return await res.json();
}

export async function clearCompanionCredentials(
  url: string,
): Promise<CompanionCredentialsClearResponse> {
  const res = await fetch(`${url}/credentials`, { method: "DELETE" });
  if (!res.ok) throw new Error("清除凭据失败");
  return await res.json();
}

// ---- 日志查看（GET /logs/tail，需连接密钥）----

export async function getCompanionLogs(
  url: string,
  accessKey: string,
  params: { lines?: number; date?: string } = {},
): Promise<CompanionLogsTailResponse> {
  const search = new URLSearchParams();
  if (params.lines) search.set("lines", String(params.lines));
  if (params.date) search.set("date", params.date);
  const query = search.toString();
  const res = await fetch(`${url}/logs/tail${query ? `?${query}` : ""}`, {
    headers: { Authorization: `Bearer ${accessKey}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error("无法获取日志");
  return await res.json();
}
