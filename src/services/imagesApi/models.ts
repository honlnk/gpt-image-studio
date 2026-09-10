import { getApiErrorMessage } from "./http.js";

/**
 * 直连模式的 /models 探测：一次 GET 同时服务两个用途——
 * 验证 API key 是否有效（测试按钮）+ 拿到模型 id 列表（过滤模型下拉的可选项）。
 *
 * OpenAI 兼容中转基本都实现了 GET /v1/models（形状 { data: [{ id }] }），
 * 且比生成请求便宜（不消耗图片额度）。部分中转返回裸数组，做双形状兼容。
 */
export type DirectModelsProbeResult =
  | { ok: true; modelIds: string[] }
  | {
      ok: false;
      /** invalidKey：401/403，key 错误或失效；requestFailed：网络/上游其它错误。 */
      kind: "invalidKey" | "requestFailed";
      message: string;
    };

/**
 * 规整 models 端点，与 normalizeApiBaseUrl 同语义：
 * origin 模式补 /v1/models；full 模式把末尾的 images 段换成 models
 * （用户填的是完整 images 端点前缀，models 是它的兄弟路径）。
 */
export function buildModelsEndpoint(
  apiBaseUrl: string,
  apiBaseUrlMode: "origin" | "full",
) {
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  if (apiBaseUrlMode === "origin") {
    return `${trimmed}/v1/models`;
  }
  if (/\/images$/i.test(trimmed)) {
    return `${trimmed.slice(0, -"/images".length)}/models`;
  }
  return `${trimmed}/models`;
}

export async function probeDirectApiModels(input: {
  apiBaseUrl: string;
  apiBaseUrlMode: "origin" | "full";
  apiKey: string;
}): Promise<DirectModelsProbeResult> {
  if (!input.apiKey.trim()) {
    return { ok: false, kind: "invalidKey", message: "请先填写 API key。" };
  }
  const endpoint = buildModelsEndpoint(
    input.apiBaseUrl,
    input.apiBaseUrlMode,
  );
  if (!endpoint) {
    return { ok: false, kind: "requestFailed", message: "请先填写 API 地址。" };
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${input.apiKey.trim()}` },
    });
  } catch (error) {
    return {
      ok: false,
      kind: "requestFailed",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      kind: "invalidKey",
      message: await getApiErrorMessage(response),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      kind: "requestFailed",
      message: await getApiErrorMessage(response),
    };
  }

  const payload = await response.json().catch(() => null);
  return { ok: true, modelIds: extractModelIds(payload) };
}

/** 兼容 { data: [{ id }] } 与裸 [{ id }] 两种形状，去重保序。 */
function extractModelIds(payload: unknown): string[] {
  const data = (payload as { data?: unknown } | null)?.data;
  const list = Array.isArray(data)
    ? data
    : Array.isArray(payload)
      ? payload
      : [];

  const ids: string[] = [];
  for (const item of list) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id.trim() && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}
