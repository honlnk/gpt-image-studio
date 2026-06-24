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
  startPairing: vi.fn(),
  confirmPairing: vi.fn(),
  unpairCompanion: vi.fn(),
}));

vi.mock("../../services/companionApi", () => ({
  checkCompanionHealth: mocks.checkCompanionHealth,
  getCompanionAuthStatusResult: mocks.getCompanionAuthStatusResult,
  getCompanionAuthStatus: mocks.getCompanionAuthStatus,
  startPairing: mocks.startPairing,
  confirmPairing: mocks.confirmPairing,
  unpairCompanion: mocks.unpairCompanion,
}));

const HEALTH_ONLINE: CompanionHealthResponse = {
  app: "gpt-image-studio-companion",
  version: "1.2.3",
  paired: true,
  runMode: "serve",
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
  companionSessionToken?: string;
};

/**
 * 用 effectScope 调用 composable：watch（含 immediate）在 setup 内同步注册并 flush，
 * 无需组件挂载、不依赖 DOM 环境。返回 composable 返回值 + 注入的 refs/callbacks。
 */
function setupComposable(options: Options = {}) {
  const scope = effectScope();
  const connectionMode = ref(options.connectionMode ?? "localCompanion");
  const companionUrl = ref(options.companionUrl ?? "http://127.0.0.1:19750");
  const companionSessionToken = ref(options.companionSessionToken ?? "tok-1");
  const onClearSessionToken = vi.fn();
  const onApplyProviderInfo = vi.fn();
  const onSessionTokenAcquired = vi.fn();

  const result = scope.run(() =>
    useCompanionConnection({
      connectionMode: connectionMode as Ref<"direct" | "localCompanion">,
      companionUrl,
      companionSessionToken,
      onClearSessionToken,
      onApplyProviderInfo,
      onSessionTokenAcquired,
    }),
  )!;

  return {
    result,
    scope,
    refs: { connectionMode, companionUrl, companionSessionToken },
    onClearSessionToken,
    onApplyProviderInfo,
    onSessionTokenAcquired,
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

  it("clears session token when health reports paired=false", async () => {
    mocks.checkCompanionHealth.mockResolvedValue({
      ...HEALTH_ONLINE,
      paired: false,
    });

    const { onClearSessionToken, onApplyProviderInfo } = setupComposable();
    await vi.waitFor(() => {
      expect(onClearSessionToken).toHaveBeenCalledTimes(1);
    });
    expect(onApplyProviderInfo).toHaveBeenCalledWith(null);
  });

  it("clears session token when auth/status returns 401 (invalidToken)", async () => {
    mocks.checkCompanionHealth.mockResolvedValue(HEALTH_ONLINE);
    mocks.getCompanionAuthStatusResult.mockResolvedValue({
      ok: false,
      invalidToken: true,
    });

    const { onClearSessionToken, onApplyProviderInfo } = setupComposable();
    await vi.waitFor(() => {
      expect(onClearSessionToken).toHaveBeenCalledTimes(1);
    });
    expect(onApplyProviderInfo).toHaveBeenCalledWith(null);
  });
});
