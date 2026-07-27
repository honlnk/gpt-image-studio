import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationDraft } from "../types/studio";
import {
  createSpyStorage,
  type SpyStorage,
} from "./storage/createSpyStorage";

const spyStorage: SpyStorage = createSpyStorage();

vi.mock("./storage/resolveStorage", () => ({
  resolveStorage: () => spyStorage,
}));

const {
  deleteConversationDraft,
  deleteConversationDrafts,
  listConversationDrafts,
  loadConversationDraft,
  saveConversationDraft,
} = await import("./conversationDrafts");
const { STORE_NAMES } = await import("./storage");

const draft: ConversationDraft = {
  conversationId: "c-1",
  composerText: "一只猫",
  attachedImageIds: ["img-1"],
  editModeEnabled: false,
  generationParams: {
    size: "1:1",
    resolution: "1k",
    width: 1024,
    height: 1024,
    imageCount: 1,
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
    spyStorage.get.mockResolvedValue(draft);

    const result = await loadConversationDraft("c-1");

    expect(spyStorage.get).toHaveBeenCalledWith(
      STORE_NAMES.conversationDrafts,
      "c-1",
    );
    expect(result).toEqual(draft);
  });

  it("saves draft record", async () => {
    await saveConversationDraft(draft);

    expect(spyStorage.put).toHaveBeenCalledWith(
      STORE_NAMES.conversationDrafts,
      draft,
    );
  });

  it("deletes single draft", async () => {
    await deleteConversationDraft("c-1");

    expect(spyStorage.delete).toHaveBeenCalledWith(
      STORE_NAMES.conversationDrafts,
      "c-1",
    );
  });

  it("deletes multiple drafts", async () => {
    await deleteConversationDrafts(["c-1", "c-2"]);

    expect(spyStorage.delete).toHaveBeenCalledTimes(2);
    expect(spyStorage.delete).toHaveBeenNthCalledWith(
      1,
      STORE_NAMES.conversationDrafts,
      "c-1",
    );
    expect(spyStorage.delete).toHaveBeenNthCalledWith(
      2,
      STORE_NAMES.conversationDrafts,
      "c-2",
    );
  });

  it("lists all drafts", async () => {
    spyStorage.list.mockResolvedValue([draft]);

    const result = await listConversationDrafts();

    expect(spyStorage.list).toHaveBeenCalledWith(
      STORE_NAMES.conversationDrafts,
    );
    expect(result).toEqual([draft]);
  });
});
