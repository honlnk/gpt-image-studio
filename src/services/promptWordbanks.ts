import adultInspirationText from "../../prompt-wordbanks/adult-inspiration.txt?raw";
import poseCreativeText from "../../prompt-wordbanks/pose-creative.txt?raw";
import poseNsfwText from "../../prompt-wordbanks/pose-nsfw.txt?raw";
import poseSafeText from "../../prompt-wordbanks/pose-safe.txt?raw";
import type { PromptWordbanks } from "../types/studio";

function parseWordbank(text: string) {
  return text
    .split(/\r?\n/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && !term.startsWith("#"));
}

export const defaultPromptWordbanks: PromptWordbanks = {
  pose: {
    safe: parseWordbank(poseSafeText),
    creative: parseWordbank(poseCreativeText),
    nsfw: parseWordbank(poseNsfwText),
  },
  adultInspiration: parseWordbank(adultInspirationText),
};

export const promptWordbanks = defaultPromptWordbanks;

export function normalizePromptWordbanks(value: unknown): PromptWordbanks {
  const record = isRecord(value) ? value : {};
  const pose = isRecord(record.pose) ? record.pose : {};

  return {
    pose: {
      safe: normalizeWordbankTerms(pose.safe, defaultPromptWordbanks.pose.safe),
      creative: normalizeWordbankTerms(
        pose.creative,
        defaultPromptWordbanks.pose.creative,
      ),
      nsfw: normalizeWordbankTerms(pose.nsfw, defaultPromptWordbanks.pose.nsfw),
    },
    adultInspiration: normalizeWordbankTerms(
      record.adultInspiration,
      defaultPromptWordbanks.adultInspiration,
    ),
  };
}

export function normalizeWordbankTerms(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return [...fallback];

  const seen = new Set<string>();
  return value
    .map((term) => (typeof term === "string" ? term.trim() : ""))
    .filter((term) => term.length > 0 && !term.startsWith("#"))
    .filter((term) => {
      if (seen.has(term)) return false;
      seen.add(term);
      return true;
    });
}

export function clonePromptWordbanks(wordbanks: PromptWordbanks): PromptWordbanks {
  return {
    pose: {
      safe: [...wordbanks.pose.safe],
      creative: [...wordbanks.pose.creative],
      nsfw: [...wordbanks.pose.nsfw],
    },
    adultInspiration: [...wordbanks.adultInspiration],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
