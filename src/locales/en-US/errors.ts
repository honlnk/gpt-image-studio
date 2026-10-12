type ZhErrors = typeof import("../zh-CN/errors").default;

const errors: ZhErrors = {
  "api": {
    "apiKeyMissing": "Please enter your OpenAI API key in Settings first.",
    "baseUrlMissing": "Please enter the API Base URL in Settings first.",
    "companionNotPaired": "Companion is not connected yet. Enter the connection key in Settings first.",
    "companionImagesOnly": "The local Companion currently supports the Images API only.",
    "syntaxFallback": "The image API returned a response that could not be parsed.",
    "httpError": "Request failed: HTTP {status}",
    "httpErrorDetail": "Request failed: HTTP {status}: {message}",
    "serverDisconnected": "The server closed the connection without returning any response. This usually happens when the prompt contains non-compliant content that triggered the platform's content moderation policy. Please adjust the prompt and try again.",
    "directModeFallbackHint": "Consider switching to Companion mode (the image is downloaded server-side, free of browser CORS restrictions), or download the desktop app.",
    "missingImagesApiPayload": "Non-standard provider payload: the response contains neither data[0].b64_json nor data[0].url. {hint}",
    "missingResponsesPayload": "Non-standard provider payload: the response contains no image_generation_call result. {hint}"
  },
  "models": {
    "keyMissing": "Please enter an API key first.",
    "baseUrlMissing": "Please enter the API URL first."
  },
  "download": {
    "fetchFailed": "Failed to download the image URL (possibly a browser cross-origin restriction): {message}. {hint}",
    "httpFailed": "Failed to download the image URL: HTTP {status}. {hint}",
    "invalidContent": "The downloaded content is not a valid PNG/JPEG/WebP image. {hint}",
    "invalidUrl": "The provider returned a malformed image URL. {hint}",
    "unsupportedProtocol": "The provider returned an image URL with an unsupported protocol (only http/https are allowed). {hint}",
    "tooLarge": "The image response exceeds the size limit of {limit} MiB. {hint}"
  },
  "stream": {
    "bodyMissing": "The API did not return a readable streaming response.",
    "invalidJsonEvent": "The streaming response contains a JSON event that could not be parsed.",
    "requestFailed": "Streaming request failed.",
    "noImageData": "The streaming endpoint returned no final image data; the provider payload may be non-standard. {hint}",
    "noResult": "The streaming endpoint returned no final image data.",
    "noImageCall": "The streaming endpoint returned no image_generation_call result."
  },
  "network": {
    "serverDisconnectedMarker": "The server closed the connection"
  },
  "storage": {
    "companionAuthFailed": "Companion authentication failed ({status}). Check the connection key or whether Companion is online",
    "companionRouteNotFound": "Companion route not found: {path}",
    "companionBadRequest": "Companion rejected the request (400): {body}",
    "companionRequestFailed": "Companion request failed ({status}): {body}",
    "storeNotPageable": "store {store} does not support pagination",
    "storeNotConversationFilterable": "store {store} does not support conversationId filtering",
    "memoryStoreNotPageable": "store \"{store}\" does not support pagination",
    "memoryStoreNotConversationFilterable": "store \"{store}\" does not support conversationId filtering"
  }
};

export default errors;
