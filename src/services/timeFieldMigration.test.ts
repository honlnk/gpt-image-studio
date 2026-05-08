import { describe, expect, it } from "vitest";
import type { Conversation, ImageAsset, Message } from "../types/studio";
import {
  normalizeConversationTimeFields,
  normalizeImageTimeFields,
  normalizeMessageTimeFields,
} from "./timeFieldMigration";

describe("time field migration", () => {
  const legacyTimestamp = Date.parse("2026-05-08T09:30:00.000Z");
  const isoTime = "2026-05-08T09:30:00.000Z";

  it("rewrites legacy message time fields to ISO", () => {
    const migrated = normalizeMessageTimeFields({
      id: "message-1",
      conversationId: "conversation-1",
      role: "assistant",
      content: "生成完成",
      referencedImageIds: [],
      resultImageIds: [],
      status: "success",
      createdAt: "刚刚",
      createdAtMs: legacyTimestamp,
    } as Message & { createdAtMs: number });

    expect(migrated).toEqual({
      id: "message-1",
      conversationId: "conversation-1",
      role: "assistant",
      content: "生成完成",
      referencedImageIds: [],
      resultImageIds: [],
      status: "success",
      createdAt: isoTime,
    });
  });

  it("rewrites legacy conversation time fields to ISO", () => {
    const migrated = normalizeConversationTimeFields({
      id: "conversation-1",
      title: "测试对话",
      summary: "摘要",
      createdAt: "刚刚",
      updatedAt: "刚刚",
      updatedAtMs: legacyTimestamp,
    } as Conversation & { updatedAtMs: number });

    expect(migrated).toEqual({
      id: "conversation-1",
      title: "测试对话",
      summary: "摘要",
      createdAt: isoTime,
      updatedAt: isoTime,
    });
  });

  it("rewrites legacy image time fields and keeps updatedAt aligned", () => {
    const migrated = normalizeImageTimeFields({
      id: "image-1",
      name: "图片",
      source: "generated",
      prompt: "画一张图",
      createdAt: "刚刚",
      updatedAt: "刚刚",
      createdAtMs: legacyTimestamp,
    } as ImageAsset & { createdAtMs: number });

    expect(migrated).toEqual({
      id: "image-1",
      name: "图片",
      source: "generated",
      prompt: "画一张图",
      createdAt: isoTime,
      updatedAt: isoTime,
    });
  });

  it("leaves clean ISO records unchanged", () => {
    expect(
      normalizeMessageTimeFields({
        id: "message-1",
        conversationId: "conversation-1",
        role: "assistant",
        content: "生成完成",
        referencedImageIds: [],
        resultImageIds: [],
        status: "success",
        createdAt: isoTime,
      }),
    ).toBeNull();
  });
});
