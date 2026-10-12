type ZhChat = typeof import("../zh-CN/chat").default;

const chat: ZhChat = {
  "list": {
    "loadingEarlier": "Loading earlier messages…"
  },
  "message": {
    "you": "You",
    "interruptedContent": "Generation interrupted. Please retry.",
    "interruptedErrorMessage": "Generation tasks left unfinished by a page refresh or conversation switch will not resume."
  },
  "emptyState": {
    "heading": "Start your first image",
    "hint": "Describe the image you want below to generate or edit it",
    "featureCompanion": "Local Companion pairing, API keys never touch the browser",
    "featurePromptModes": "Four prompt modes with customizable wordbanks",
    "featureImageTags": "Seven-color image tags for one-click filtering",
    "featureStreaming": "Streaming previews while your images generate",
    "featureLocalAnalytics": "Activity logs stay local, with optional prompt masking",
    "atHintPrefix": "Type",
    "atHintSuffix": "to insert favorite prompts",
    "dragHint": "Drag an image here to edit it",
    "starCta": "Give us a star to cheer us on",
    "starCtaWithCount": "Give us a star to cheer us on ({count} kind souls already have)",
    "qqGroupPrefix": "Join our QQ group",
    "copyQqGroupNumber": "Click to copy the group number",
    "qqGroupSuffix": " to share tips and report issues"
  },
  "userActions": {
    "copyText": "Copy text",
    "loadToComposer": "Load into composer"
  },
  "resultCard": {
    "editedBadge": "Edited",
    "clickToView": "Click to view",
    "imageDeleted": "Image deleted",
    "imageDeletedHint": "This image was removed from the library and cannot be previewed",
    "loadFailed": "Failed to load",
    "clickToRetry": "Click to retry",
    "generationDuration": "Generation duration: {duration}",
    "assetDeletedPrompt": "The original image asset was removed from the library",
    "continueEdit": "Continue editing",
    "attachUnavailable": "Cannot reference",
    "attached": "Referenced",
    "attach": "Add as reference",
    "generateAnother": "Generate again",
    "refresh": "Refresh",
    "download": "Download"
  },
  "errorCard": {
    "ariaLabel": "Image generation failed",
    "interrupted": "Generation interrupted",
    "noImage": "No image generated",
    "failedWith": "Generation failed: {reason}"
  },
  "pendingCard": {
    "ariaLabel": "Generating image",
    "previewUpdating": "Updating preview: {duration}",
    "generating": "Generating: {duration}",
    "retryAttempt": "Retrying (attempt {count})"
  },
  "references": {
    "deletedImage": "Deleted image"
  },
  "imageFormat": {
    "durationUnknown": "Unknown duration",
    "defaultError": "Please retry this image card."
  },
  "input": {
    "label": "Image request",
    "placeholderGenerate": "Describe the image you want to generate... Type {'@'} to insert a favorite prompt",
    "placeholderEdit": "Describe what to change based on the reference images... Type {'@'} to insert a favorite prompt",
    "uploadImage": "Upload image",
    "send": "Send",
    "sendAnyway": "Send anyway",
    "favoritePrompts": "Favorite prompts",
    "manageFavoritePrompts": "Manage favorite prompts"
  },
  "attachments": {
    "remove": "Remove reference image"
  },
  "editor": {
    "sizeAuto": "Auto",
    "sizeRatio": "Ratio",
    "custom": "Custom",
    "widthPlaceholder": "Width",
    "heightPlaceholder": "Height",
    "countPreset": "Preset",
    "countPlaceholder": "Count",
    "countUnit": "images",
    "countHint": "No hard limit in theory, but pace yourself — too many at once may strain your machine and the API provider's servers.",
    "qualityAuto": "Auto",
    "qualityHigh": "High",
    "qualityMedium": "Medium",
    "qualityLow": "Low",
    "backgroundAuto": "Auto",
    "backgroundOpaque": "Opaque",
    "backgroundTransparent": "Transparent",
    "backgroundTransparentUnsupported": "{model} does not currently support a transparent background. Please choose Auto or Opaque.",
    "customSizeInteger": "Custom size width and height must be integers.",
    "customSizeRange": "Custom size width and height must be multiples of {step} between {min} and {max}.",
    "customSizePixels": "The total pixel count of a custom size must be between {min} and {max}.",
    "customSizeAspectRatio": "The long-to-short side ratio of a custom size cannot exceed {ratio}:1."
  },
  "parameterBar": {
    "model": "Model",
    "content": "Content",
    "promptModeDefault": "Default",
    "promptModeSafe": "Safe",
    "promptModeCreative": "Creative",
    "promptModeOpen": "Open",
    "editMode": "Region edit",
    "on": "On",
    "off": "Off",
    "size": "Size",
    "count": "Count",
    "background": "Background",
    "format": "Format"
  },
  "maskEditor": {
    "title": "Select the area to edit",
    "subtitle": "Brush, rectangle, and ellipse tools; selections can be stacked",
    "brush": "Brush",
    "eraser": "Eraser",
    "softEdge": "Soft edge",
    "rect": "Rectangle",
    "ellipse": "Ellipse",
    "pan": "Pan",
    "undo": "Undo",
    "redo": "Redo",
    "resetSelection": "Reset selection",
    "zoomIn": "Zoom in",
    "zoomOut": "Zoom out",
    "resetView": "Reset view",
    "apply": "Apply region",
    "previewHint": "Preview: black = area to edit, green = erased selection; multiple selections, undo/redo, zoom and pan are supported.",
    "maskExportFailed": "Failed to generate the mask image."
  },
  "workspace": {
    "ariaLabel": "Chat workspace",
    "dropTitle": "Drop to upload images",
    "dropHint": "Images will be saved to the library and used as references for the next message",
    "conversations": "Conversations",
    "newConversationTitle": "New Conversation",
    "renameConversation": "Rename conversation",
    "deleteConversation": "Delete conversation",
    "generating": "Generating {count}",
    "companionOnlineEmbedded": "Companion online (server-mode admin page is provided by the host)",
    "companionOffline": "Companion offline",
    "companionOnlineManage": "Companion online v{version} — click to manage",
    "companionOnline": "Companion online — click to manage",
    "companionOfflineManage": "Companion offline — click to manage",
    "offline": "Offline",
    "downloadDesktop": "Download desktop app (macOS / Windows / Linux)",
    "desktopLabel": "Desktop",
    "qqGroup": "QQ group",
    "qqGroupTitle": "QQ group: scan the QR code to join",
    "githubRepo": "GitHub repository",
    "openSettings": "Open settings",
    "hideLibrary": "Hide Image Library",
    "library": "Image Library"
  },
  "sidebar": {
    "ariaLabel": "Conversation history",
    "openSettings": "Open settings",
    "newChat": "New Conversation",
    "searchLabel": "Search conversations",
    "searchPlaceholder": "Search conversations...",
    "clearSearch": "Clear search",
    "noResults": "No conversations found",
    "renameConversation": "Rename conversation",
    "rename": "Rename",
    "deleteConversation": "Delete conversation",
    "loadingMore": "Loading more conversations…",
    "deleteConfirmDescription": "Are you sure you want to delete \"{title}\"? Chat history will be removed, but images in the library will be kept.",
    "deleteSuccess": "Conversation deleted.",
    "deleteFailed": "Failed to delete conversation: {error}",
    "deleteCountSuccess": "Deleted {count} conversations.",
    "deleteCountFailed": "Failed to delete conversations: {error}",
    "defaultConversationTitle": "New Image Creation",
    "defaultConversationSummary": "Not started yet"
  }
};

export default chat;
