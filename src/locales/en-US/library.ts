type ZhLibrary = typeof import("../zh-CN/library").default;

const library: ZhLibrary = {
  "shell": {
    "ariaLabel": "Image library",
    "title": "Image Library",
    "imageCount": "{count} images",
    "batchDownload": "Batch download",
    "closeLibrary": "Close image library",
    "scopeCurrent": "Current conversation",
    "scopeAll": "All images",
    "filterNoColor": "No color filter",
    "filterByColor": "Filter by {color}",
    "searchPlaceholder": "Search image names",
    "clearSearch": "Clear search",
    "filterBySource": "Filter by source",
    "filterByFormat": "Filter by format",
    "sortBy": "Sort by",
    "sortAsc": "Ascending",
    "sortDesc": "Descending",
    "clearFilters": "Clear filters and sorting",
    "partialScopeHint": "Filters apply only to loaded images ({loaded}/{total}); scroll down to load more",
    "sourceAll": "All sources",
    "sourceGenerated": "Generated",
    "sourceEdited": "Edited",
    "sourceImported": "Imported",
    "formatAll": "All formats",
    "sortSize": "Size"
  },
  "preview": {
    "edit": "Edit",
    "download": "Download",
    "resetView": "Reset view",
    "reset": "Reset"
  },
  "card": {
    "previewFailedRetry": "Failed to load, click to retry",
    "view": "Click to view",
    "attach": "Reference",
    "attached": "Referenced"
  },
  "details": {
    "rename": "Rename",
    "tagColor": "Tag color",
    "markTagColor": "Mark as {color}",
    "format": "Format",
    "size": "Size",
    "file": "File",
    "status": "Status",
    "attached": "Added as reference",
    "notAttached": "Not referenced",
    "originalPrompt": "Original prompt",
    "revisedPrompt": "API revised prompt",
    "notReturned": "Not returned"
  },
  "grid": {
    "emptyCurrent": "No images in this conversation yet",
    "emptyLibrary": "Your image library is empty",
    "loadingMore": "Loading more images…"
  },
  "storage": {
    "usage": "Storage usage",
    "companionHint": "Images {imageBytes}, text and indexes {metadataBytes}. Data is stored on the Companion server; the limit depends on the server disk or OSS usage.",
    "local": "Local storage",
    "localHint": "Estimated from the current browser and device state; available space may change.",
    "imageData": "Image data",
    "textAndIndex": "Text and indexes",
    "images": "Images",
    "noQuota": "No quota provided by the browser"
  },
  "formatters": {
    "unknown": "Unknown",
    "notRecorded": "Not recorded"
  }
};

export default library;
