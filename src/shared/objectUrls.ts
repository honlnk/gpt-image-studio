export function createObjectUrl(blob: Blob) {
  return URL.createObjectURL(blob);
}

export function revokeObjectUrl(url?: string) {
  if (!url?.startsWith("blob:")) return;
  URL.revokeObjectURL(url);
}

export function revokeObjectUrls(urls: Iterable<string | undefined>) {
  for (const url of urls) {
    revokeObjectUrl(url);
  }
}
