import adultInspirationText from "../../prompt-wordbanks/adult-inspiration.txt?raw";
import poseCreativeText from "../../prompt-wordbanks/pose-creative.txt?raw";
import poseNsfwText from "../../prompt-wordbanks/pose-nsfw.txt?raw";
import poseSafeText from "../../prompt-wordbanks/pose-safe.txt?raw";

function parseWordbank(text: string) {
  return text
    .split(/\r?\n/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && !term.startsWith("#"));
}

export const promptWordbanks = {
  pose: {
    safe: parseWordbank(poseSafeText),
    creative: parseWordbank(poseCreativeText),
    nsfw: parseWordbank(poseNsfwText),
  },
  adultInspiration: parseWordbank(adultInspirationText),
} as const;
