import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".gpt-image-studio");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");

type Credentials = {
  apiBaseUrl: string;
  apiKey: string;
  savedAt: string;
};

export function loadCredentials(): Credentials | null {
  try {
    if (!existsSync(CREDENTIALS_FILE)) return null;
    const data: Credentials = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
    if (!data.apiBaseUrl || !data.apiKey) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveCredentials(apiBaseUrl: string, apiKey: string): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const data: Credentials = { apiBaseUrl, apiKey, savedAt: new Date().toISOString() };
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(CREDENTIALS_FILE, 0o600);
}

export function clearCredentials(): void {
  try {
    if (existsSync(CREDENTIALS_FILE)) {
      unlinkSync(CREDENTIALS_FILE);
    }
  } catch {}
}

export function hasCredentials(): boolean {
  return loadCredentials() !== null;
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return "***";
  return apiKey.slice(0, 8) + "***";
}
