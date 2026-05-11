import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationDraft } from "../types/studio";
import {
  deleteConversationDraft,
  deleteConversationDrafts,
  listConversationDrafts,
  loadConversationDraft,
  saveConversationDraft,
} from "./conversationDrafts";
import { STORE_NAMES } from "./db";

const mocks = vi.hoisted(() => ({
  deleteFromStore: vi.fn(),
  getAllFromStore: vi.fn(),
  getFromStore: vi.fn(),
  putInStore: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    deleteFromStore: mocks.deleteFromStore,
    getAllFromStore: mocks.getAllFromStore,
    getFromStore: mocks.getFromStore,
    putInStore: mocks.putInStore,
  };
});

const draft: ConversationDraft = {
  conversationId: "c-1",
  composerText: "一只猫",
  attachedImageIds: ["img-1"],
  generationParams: {
    size: "1024x1024",
    width: 1024,
    height: 1024,
    quality: "auto",
    background: "auto",
    outputFormat: "png",
  },
  updatedAtMs: 123,
};

describe("conversationDrafts service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads draft by conversation id", async () => {
    mocks.getFromStore.mockResolvedValue(draft);

    const result = await loadConversationDraft("c-1");

    expect(mocks.getFromStore).toHaveBeenCalledWith(
      STORE_NAMES.conversationDrafts,
      "c-1",
    );
    expect(result).toEqual(draft);
  });

  it("saves draft record", async () => {
    mocks.putInStore.mockResolvedValue(undefined);

    await saveConversationDraft(draft);

    expect(mocks.putInStore).toHaveBeenCalledWith(
      STORE_NAMES.conversationDrafts,
      draft,
    );
  });

  it("deletes single draft", async () => {
    mocks.deleteFromStore.mockResolvedValue(undefined);

    await deleteConversationDraft("c-1");

    expect(mocks.deleteFromStore).toHaveBeenCalledWith(
      STORE_NAMES.conversationDrafts,
      "c-1",
    );
  });

  it("deletes multiple drafts", async () => {
    mocks.deleteFromStore.mockResolvedValue(undefined);

    await deleteConversationDrafts(["c-1", "c-2"]);

    expect(mocks.deleteFromStore).toHaveBeenCalledTimes(2);
    expect(mocks.deleteFromStore).toHaveBeenNthCalledWith(
      1,
      STORE_NAMES.conversationDrafts,
      "c-1",
    );
    expect(mocks.deleteFromStore).toHaveBeenNthCalledWith(
      2,
      STORE_NAMES.conversationDrafts,
      "c-2",
    );
  });

  it("lists all drafts", async () => {
    mocks.getAllFromStore.mockResolvedValue([draft]);

    const result = await listConversationDrafts();

    expect(mocks.getAllFromStore).toHaveBeenCalledWith(
      STORE_NAMES.conversationDrafts,
    );
    expect(result).toEqual([draft]);
  });
});
