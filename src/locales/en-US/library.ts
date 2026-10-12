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
  }
};

export default library;
