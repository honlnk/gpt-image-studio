import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import { useGenerationStore } from "./generationStore";
import type {
  Conversation,
  GenerationParams,
  ImageAsset,
  Message,
  PromptRequestSettings,
} from "../types/studio";
import type { ImageClient } from "../features/generation/imageClients/imageClient";

// generationStore 通过 context 注入依赖。这里构造一份最小可用 fixture，
// 只让 submitMessage 的前置拦截路径能跑通；其余依赖按需 spy/resolve。
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

function makeParams(): GenerationParams {
  return {
    size: "1:1",
    resolution: "1k",
    width: 1024,
    height: 1024,
    imageCount: 1,
    quality: "auto",
    background: "auto",
    outputFormat: "png",
  };
}

function makePromptRequestSettings(): PromptRequestSettings {
  return {
    promptMode: "default",
    promptWordbanks: {
      pose: { safe: [], creative: [], nsfw: [] },
      adultInspiration: [],
    },
    promptRewriteGuardEnabled: false,
    promptRewriteGuardText: "",
  };
}

function makeConversation(): Conversation {
  return {
    id: "conv-1",
    title: "t",
    summary: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

type ContextOverrides = {
  supportsEdit?: boolean;
  attachedImages?: string[];
  composerText?: string;
};

function buildContext(overrides: ContextOverrides = {}) {
  const supportsEdit = overrides.supportsEdit ?? true;
  const attachedImages = ref<string[]>(overrides.attachedImages ?? []);
  const composerText = ref(overrides.composerText ?? "一只猫");
  const imageClient: ImageClient = {
    generate: vi.fn().mockResolvedValue({ b64Json: "b64" }),
    edit: vi.fn().mockResolvedValue({ b64Json: "b64" }),
  };
  const notifyUnsupportedEdit = vi.fn();
  // 带一张真实可解析的引用图：transientBlob 让 requestImageEdit 能读到字节，
  // 从而真正走到 imageClient.edit（OpenAI 支持图生图场景的断言依赖它）。
  const imageAssets = ref<ImageAsset[]>([
    {
      id: "img-1",
      blobKey: "blob-1",
      name: "ref",
      source: "generated",
      mimeType: "image/png",
      sizeBytes: 1,
      prompt: "ref",
      transientBlob: new Blob(["x"], { type: "image/png" }),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  const messages = ref<Message[]>([]);
  const store = useGenerationStore();
  store.configureGenerationStore({
    activeConversationId: ref("conv-1"),
    activeConversation: computed(() => undefined),
    attachedImages,
    activeEditMaskImageId: ref(""),
    activeEditSourceImageId: ref(""),
    composerText,
    createConversationRecord: vi.fn().mockResolvedValue(makeConversation()),
    currentGenerationParams: makeParams,
    currentPromptRequestSettings: makePromptRequestSettings,
    customSizeError: computed(() => ""),
    imageAssets,
    imageById: (id) => imageAssets.value.find((a) => a.id === id),
    imageClient,
    messages,
    supportsEdit: computed(() => supportsEdit),
    notifyUnsupportedEdit,
    onApiConfigurationError: vi.fn(),
    onStorageError: vi.fn(),
    conversationExists: () => true,
    persistConversation: vi.fn().mockResolvedValue(undefined),
    refreshStorageUsage: vi.fn().mockResolvedValue(undefined),
    updateConversationSummary: vi.fn().mockReturnValue(null),
  });
  return { store, imageClient, notifyUnsupportedEdit, messages };
}

describe("generationStore submitMessage 图生图前置拦截", () => {
  it("provider 不支持图生图且带了参考图：提示并中止，不发请求", async () => {
    const { store, imageClient, notifyUnsupportedEdit, messages } = buildContext({
      supportsEdit: false,
      attachedImages: ["img-1"],
      composerText: "把背景改成星空",
    });

    await store.submitMessage();

    expect(notifyUnsupportedEdit).toHaveBeenCalledTimes(1);
    expect(imageClient.edit).not.toHaveBeenCalled();
    expect(imageClient.generate).not.toHaveBeenCalled();
    // 拦截后不应产生任何消息（既无 user 也无 assistant）
    expect(messages.value).toHaveLength(0);
  });

  it("provider 支持图生图且带参考图：不拦截，走 edit", async () => {
    const { store, imageClient, notifyUnsupportedEdit } = buildContext({
      supportsEdit: true,
      attachedImages: ["img-1"],
      composerText: "把背景改成星空",
    });

    await store.submitMessage();

    expect(notifyUnsupportedEdit).not.toHaveBeenCalled();
    // edit 链路会尝试读取引用图字节，这里 imageById 返回 undefined 会抛错，
    // 但关键断言是「没被拦截」——edit 被调用过即说明走到了图生图分支。
    await vi.waitFor(() => {
      expect(imageClient.edit).toHaveBeenCalled();
    });
  });

  it("provider 不支持图生图但无参考图（纯文生图）：不拦截，走 generate", async () => {
    const { store, imageClient, notifyUnsupportedEdit } = buildContext({
      supportsEdit: false,
      attachedImages: [],
      composerText: "一只在月球上的猫",
    });

    await store.submitMessage();

    expect(notifyUnsupportedEdit).not.toHaveBeenCalled();
    expect(imageClient.edit).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(imageClient.generate).toHaveBeenCalled();
    });
  });

  it("canSend 为 false（空文本且无参考图）：早返回，不触发拦截提示", async () => {
    const { store, notifyUnsupportedEdit, imageClient } = buildContext({
      supportsEdit: false,
      attachedImages: [],
      composerText: "",
    });

    await store.submitMessage();

    expect(notifyUnsupportedEdit).not.toHaveBeenCalled();
    expect(imageClient.generate).not.toHaveBeenCalled();
  });
});
