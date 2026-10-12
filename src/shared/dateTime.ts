import { currentLocale, t } from "../i18n";

export function isoTimestamp(timestampMs = Date.now()) {
  return new Date(timestampMs).toISOString();
}

export function timestampFromCreatedAt(record: { createdAt?: string }) {
  return timestampFromDateString(record.createdAt);
}

export function timestampFromUpdatedAt(record: { updatedAt?: string }) {
  return timestampFromDateString(record.updatedAt);
}

export function formatRelativeTime(dateString?: string, nowMs = Date.now()) {
  const timestamp = timestampFromDateString(dateString);
  return formatRelativeTimestamp(timestamp, nowMs);
}

function formatRelativeTimestamp(timestamp: number, nowMs = Date.now()) {
  if (!timestamp) return t("common.time.unknown");

  const diffSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  // RelativeTimeFormat 每次按当前 locale 新建（numeric:auto 得「刚刚/now」而非「0 秒前」）。
  const relative = new Intl.RelativeTimeFormat(currentLocale(), {
    numeric: "auto",
  });

  if (diffSeconds < 30) return relative.format(0, "second");
  if (diffSeconds < 60) return relative.format(-1, "minute");
  if (diffSeconds < 60 * 60) {
    return relative.format(-Math.floor(diffSeconds / 60), "minute");
  }
  if (diffSeconds < 24 * 60 * 60) {
    return relative.format(-Math.floor(diffSeconds / 60 / 60), "hour");
  }

  return new Intl.DateTimeFormat(currentLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function timestampFromDateString(dateString?: string) {
  if (!dateString) return 0;

  const timestamp = Date.parse(dateString);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
