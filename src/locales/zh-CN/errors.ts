/** errors 域词条。 */
export default {
  "api": {
    "apiKeyMissing": "请先在设置里填写 OpenAI API key。",
    "baseUrlMissing": "请先在设置里填写 API Base URL。",
    "companionNotPaired": "尚未连接 Companion，请先在设置中输入连接密钥。",
    "companionImagesOnly": "本地 Companion 当前仅支持 Images API。",
    "syntaxFallback": "图片接口返回了无法解析的响应。",
    "httpError": "请求失败：HTTP {status}",
    "httpErrorDetail": "请求失败：HTTP {status}：{message}",
    "serverDisconnected": "服务器主动断开了连接，未返回任何响应。通常是提示词中存在不合规内容，触发了平台的内容审核策略，请调整提示词后重试。",
    "directModeFallbackHint": "建议切换到 Companion 模式（服务端下载图片，不受浏览器跨域限制），或直接下载桌面应用。",
    "missingImagesApiPayload": "服务商返回的数据不标准：响应中没有 data[0].b64_json 或 data[0].url。{hint}",
    "missingResponsesPayload": "服务商返回的数据不标准：响应中没有 image_generation_call 结果。{hint}"
  },
  "models": {
    "keyMissing": "请先填写 API key。",
    "baseUrlMissing": "请先填写 API 地址。"
  },
  "download": {
    "fetchFailed": "下载图片链接失败（可能是浏览器跨域限制）：{message}。{hint}",
    "httpFailed": "下载图片链接失败：HTTP {status}。{hint}",
    "invalidContent": "下载的链接内容不是有效的 PNG/JPEG/WebP 图片。{hint}",
    "invalidUrl": "服务商返回的图片链接格式无效。{hint}",
    "unsupportedProtocol": "服务商返回的图片链接协议不受支持（仅允许 http/https）。{hint}",
    "tooLarge": "图片响应超过大小上限 {limit} MiB。{hint}"
  },
  "stream": {
    "bodyMissing": "接口未返回可读取的流式响应。",
    "invalidJsonEvent": "流式响应包含无法解析的 JSON 事件。",
    "requestFailed": "流式请求失败。",
    "noImageData": "流式接口未返回最终图片数据，服务商返回的数据可能不标准。{hint}",
    "noResult": "流式接口未返回最终图片数据。",
    "noImageCall": "流式接口未返回 image_generation_call 结果。"
  },
  "network": {
    "serverDisconnectedMarker": "服务器主动断开了连接"
  },
  "storage": {
    "companionAuthFailed": "Companion 鉴权失败 ({status})，请检查连接密钥或 Companion 是否在线",
    "companionRouteNotFound": "Companion 路由不存在: {path}",
    "companionBadRequest": "Companion 拒绝请求 (400): {body}",
    "companionRequestFailed": "Companion 请求失败 ({status}): {body}",
    "storeNotPageable": "store {store} 不支持分页查询",
    "storeNotConversationFilterable": "store {store} 不支持 conversationId 过滤",
    "memoryStoreNotPageable": "store \"{store}\" 不支持分页查询",
    "memoryStoreNotConversationFilterable": "store \"{store}\" 不支持 conversationId 过滤"
  }
};
