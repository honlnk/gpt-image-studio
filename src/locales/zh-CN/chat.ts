/** chat 域词条。 */
export default {
  "list": {
    "loadingEarlier": "加载更早的消息…"
  },
  "message": {
    "you": "你",
    "interruptedContent": "生成中断，请重试。",
    "interruptedErrorMessage": "页面刷新或会话中断后，未完成的生成任务不会继续运行。"
  },
  "emptyState": {
    "heading": "开始你的第一张图片",
    "hint": "在下方输入框描述你想要的画面即可生成或编辑图片",
    "featureCompanion": "本地 Companion 配对，API key 不落浏览器",
    "featurePromptModes": "提示词四档模式，灵感词库可自定义",
    "featureImageTags": "图片库七色标签，一按即筛同类作品",
    "featureStreaming": "流式预览，生成过程边出图边看",
    "featureLocalAnalytics": "行为日志本地留存，提示词可脱敏采集",
    "atHintPrefix": "输入",
    "atHintSuffix": "插入常用提示词",
    "dragHint": "拖拽图片到此处可编辑",
    "starCta": "求个 Star 鼓励一下嘛",
    "starCtaWithCount": "求个 Star 鼓励一下嘛（{count} 位好心人已点亮）",
    "qqGroupPrefix": "欢迎加入 QQ 交流群",
    "copyQqGroupNumber": "点击复制群号",
    "qqGroupSuffix": "，交流使用心得、反馈问题"
  },
  "userActions": {
    "copyText": "复制文本",
    "loadToComposer": "加载到输入面板"
  },
  "resultCard": {
    "editedBadge": "已编辑",
    "clickToView": "点击查看",
    "imageDeleted": "图片已删除",
    "imageDeletedHint": "这张图片已从图片库移除，无法显示预览",
    "loadFailed": "加载失败",
    "clickToRetry": "点击重试",
    "generationDuration": "生成耗时：{duration}",
    "assetDeletedPrompt": "原图片资产已从图片库中删除",
    "continueEdit": "继续编辑",
    "attachUnavailable": "不可引用",
    "attached": "已引用",
    "attach": "加入引用",
    "generateAnother": "再次生成",
    "refresh": "刷新",
    "download": "下载"
  },
  "errorCard": {
    "ariaLabel": "图片生成失败",
    "interrupted": "生成中断",
    "noImage": "未生成图片",
    "failedWith": "生成失败：{reason}"
  },
  "pendingCard": {
    "ariaLabel": "图片生成中",
    "previewUpdating": "预览更新中：{duration}",
    "generating": "正在生成：{duration}",
    "retryAttempt": "正在重试第 {count} 次"
  },
  "references": {
    "deletedImage": "图片已删除，无法显示"
  },
  "imageFormat": {
    "durationUnknown": "耗时未知",
    "defaultError": "请重试这个图片卡片。"
  },
  "input": {
    "label": "输入图片需求",
    "placeholderGenerate": "描述你想生成的图片... 输入 @ 可插入常用提示词",
    "placeholderEdit": "描述你想基于引用图修改什么... 输入 @ 可插入常用提示词",
    "uploadImage": "上传图片",
    "send": "发送",
    "sendAnyway": "继续发送",
    "favoritePrompts": "常用提示词",
    "manageFavoritePrompts": "管理常用提示词"
  },
  "attachments": {
    "remove": "移除引用图片"
  },
  "editor": {
    "sizeAuto": "自动",
    "sizeRatio": "比例",
    "custom": "自定义",
    "widthPlaceholder": "宽",
    "heightPlaceholder": "高",
    "countPreset": "选择",
    "countPlaceholder": "数量",
    "countUnit": "张",
    "countHint": "理论无上限，但请量力而行；一次太多可能影响本机和API供应商的服务器。",
    "qualityAuto": "自动",
    "qualityHigh": "高",
    "qualityMedium": "中",
    "qualityLow": "低",
    "backgroundAuto": "自动",
    "backgroundOpaque": "不透明",
    "backgroundTransparent": "透明",
    "backgroundTransparentUnsupported": "{model} 当前不支持透明背景，请选择自动或不透明背景。",
    "customSizeInteger": "自定义尺寸的宽高必须是整数。",
    "customSizeRange": "自定义尺寸的宽高必须是 {min} 到 {max} 之间的 {step} 的倍数。",
    "customSizePixels": "自定义尺寸的总像素必须在 {min} 到 {max} 之间。",
    "customSizeAspectRatio": "自定义尺寸的长边与短边比例不能超过 {ratio}:1。"
  },
  "parameterBar": {
    "model": "模型",
    "content": "内容",
    "promptModeDefault": "默认",
    "promptModeSafe": "安全",
    "promptModeCreative": "创意",
    "promptModeOpen": "开放",
    "editMode": "区域编辑",
    "on": "开",
    "off": "关",
    "size": "尺寸",
    "count": "数量",
    "background": "背景",
    "format": "格式"
  },
  "maskEditor": {
    "title": "选择要编辑的区域",
    "subtitle": "支持画笔、矩形、圆形，多次叠加选区",
    "brush": "画笔",
    "eraser": "橡皮",
    "softEdge": "软边",
    "rect": "方框",
    "ellipse": "圆框",
    "pan": "移动",
    "undo": "撤销",
    "redo": "重做",
    "resetSelection": "重置选区",
    "zoomIn": "放大",
    "zoomOut": "缩小",
    "resetView": "复位视图",
    "apply": "应用区域",
    "previewHint": "预览说明：黑色区域=编辑区域，绿色区域=擦除已选区域；支持多选区、撤销重做、缩放平移。",
    "maskExportFailed": "无法生成遮罩图片。"
  },
  "workspace": {
    "ariaLabel": "聊天工作区",
    "dropTitle": "松开以上传图片",
    "dropHint": "图片会保存到图片库，并作为下一条消息的引用图",
    "conversations": "会话",
    "newConversationTitle": "新的对话",
    "renameConversation": "重命名会话",
    "deleteConversation": "删除会话",
    "generating": "正在生成 {count} 张",
    "companionOnlineEmbedded": "Companion 在线（server 模式管理页由宿主提供）",
    "companionOffline": "Companion 离线",
    "companionOnlineManage": "Companion 在线 v{version}，点击管理",
    "companionOnline": "Companion 在线，点击管理",
    "companionOfflineManage": "Companion 离线，点击管理",
    "offline": "离线",
    "downloadDesktop": "下载桌面版（macOS / Windows / Linux）",
    "desktopLabel": "桌面版",
    "qqGroup": "QQ 交流群",
    "qqGroupTitle": "QQ 交流群：扫码加群讨论",
    "githubRepo": "GitHub 仓库",
    "openSettings": "打开设置",
    "hideLibrary": "隐藏图片库",
    "library": "图片库"
  },
  "sidebar": {
    "ariaLabel": "历史会话",
    "openSettings": "打开设置",
    "newChat": "新建会话",
    "searchLabel": "查找会话",
    "searchPlaceholder": "查找会话...",
    "clearSearch": "清空搜索",
    "noResults": "没有找到会话",
    "renameConversation": "重命名会话",
    "rename": "重命名",
    "deleteConversation": "删除会话",
    "loadingMore": "加载更多会话…",
    "deleteConfirmDescription": "确定删除会话“{title}”吗？聊天记录会被移除，图片库中的图片会保留。",
    "deleteSuccess": "会话已删除。",
    "deleteFailed": "删除会话失败：{error}",
    "deleteCountSuccess": "已删除 {count} 个对话。",
    "deleteCountFailed": "删除对话失败：{error}",
    "defaultConversationTitle": "新的图片创作",
    "defaultConversationSummary": "尚未开始"
  }
};
