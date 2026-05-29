import { isoTimestamp } from "../shared/dateTime";
import { createId } from "../shared/id";
import type { FavoritePrompt } from "../types/studio";

export function createFavoritePrompt(input?: {
  title?: string;
  text?: string;
}): FavoritePrompt {
  const now = isoTimestamp();
  const text = normalizePromptText(input?.text);

  return {
    id: createId("favorite-prompt"),
    title: normalizePromptTitle(input?.title, text),
    text,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeFavoritePrompts(value: unknown): FavoritePrompt[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => normalizeFavoritePrompt(item))
    .filter((item): item is FavoritePrompt => Boolean(item));
}

export function normalizeFavoritePromptUpdate(input: {
  title?: string;
  text?: string;
}) {
  const text = normalizePromptText(input.text);

  return {
    title: normalizePromptTitle(input.title, text),
    text,
  };
}

function normalizeFavoritePrompt(value: unknown): FavoritePrompt | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<FavoritePrompt>;
  const text = normalizePromptText(item.text);
  if (!text) return null;

  const createdAt = normalizeTimestamp(item.createdAt);
  return {
    id: item.id || createId("favorite-prompt"),
    title: normalizePromptTitle(item.title, text),
    text,
    createdAt,
    updatedAt: normalizeTimestamp(item.updatedAt, createdAt),
  };
}

function normalizePromptTitle(title: unknown, text: string) {
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  if (normalizedTitle) return normalizedTitle.slice(0, 80);

  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  return firstLine.trim().slice(0, 32) || "未命名提示词";
}

function normalizePromptText(text: unknown) {
  return typeof text === "string" ? text.trim() : "";
}

function normalizeTimestamp(value: unknown, fallback = isoTimestamp()) {
  if (typeof value !== "string") return fallback;
  return Number.isFinite(Date.parse(value)) ? value : fallback;
}
