export function createId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.() ?? fallbackId();
  return `${prefix}-${uuid}`;
}

function fallbackId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
