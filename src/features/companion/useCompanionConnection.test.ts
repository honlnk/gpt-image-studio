import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import type { Ref } from "vue";
import { useCompanionConnection } from "./useCompanionConnection";
import type {
  CompanionAuthStatus,
  CompanionHealthResponse,
} from "../../types/companion";

// vi.mock 必须在顶层：用 hoisted 工厂拿到可控的 mock 引用。
const mocks = vi.hoisted(() => ({
  checkCompanionHealth: vi.fn(),
  getCompanionAuthStatusResult: vi.fn(),
  getCompanionAuthStatus: vi.fn(),
}));

vi.mock("../../services/companionApi", () => ({
  checkCompanionHealth: mocks.checkCompanionHealth,
  getCompanionAuthStatusResult: mocks.getCompanionAuthStatusResult,
  getCompanionAuthStatus: mocks.getCompanionAuthStatus,
}));

const HEALTH_ONLINE: CompanionHealthResponse = {
  app: "gpt-image-studio-companion",
  version: "1.2.3",
};

function makeStatus(
  overrides: Partial<CompanionAuthStatus> = {},
): CompanionAuthStatus {
  return {
    provider: "openai",
    mode: "api_key",
    ready: true,
    accountLabel: "sk-a***",
    model: "gpt-image-2",
    capability: {
      generate: true,
      edit: true,
      mask: true,
      backgrounds: ["auto", "opaque"],
      outputFormats: ["png", "webp", "jpeg"],
    },
    sizeConstraints: {
      step: 16,
      min: 16,
      max: 3840,
      maxPixels: 8294400,
      minPixels: 655360,
      maxAspectRatio: 3,
      defaultSize: "1024x1024",
    },
    resolutionOptions: [
      { value: "1k", label: "1K", targetPixels: 1024 * 1024 },
      { value: "2k", label: "2K", targetPixels: 2048 * 2048 },
      { value: "4k", label: "4K", targetPixels: 3840 * 2160 },
    ],
    ...overrides,
  };
}

type Options = {
  connectionMode?: "direct" | "localCompanion";
  companionUrl?: string;
  companionAccessKey?: string;
};

/**
 * 用 effectScope 调用 composable：watch（含 immediate）在 setup 内同步注册并 flush，
 * 无需组件挂载、不依赖 DOM 环境。返回 composable 返回值 + 注入的 refs/callbacks。
 */
function setupComposable(options: Options = {}) {
  const scope = effectScope();
  const connectionMode = ref(options.connectionMode ?? "localCompanion");
  const companionUrl = ref(options.companionUrl ?? "http://127.0.0.1:19750");
  const companionAccessKey = ref(options.companionAccessKey ?? "test-key-1");
  const onClearAccessKey = vi.fn();
  const onApplyProviderInfo = vi.fn();
  const onAccessKeyAcquired = vi.fn();

  const result = scope.run(() =>
    useCompanionConnection({
      connectionMode: connectionMode as Ref<"direct" | "localCompanion">,
      companionUrl,
      companionAccessKey,
      onClearAccessKey,
      onApplyProviderInfo,
      onAccessKeyAcquired,
    }),
  )!;

  return {
    result,
    scope,
    refs: { connectionMode, companionUrl, companionAccessKey },
    onClearAccessKey,
    onApplyProviderInfo,
    onAccessKeyAcquired,
  };
}

describe("useCompanionConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("probes immediately when connectionMode is localCompanion", async () => {
    mocks.checkCompanionHealth.mockResolvedValue(HEALTH_ONLINE);
    mocks.getCompanionAuthStatusResult.mockResolvedValue({
      ok: true,
      status: makeStatus({ model: "glm-image" }),
    });

    const { onApplyProviderInfo } = setupComposable();
    await vi.waitFor(() => {
      expect(mocks.checkCompanionHealth).toHaveBeenCalledTimes(1);
      expect(mocks.getCompanionAuthStatusResult).toHaveBeenCalledTimes(1);
    });

    expect(onApplyProviderInfo).toHaveBeenCalledWith(
      expect.objectContaining({ model: "glm-image" }),
    );
  });

  it("does not probe when connectionMode is direct", async () => {
    mocks.checkCompanionHealth.mockResolvedValue(HEALTH_ONLINE);

    setupComposable({ connectionMode: "direct" });

    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.checkCompanionHealth).not.toHaveBeenCalled();
  });

  it("re-probes when switching to localCompanion", async () => {
    mocks.checkCompanionHealth.mockResolvedValue(null);

    const { refs } = setupComposable({ connectionMode: "direct" });
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.checkCompanionHealth).not.toHaveBeenCalled();

    refs.connectionMode.value = "localCompanion";
    await vi.waitFor(() => {
      expect(mocks.checkCompanionHealth).toHaveBeenCalledTimes(1);
    });
  });

  it("clears access key when auth/status returns 401 (invalidToken)", async () => {
    mocks.checkCompanionHealth.mockResolvedValue(HEALTH_ONLINE);
    mocks.getCompanionAuthStatusResult.mockResolvedValue({
      ok: false,
      invalidToken: true,
    });

    const { onClearAccessKey, onApplyProviderInfo } = setupComposable();
    await vi.waitFor(() => {
      expect(onClearAccessKey).toHaveBeenCalledTimes(1);
    });
    expect(onApplyProviderInfo).toHaveBeenCalledWith(null);
  });

  it("connects successfully with a valid key", async () => {
    mocks.checkCompanionHealth.mockResolvedValue(HEALTH_ONLINE);
    mocks.getCompanionAuthStatus.mockResolvedValue(makeStatus());

    const { result, onAccessKeyAcquired, onApplyProviderInfo } = setupComposable({
      companionAccessKey: "",
    });

    await result.connectWithKey("valid-uuid-key");
    expect(onAccessKeyAcquired).toHaveBeenCalledWith("valid-uuid-key");
    expect(onApplyProviderInfo).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai" }),
    );
  });

  it("clears access key and reports error when key is invalid", async () => {
    mocks.checkCompanionHealth.mockResolvedValue(HEALTH_ONLINE);
    mocks.getCompanionAuthStatus.mockResolvedValue(null);

    const { result, onAccessKeyAcquired, onClearAccessKey } = setupComposable({
      companionAccessKey: "",
    });

    await result.connectWithKey("bad-key");
    expect(onAccessKeyAcquired).toHaveBeenCalledWith("bad-key");
    expect(onClearAccessKey).toHaveBeenCalledTimes(1);
    expect(result.connectError.value).toContain("密钥无效");
  });

  it("reports error when companion is offline during connect", async () => {
    mocks.checkCompanionHealth.mockResolvedValue(null);

    const { result, onClearAccessKey } = setupComposable({
      companionAccessKey: "",
    });

    await result.connectWithKey("some-key");
    expect(onClearAccessKey).toHaveBeenCalledTimes(1);
    expect(result.connectError.value).toContain("无法连接");
  });

  it("disconnect clears access key locally without backend call", async () => {
    const { result, onClearAccessKey, onApplyProviderInfo } = setupComposable();

    result.disconnect();
    expect(onClearAccessKey).toHaveBeenCalledTimes(1);
    expect(onApplyProviderInfo).toHaveBeenCalledWith(null);
  });
});
