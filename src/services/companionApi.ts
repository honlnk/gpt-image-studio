import type {
  CompanionAuthStatusResult,
  CompanionAuthStatus,
  CompanionHealthResponse,
  CompanionProviderPreset,
  CompanionCredentialsListResponse,
  CompanionCredentialInput,
  CompanionCredentialEntry,
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

// ---- 凭证管理（多配置 CRUD + 激活切换）----
// 凭证接口不走连接密钥——companion 侧用 loopback 来源校验，等同 CLI 的信任模型。

export async function getCompanionPresets(
  url: string,
): Promise<CompanionProviderPreset[]> {
  const res = await fetch(`${url}/credentials/presets`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error("无法获取 provider 列表");
  return await res.json();
}

export async function listCompanionCredentials(
  url: string,
): Promise<CompanionCredentialsListResponse> {
  const res = await fetch(`${url}/credentials`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) {
    // 凭据文件损坏时 companion 返 500 + { error, corrupt:true }；读 error 给用户可读原因，
    // 并在 Error 上 attach corrupt 标记，让上层 loadCredentials 能区分「损坏」与「普通失败」。
    // 其他非 200（罕见）退回通用文案，不带 corrupt 标记。
    let message = "无法获取凭据列表";
    let corrupt = false;
    try {
      const data = (await res.json()) as { error?: string; corrupt?: boolean };
      message = data.error || message;
      corrupt = data.corrupt === true;
    } catch {}
    throw Object.assign(new Error(message), { corrupt });
  }
  return await res.json();
}

export async function addCompanionCredential(
  url: string,
  input: CompanionCredentialInput,
): Promise<CompanionCredentialEntry> {
  const res = await fetch(`${url}/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let message = "新增凭据失败";
    try {
      const data = (await res.json()) as { error?: string };
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }
  const data = (await res.json()) as { entry: CompanionCredentialEntry };
  return data.entry;
}

export async function updateCompanionCredential(
  url: string,
  id: string,
  input: CompanionCredentialInput,
): Promise<CompanionCredentialEntry> {
  const res = await fetch(`${url}/credentials/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let message = "更新凭据失败";
    try {
      const data = (await res.json()) as { error?: string };
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }
  const data = (await res.json()) as { entry: CompanionCredentialEntry };
  return data.entry;
}

export async function removeCompanionCredential(
  url: string,
  id: string,
): Promise<void> {
  const res = await fetch(`${url}/credentials/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除凭据失败");
}

export async function activateCompanionCredential(
  url: string,
  id: string,
): Promise<void> {
  const res = await fetch(`${url}/credentials/${id}/activate`, { method: "POST" });
  if (!res.ok) throw new Error("激活凭据失败");
}

/**
 * 重置成空配置：写合法空 store + 清除损坏事件。
 * 失败时读 response body 的 error 给可读原因（如「重置凭据失败」+ 具体原因）。
 */
export async function resetEmptyCredentialStore(url: string): Promise<void> {
  const res = await fetch(`${url}/credentials/reset-empty`, { method: "POST" });
  if (!res.ok) {
    let message = "重置凭据失败";
    try {
      const data = (await res.json()) as { error?: string };
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }
}

/**
 * 从最近备份恢复：companion 找最新的 credentials.json.corrupt-{ts}.json 尝试恢复。
 * 成功时 void；失败时（如备份本身也坏了）抛 Error，message 含失败原因。
 */
export async function restoreBackupCredentialStore(url: string): Promise<void> {
  const res = await fetch(`${url}/credentials/restore-backup`, { method: "POST" });
  if (!res.ok) {
    let message = "恢复备份失败";
    try {
      const data = (await res.json()) as { error?: string };
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }
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
