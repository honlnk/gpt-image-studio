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
  if (!timestamp) return "未知时间";

  const diffSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));

  if (diffSeconds < 30) return "刚刚";
  if (diffSeconds < 60) return "一分钟内";
  if (diffSeconds < 60 * 60) {
    return `${Math.floor(diffSeconds / 60)} 分钟前`;
  }
  if (diffSeconds < 24 * 60 * 60) {
    return `${Math.floor(diffSeconds / 60 / 60)} 小时前`;
  }

  return new Intl.DateTimeFormat("zh-CN", {
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
