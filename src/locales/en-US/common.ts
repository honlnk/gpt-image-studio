type ZhCommon = typeof import("../zh-CN/common").default;

/** Shared strings: short labels reused across domains and app-level titles. */
const common: ZhCommon = {
  "appTitle": "GPT Image Studio - Local-first AI Image Workbench",
  "cancel": "Cancel",
  "confirm": "Confirm",
  "close": "Close",
  "save": "Save",
  "delete": "Delete",
  "retry": "Retry",
  "copy": "Copy",
  "loading": "Loading…",
  "confirmToDelete": "Confirm delete",
  "unnamed": "Unnamed",
  "confirmInput": {
    "typeToConfirm": "Type the text below to confirm:"
  },
  "toast": {
    "closeNotice": "Close notice"
  },
  "qqGroup": {
    "qrCodeAlt": "QQ Group QR code"
  },
  "time": {
    "unknown": "Unknown time"
  },
  "format": {
    "unknownSize": "Unknown size"
  },
  "copySuccess": "Text copied.",
  "copyFailed": "Copy failed. Please select and copy the text manually.",
  "loadedToComposer": "Loaded into the composer.",
  "conversationRenamed": "Conversation renamed.",
  "imageRenamed": "Image renamed.",
  "renameFailed": "Rename failed due to a local save error. Please try again.",
  "apiAuthFailed": "Image API authentication failed. Please check the API key and base URL.",
  "unsupportedEdit": "The current model does not support image-to-image editing. Remove the reference images, or switch to a model that supports image editing.",
  "storageWriteFailed": "Failed to save locally. Some changes may not have been persisted (see the console for details).",
  "saveName": "Save Name",
  "renameConversation": {
    "title": "Rename Conversation",
    "description": "After renaming, the conversation title will no longer be overwritten by new messages."
  },
  "renameImage": {
    "title": "Rename Image",
    "description": "The new name is used for both the image library display and download file names."
  }
};

export default common;
