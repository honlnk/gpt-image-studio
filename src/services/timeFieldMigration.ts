import type { Conversation, ImageAsset, Message } from "../types/studio";
import { isoTimestamp } from "../shared/dateTime";
import { STORE_NAMES, type StudioStorage } from "./storage";
import { resolveStorage } from "./storage/resolveStorage";

type LegacyConversation = Conversation & {
  createdAtMs?: number;
  updatedAtMs?: number;
};

type LegacyMessage = Message & {
  createdAtMs?: number;
};

type LegacyImageAsset = ImageAsset & {
  createdAtMs?: number;
  updatedAtMs?: number;
};

/** 时间字段迁移服务（跨 3 collection 的枚举+重写）。阶段一 PR3 改工厂注入（决策 T1）。
 *  normalizeXxxTimeFields 已是纯函数（可测），工厂只包 orchestrator。 */
export type TimeFieldMigrationServices = ReturnType<
  typeof createTimeFieldMigrationServices
>;

export function createTimeFieldMigrationServices(storage: StudioStorage) {
  return {
    async migrate() {
      const [conversations, messages, imageAssets] = await Promise.all([
        storage.list<LegacyConversation>(STORE_NAMES.conversations),
        storage.list<LegacyMessage>(STORE_NAMES.messages),
        storage.list<LegacyImageAsset>(STORE_NAMES.imageAssets),
      ]);

      const migratedConversations = conversations
        .map(normalizeConversationTimeFields)
        .filter(isPresent);
      const migratedMessages = messages
        .map(normalizeMessageTimeFields)
        .filter(isPresent);
      const migratedImages = imageAssets
        .map(normalizeImageTimeFields)
        .filter(isPresent);

      if (
        !migratedConversations.length &&
        !migratedMessages.length &&
        !migratedImages.length
      ) {
        return;
      }

      await Promise.all([
        ...migratedConversations.map((record) =>
          storage.put(STORE_NAMES.conversations, record),
        ),
        ...migratedMessages.map((record) =>
          storage.put(STORE_NAMES.messages, record),
        ),
        ...migratedImages.map((record) =>
          storage.put(STORE_NAMES.imageAssets, record),
        ),
      ]);
    },
  };
}

// ─── 模块级默认实例（向后兼容，PR6 移除） ───
const defaultTimeFieldMigrationServices = createTimeFieldMigrationServices(
  resolveStorage(),
);

export async function migrateLegacyTimeFields() {
  return defaultTimeFieldMigrationServices.migrate();
}

export function normalizeConversationTimeFields(record: LegacyConversation) {
  const updatedAt = normalizedDateString(record.updatedAt, record.updatedAtMs);
  const createdAt = normalizedDateString(record.createdAt, record.createdAtMs);
  const nextCreatedAt = createdAt ?? updatedAt;

  if (
    updatedAt === record.updatedAt &&
    nextCreatedAt === record.createdAt &&
    record.createdAtMs === undefined &&
    record.updatedAtMs === undefined
  ) {
    return null;
  }

  const {
    createdAtMs: _createdAtMs,
    updatedAtMs: _updatedAtMs,
    ...cleanRecord
  } = record;

  return {
    ...cleanRecord,
    createdAt: nextCreatedAt,
    updatedAt: updatedAt ?? record.updatedAt,
  } satisfies Conversation;
}

export function normalizeMessageTimeFields(record: LegacyMessage) {
  const createdAt = normalizedDateString(record.createdAt, record.createdAtMs);

  if (createdAt === record.createdAt && record.createdAtMs === undefined) {
    return null;
  }

  const { createdAtMs: _createdAtMs, ...cleanRecord } = record;

  return {
    ...cleanRecord,
    createdAt: createdAt ?? record.createdAt,
  } satisfies Message;
}

export function normalizeImageTimeFields(record: LegacyImageAsset) {
  const createdAt = normalizedDateString(record.createdAt, record.createdAtMs);
  const updatedAt = normalizedDateString(record.updatedAt, record.updatedAtMs);
  const nextUpdatedAt = updatedAt
    ?? (isValidDateString(record.updatedAt) ? record.updatedAt : createdAt);

  if (
    createdAt === record.createdAt &&
    nextUpdatedAt === record.updatedAt &&
    record.createdAtMs === undefined &&
    record.updatedAtMs === undefined
  ) {
    return null;
  }

  const {
    createdAtMs: _createdAtMs,
    updatedAtMs: _updatedAtMs,
    ...cleanRecord
  } = record;

  return {
    ...cleanRecord,
    createdAt: createdAt ?? record.createdAt,
    updatedAt: nextUpdatedAt,
  } satisfies ImageAsset;
}

function normalizedDateString(dateString?: string, timestampMs?: number) {
  if (isValidDateString(dateString)) return dateString;
  if (typeof timestampMs === "number") return isoTimestamp(timestampMs);
  return undefined;
}

function isValidDateString(dateString?: string) {
  if (!dateString) return false;
  return Number.isFinite(Date.parse(dateString));
}

function isPresent<T>(record: T | null): record is T {
  return record !== null;
}
