import type {
  CompanionAuthStatusResult,
  CompanionAuthStatus,
  CompanionHealthResponse,
  PairConfirmResponse,
  PairStartResponse,
  PairUnpairResponse,
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
  sessionToken: string,
): Promise<CompanionAuthStatus | null> {
  const result = await getCompanionAuthStatusResult(url, sessionToken);
  return result.ok ? result.status : null;
}

export async function getCompanionAuthStatusResult(
  url: string,
  sessionToken: string,
): Promise<CompanionAuthStatusResult> {
  if (!sessionToken) return { ok: false, invalidToken: false };
  try {
    const res = await fetch(`${url}/auth/status`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 401) return { ok: false, invalidToken: true };
    if (!res.ok) return { ok: false, invalidToken: false };
    return { ok: true, status: await res.json() };
  } catch {
    return { ok: false, invalidToken: false };
  }
}

export async function startPairing(url: string): Promise<PairStartResponse> {
  const res = await fetch(`${url}/pair/start`, { method: "POST" });
  if (!res.ok) {
    let message = "发起配对失败";
    try {
      const data = await res.json() as { error?: string };
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }
  return await res.json();
}

export async function confirmPairing(
  url: string,
  pairingCode: string,
): Promise<PairConfirmResponse> {
  const res = await fetch(`${url}/pair/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairingCode }),
  });
  if (!res.ok) throw new Error("配对码无效或已过期");
  return await res.json();
}

export async function unpairCompanion(
  url: string,
  sessionToken: string,
): Promise<PairUnpairResponse> {
  const res = await fetch(`${url}/pair/unpair`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!res.ok) throw new Error("解除配对失败");
  return await res.json();
}
