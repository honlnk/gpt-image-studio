import type { ImageTagColor } from "../../types/studio";

export const IMAGE_TAG_COLORS: ImageTagColor[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
];

const DOT_COLOR_MAP: Record<ImageTagColor, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  cyan: "#06b6d4",
  blue: "#3b82f6",
  purple: "#a855f7",
};

const CARD_BG_MAP: Record<ImageTagColor, string> = {
  red: "rgba(239, 68, 68, 0.12)",
  orange: "rgba(249, 115, 22, 0.12)",
  yellow: "rgba(234, 179, 8, 0.14)",
  green: "rgba(34, 197, 94, 0.12)",
  cyan: "rgba(6, 182, 212, 0.12)",
  blue: "rgba(59, 130, 246, 0.12)",
  purple: "rgba(168, 85, 247, 0.12)",
};

export function imageTagDotColor(color: ImageTagColor) {
  return DOT_COLOR_MAP[color];
}

export function imageTagCardBackground(color: ImageTagColor) {
  return CARD_BG_MAP[color];
}
