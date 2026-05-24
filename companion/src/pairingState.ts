import { randomUUID, randomInt } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".gpt-image-studio");
const SESSION_FILE = join(CONFIG_DIR, "session.json");
const PAIRING_CODE_EXPIRY_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type SessionData = {
  token: string;
  createdAt: string;
  expiresAt: string;
};

let activePairingCode: string | null = null;
let pairingCodeExpiresAt: number = 0;
let sessionToken: string | null = null;
let sessionExpiresAt: number | null = null;

export function loadSession() {
  try {
    if (existsSync(SESSION_FILE)) {
      const data: SessionData = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
      if (!data.token || !data.expiresAt) {
        sessionToken = null;
        sessionExpiresAt = null;
        return;
      }
      const expiresAt = Date.parse(data.expiresAt);
      if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
        clearSession();
        return;
      }
      sessionToken = data.token;
      sessionExpiresAt = expiresAt;
    }
  } catch {
    sessionToken = null;
    sessionExpiresAt = null;
  }
}

function saveSession(token: string, ttlMs: number) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlMs);
  const data: SessionData = {
    token,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(SESSION_FILE, 0o600);
  sessionExpiresAt = expiresAt.getTime();
}

export function isPaired(): boolean {
  return getSessionInfo().paired;
}

export function getSessionInfo(): { paired: boolean; expiresAt: string | null } {
  if (!sessionToken || !sessionExpiresAt) {
    return { paired: false, expiresAt: null };
  }
  if (Date.now() >= sessionExpiresAt) {
    clearSession();
    return { paired: false, expiresAt: null };
  }
  return { paired: true, expiresAt: new Date(sessionExpiresAt).toISOString() };
}

export function startPairing(): { pairingCode: string; expiresInSeconds: number } {
  activePairingCode = String(randomInt(100000, 999999));
  pairingCodeExpiresAt = Date.now() + PAIRING_CODE_EXPIRY_MS;

  console.log("");
  console.log("┌─────────────────────────────────┐");
  console.log("│  配对码: " + activePairingCode + "                  │");
  console.log("│  请在网页端输入此配对码          │");
  console.log("│  有效期 5 分钟                   │");
  console.log("└─────────────────────────────────┘");
  console.log("");

  return {
    pairingCode: activePairingCode,
    expiresInSeconds: Math.floor(PAIRING_CODE_EXPIRY_MS / 1000),
  };
}

export function confirmPairing(
  code: string,
  ttlMs = DEFAULT_SESSION_TTL_MS,
): { sessionToken: string; expiresAt: string } | null {
  if (!activePairingCode) return null;
  if (Date.now() > pairingCodeExpiresAt) {
    activePairingCode = null;
    return null;
  }
  if (code !== activePairingCode) return null;

  activePairingCode = null;
  sessionToken = randomUUID();
  saveSession(sessionToken, ttlMs);

  console.log("配对成功！");
  return { sessionToken, expiresAt: getSessionInfo().expiresAt! };
}

export function validateToken(token: string): boolean {
  return getSessionInfo().paired && token === sessionToken;
}

export function clearSession() {
  sessionToken = null;
  sessionExpiresAt = null;
  try {
    if (existsSync(SESSION_FILE)) {
      unlinkSync(SESSION_FILE);
    }
  } catch {}
}
