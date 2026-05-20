import { randomUUID, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".gpt-image-studio");
const SESSION_FILE = join(CONFIG_DIR, "session.json");
const PAIRING_CODE_EXPIRY_MS = 5 * 60 * 1000;

type SessionData = {
  token: string;
  createdAt: string;
};

let activePairingCode: string | null = null;
let pairingCodeExpiresAt: number = 0;
let sessionToken: string | null = null;

export function loadSession() {
  try {
    if (existsSync(SESSION_FILE)) {
      const data: SessionData = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
      sessionToken = data.token;
    }
  } catch {
    sessionToken = null;
  }
}

function saveSession(token: string) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const data: SessionData = { token, createdAt: new Date().toISOString() };
  writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
}

export function isPaired(): boolean {
  return sessionToken !== null;
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

export function confirmPairing(code: string): { sessionToken: string } | null {
  if (!activePairingCode) return null;
  if (Date.now() > pairingCodeExpiresAt) {
    activePairingCode = null;
    return null;
  }
  if (code !== activePairingCode) return null;

  activePairingCode = null;
  sessionToken = randomUUID();
  saveSession(sessionToken);

  console.log("配对成功！");
  return { sessionToken };
}

export function validateToken(token: string): boolean {
  return sessionToken !== null && token === sessionToken;
}

export function clearSession() {
  sessionToken = null;
  try {
    if (existsSync(SESSION_FILE)) {
      writeFileSync(SESSION_FILE, "{}");
    }
  } catch {}
}
