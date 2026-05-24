import type {
  CompanionAuthStatus,
  CompanionHealthResponse,
  PairConfirmResponse,
  PairStartResponse,
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
  if (!sessionToken) return null;
  try {
    const res = await fetch(`${url}/auth/status`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function startPairing(url: string): Promise<PairStartResponse> {
  const res = await fetch(`${url}/pair/start`, { method: "POST" });
  if (!res.ok) throw new Error("发起配对失败");
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
