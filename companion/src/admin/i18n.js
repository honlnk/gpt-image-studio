// Companion 管理页迷你 i18n 模块 —— 原生 JS，零依赖。
//
// 以经典 script 引入（index.html 中位于 app.js 之前），挂 window.AdminI18n 全局。
// 职责：
//   - DICT：zh-CN / en-US 双语字典（dotted key 扁平结构）
//   - t(key, params)：取词 + {name} 插值；缺 key 时回退 zh-CN 值，再缺回显 key 本身
//   - detectLang()：URL ?lang=（zh-CN/en-US，大小写不敏感）→ localStorage → navigator（zh* → zh-CN 否则 en-US）
//   - setLang(lang)：写 localStorage、更新 <html lang>、重跑 applyStatic、通知 onLangChange 订阅方
//   - applyStatic(root)：扫描 [data-i18n-key] 替换 textContent；
//     [data-i18n-attr="placeholder:KEY,title:KEY2"] 处理属性（placeholder / aria-label / title）
//   - onLangChange(cb)：语言切换回调注册（app.js 用它重渲染动态区）
//
// 语言切换器（.lang-switch [data-lang] 按钮）由本模块自行绑定与高亮。
"use strict";

(function () {
  var SUPPORTED = ["zh-CN", "en-US"];
  var FALLBACK = "zh-CN";
  var STORAGE_KEY = "gpt-image-studio-admin:language";

  // ---- 字典 ----
  var DICT = {
    "zh-CN": {
      // 页面骨架
      "app.title": "Companion 管理页",
      "app.subtitle":
        "管理本地 Companion 服务：状态、API 凭据与日志。和命令行工具完全等价，所有操作只在本机 loopback 下可用。",

      // 状态总览
      "status.checking": "检测中…",
      "status.online": "Companion 在线",
      "status.offline": "Companion 离线",
      "status.offlineHint": "Companion 离线。请检查服务是否在运行：",
      "status.credentialReady": "凭据已配置",
      "status.credentialNotReady": "凭据未配置",

      // 通用按钮 / 状态词
      "common.refresh": "刷新",
      "common.loading": "加载中…",
      "common.save": "保存",
      "common.saving": "保存中…",
      "common.cancel": "取消",
      "common.confirm": "确定",
      "common.delete": "删除",
      "common.edit": "编辑",
      "common.show": "显示",
      "common.hide": "隐藏",

      // 凭据 CRUD
      "credentials.title": "API 凭据",
      "credentials.add": "+ 新增",
      "credentials.empty": "暂无 provider 配置，点击「新增」添加。",
      "credentials.formTitleAdd": "新增配置",
      "credentials.formTitleEdit": "编辑配置",
      "credentials.fieldLabel": "名称",
      "credentials.labelPlaceholder": "如：豆包测试号",
      "credentials.modelPlaceholder": "模型 ID",
      "credentials.activeBadge": "激活中",
      "credentials.activate": "激活",
      "credentials.detailProvider": "Provider：",
      "credentials.detailBaseUrl": "Base URL：",
      "credentials.detailModel": "Model：",
      "credentials.detailApiKey": "API Key：",
      "credentials.notSet": "（未设置）",
      "credentials.corruptTitle": "⚠️ 凭据文件异常",
      "credentials.corruptFallback": "凭据文件异常",
      "credentials.corruptHint":
        "可以尝试从备份恢复；若备份也坏了，或不需要历史配置，可重置成空配置后重新添加。",
      "credentials.restoreFromBackup": "从备份恢复",
      "credentials.restoring": "恢复中…",
      "credentials.resetEmpty": "重置成空配置",
      "credentials.resetting": "重置中…",
      "credentials.deleteTitle": "删除「{label}」",
      "credentials.deleteDesc": "确定删除这条 provider 配置吗？此操作不可撤销。",
      "credentials.resetDesc":
        "将丢弃当前损坏的凭据文件，写入一份干净的空配置。之前备份的 .corrupt-*.json 文件会保留在配置目录中，可手动找回。确定继续吗？",

      // 存储位置
      "storage.title": "存储位置",
      "storage.intro": "会话与图片数据的存放位置。切换后原位置数据不会删除，切回可找回。",
      "storage.currentKey": "当前位置：",
      "storage.currentValue": "{label}（{kind}）",
      "storage.notConfigured": "未配置",
      "storage.unknown": "未知",
      "storage.kindDefault": "默认目录（推荐）",
      "storage.kindDefaultDesc": "存到 Companion 默认目录，无需配置，数据安全。",
      "storage.kindCustom": "指定目录",
      "storage.kindCustomDesc": "存到指定文件夹，图片可直接用文件管理器打开。需输入绝对路径。",
      "storage.kindOss": "阿里云 OSS",
      "storage.kindOssDesc": "上传到阿里云 OSS，跨设备访问。需配置 bucket 和 AccessKey。",
      "storage.kindLabelDefault": "默认目录",
      "storage.kindLabelCustom": "指定目录",
      "storage.kindLabelOss": "阿里云 OSS",
      "storage.dirPathLabel": "目录绝对路径",
      "storage.dirHint":
        "目录必须已存在且可写，不允许系统敏感目录。点输入框右侧 ▾ 可从历史使用过的目录中直接选择。",
      "storage.historyDir": "历史目录",
      "storage.historyDirExpand": "展开历史目录",
      "storage.pickDirectory": "选择文件夹…",
      "storage.picking": "选择中…",
      "storage.ossCurrent": "当前已配置：{endpoint} / {bucket}（{masked}）",
      "storage.ossHint":
        "保存前会做连通性测试，凭据错误将被拒绝。AccessKey 只存在 Companion 本地（切换存储位置不会丢失）。已保存过凭据时，AccessKey 留空即沿用；修改 Endpoint/Bucket 则需重新填写。",
      "storage.reconfigure": "重新配置",
      "storage.switchButton": "切换存储位置",
      "storage.switching": "切换中…",
      "storage.switchConfirm": "切换",
      "storage.switchDialogTitle": "切换到「{target}」",
      "storage.switchDialogDesc":
        "切换后，当前「{current}」的内容将不可见（不会删除），新内容会存到新位置。切回「{current}」可找回原有内容。是否继续？",
      "storage.switchSuccess": "已切换数据集。请回到 web 页面刷新，以加载新位置的数据。",
      "storage.switchSuccessCreated": "已创建新数据集并切换。请回到 web 页面刷新，以加载新位置的数据。",

      // 开机自启
      "autostart.title": "开机自启",
      "autostart.label": "登录系统时自动启动 Companion",
      "autostart.platformMacos": "macOS 登录项",
      "autostart.platformLinux": "systemd 用户服务",
      "autostart.platformWindows": "Windows 注册表启动项",
      "autostart.platformUnsupported": "当前系统不支持",
      "autostart.unsupportedHint": "当前系统不支持开机自启（仅 macOS / Linux / Windows）。",
      "autostart.lingerHint":
        "当前为「登录即启」。如需「开机即启」（无需登录），请在终端执行：sudo loginctl enable-linger $USER",

      // 日志
      "logs.title": "日志",
      "logs.lastLines": "最近 {count} 行",
      "logs.empty": "暂无日志。",
      "logs.hint": "点击「刷新」加载日志。",

      // 错误提示
      "errors.requestFailed": "请求失败（{status}）",
      "errors.switchFailed": "切换失败：{message}",
      "errors.ossEndpointBucketRequired": "请填写 Endpoint 和 Bucket",
      "errors.ossReenterCredentials":
        "修改 Endpoint/Bucket 时需重新填写完整的 AccessKey ID 和 Secret；沿用已保存凭据请保持 Endpoint/Bucket 不变并将 AccessKey 留空",
      "errors.ossConfigRequired": "请填写完整的 OSS 配置（endpoint/bucket/AccessKey）",
      "errors.dirPathRequired": "请输入目录路径",
      "errors.pickDirFailed": "无法打开目录选择框，请手动输入路径",
      "errors.presetsLoadFailed": "Provider 预设加载失败，请刷新页面重试",
      "errors.credRequired": "API Base URL 和 API Key 不能为空",
    },

    "en-US": {
      // Page shell
      "app.title": "Companion Admin",
      "app.subtitle":
        "Manage the local Companion service: status, API credentials, and logs. Fully equivalent to the CLI tool; everything is reachable only from this machine's loopback interface.",

      // Status overview
      "status.checking": "Checking…",
      "status.online": "Companion online",
      "status.offline": "Companion offline",
      "status.offlineHint": "Companion is offline. Check whether the service is running:",
      "status.credentialReady": "Credentials configured",
      "status.credentialNotReady": "No credentials configured",

      // Common buttons / states
      "common.refresh": "Refresh",
      "common.loading": "Loading…",
      "common.save": "Save",
      "common.saving": "Saving…",
      "common.cancel": "Cancel",
      "common.confirm": "OK",
      "common.delete": "Delete",
      "common.edit": "Edit",
      "common.show": "Show",
      "common.hide": "Hide",

      // Credentials CRUD
      "credentials.title": "API Credentials",
      "credentials.add": "+ Add",
      "credentials.empty": "No provider configs yet. Click \"Add\" to create one.",
      "credentials.formTitleAdd": "Add config",
      "credentials.formTitleEdit": "Edit config",
      "credentials.fieldLabel": "Name",
      "credentials.labelPlaceholder": "e.g. Doubao test account",
      "credentials.modelPlaceholder": "Model ID",
      "credentials.activeBadge": "Active",
      "credentials.activate": "Activate",
      "credentials.detailProvider": "Provider:",
      "credentials.detailBaseUrl": "Base URL:",
      "credentials.detailModel": "Model:",
      "credentials.detailApiKey": "API Key:",
      "credentials.notSet": "(not set)",
      "credentials.corruptTitle": "⚠️ Credential file error",
      "credentials.corruptFallback": "Credential file error",
      "credentials.corruptHint":
        "You can try restoring from the backup; if the backup is also broken, or you no longer need the existing configs, reset to an empty configuration and add them again.",
      "credentials.restoreFromBackup": "Restore from backup",
      "credentials.restoring": "Restoring…",
      "credentials.resetEmpty": "Reset to empty",
      "credentials.resetting": "Resetting…",
      "credentials.deleteTitle": "Delete \"{label}\"",
      "credentials.deleteDesc": "Delete this provider config? This action cannot be undone.",
      "credentials.resetDesc":
        "This discards the current corrupted credential file and writes a clean empty configuration. Previously saved .corrupt-*.json backups are kept in the config directory and can be recovered manually. Continue?",

      // Storage location
      "storage.title": "Storage location",
      "storage.intro":
        "Where conversations and image data are stored. Switching does not delete data at the previous location; switch back to recover it.",
      "storage.currentKey": "Current location:",
      "storage.currentValue": "{label} ({kind})",
      "storage.notConfigured": "Not configured",
      "storage.unknown": "Unknown",
      "storage.kindDefault": "Default directory (recommended)",
      "storage.kindDefaultDesc":
        "Store in the Companion default directory. No configuration needed; data stays safe.",
      "storage.kindCustom": "Custom directory",
      "storage.kindCustomDesc":
        "Store in a folder of your choice and open images directly in your file manager. Requires an absolute path.",
      "storage.kindOss": "Alibaba Cloud OSS",
      "storage.kindOssDesc":
        "Upload to Alibaba Cloud OSS for cross-device access. Requires a bucket and AccessKey.",
      "storage.kindLabelDefault": "Default directory",
      "storage.kindLabelCustom": "Custom directory",
      "storage.kindLabelOss": "Alibaba Cloud OSS",
      "storage.dirPathLabel": "Absolute directory path",
      "storage.dirHint":
        "The directory must already exist and be writable; system-sensitive directories are not allowed. Click the ▾ on the right of the input to pick from previously used directories.",
      "storage.historyDir": "Recent directories",
      "storage.historyDirExpand": "Show recent directories",
      "storage.pickDirectory": "Choose folder…",
      "storage.picking": "Choosing…",
      "storage.ossCurrent": "Configured: {endpoint} / {bucket} ({masked})",
      "storage.ossHint":
        "A connectivity test runs before saving; invalid credentials are rejected. AccessKeys are stored only in Companion (switching the storage location does not lose them). If credentials were saved before, leave the AccessKey fields empty to reuse them; changing Endpoint/Bucket requires entering them again.",
      "storage.reconfigure": "Reconfigure",
      "storage.switchButton": "Switch storage location",
      "storage.switching": "Switching…",
      "storage.switchConfirm": "Switch",
      "storage.switchDialogTitle": "Switch to \"{target}\"",
      "storage.switchDialogDesc":
        "After switching, content under the current \"{current}\" becomes invisible (it is not deleted), and new content is stored in the new location. Switch back to \"{current}\" to recover the original content. Continue?",
      "storage.switchSuccess":
        "Dataset switched. Refresh the web app to load data from the new location.",
      "storage.switchSuccessCreated":
        "New dataset created and activated. Refresh the web app to load data from the new location.",

      // Autostart
      "autostart.title": "Start at login",
      "autostart.label": "Start Companion automatically when you log in",
      "autostart.platformMacos": "macOS login item",
      "autostart.platformLinux": "systemd user service",
      "autostart.platformWindows": "Windows registry startup entry",
      "autostart.platformUnsupported": "Not supported on this system",
      "autostart.unsupportedHint":
        "Autostart is not supported on this system (macOS / Linux / Windows only).",
      "autostart.lingerHint":
        "Currently \"start at login\". For \"start at boot\" (no login required), run: sudo loginctl enable-linger $USER",

      // Logs
      "logs.title": "Logs",
      "logs.lastLines": "Last {count} lines",
      "logs.empty": "No logs.",
      "logs.hint": "Click \"Refresh\" to load logs.",

      // Error messages
      "errors.requestFailed": "Request failed ({status})",
      "errors.switchFailed": "Switch failed: {message}",
      "errors.ossEndpointBucketRequired": "Endpoint and Bucket are required",
      "errors.ossReenterCredentials":
        "When changing Endpoint/Bucket you must re-enter the full AccessKey ID and Secret; to reuse the saved credentials, keep Endpoint/Bucket unchanged and leave the AccessKey fields empty",
      "errors.ossConfigRequired": "Fill in the complete OSS configuration (endpoint/bucket/AccessKey)",
      "errors.dirPathRequired": "Enter a directory path",
      "errors.pickDirFailed": "Could not open the directory picker; enter the path manually",
      "errors.presetsLoadFailed": "Failed to load provider presets; refresh the page and try again",
      "errors.credRequired": "API Base URL and API Key are required",
    },
  };

  // ---- 状态 ----
  var currentLang = FALLBACK;
  var listeners = [];

  // ---- 工具 ----

  /** 归一化语言值：zh-CN/en-US（大小写、下划线不敏感；zh*→zh-CN、en*→en-US）。无法识别返回 null。 */
  function normalizeLang(value) {
    if (!value) return null;
    var norm = String(value).trim().toLowerCase().replace(/_/g, "-");
    if (norm.indexOf("zh") === 0) return "zh-CN";
    if (norm.indexOf("en") === 0) return "en-US";
    return null;
  }

  /** 解析语言：URL ?lang= → localStorage → navigator（zh* → zh-CN，否则 en-US）。 */
  function detectLang() {
    try {
      var fromUrl = normalizeLang(new URL(window.location.href).searchParams.get("lang"));
      if (fromUrl) return fromUrl;
    } catch (e) {
      // location 解析失败（极端情况），继续走后续来源
    }
    try {
      var fromStorage = normalizeLang(window.localStorage.getItem(STORAGE_KEY));
      if (fromStorage) return fromStorage;
    } catch (e) {
      // localStorage 不可用（隐私模式等），继续走 navigator
    }
    var langs = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ""];
    for (var i = 0; i < langs.length; i++) {
      if (String(langs[i] || "").toLowerCase().indexOf("zh") === 0) return "zh-CN";
    }
    return "en-US";
  }

  /** 取词：当前语言 → zh-CN 兜底 → 回显 key 本身（避免页面空白）。{name} 形式插值。 */
  function t(key, params) {
    var text = key;
    if (Object.prototype.hasOwnProperty.call(DICT[currentLang] || {}, key)) {
      text = DICT[currentLang][key];
    } else if (Object.prototype.hasOwnProperty.call(DICT[FALLBACK], key)) {
      text = DICT[FALLBACK][key];
    }
    if (params) {
      text = String(text).replace(/\{(\w+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(params, name)
          ? String(params[name])
          : match;
      });
    }
    return text;
  }

  /** data-i18n-params 属性（JSON）解析；缺失或非法时返回 undefined。 */
  function parseI18nParams(node) {
    var raw = node.getAttribute("data-i18n-params");
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return undefined;
    }
  }

  /** 静态文案应用：[data-i18n-key] 替换 textContent；[data-i18n-attr] 替换属性。 */
  function applyStatic(root) {
    var scope = root || document;
    scope.querySelectorAll("[data-i18n-key]").forEach(function (node) {
      var key = node.getAttribute("data-i18n-key");
      if (!key) return;
      node.textContent = t(key, parseI18nParams(node));
    });
    scope.querySelectorAll("[data-i18n-attr]").forEach(function (node) {
      var spec = node.getAttribute("data-i18n-attr") || "";
      spec.split(",").forEach(function (pair) {
        var idx = pair.indexOf(":");
        if (idx <= 0) return;
        var attr = pair.slice(0, idx).trim();
        var key = pair.slice(idx + 1).trim();
        if (!attr || !key) return;
        node.setAttribute(attr, t(key, parseI18nParams(node)));
      });
    });
  }

  /** 语言切换器高亮当前语言。 */
  function updateLangSwitch() {
    document.querySelectorAll(".lang-switch [data-lang]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-lang") === currentLang);
    });
  }

  /** 语言切换回调注册（app.js 重渲染动态区用）。 */
  function onLangChange(cb) {
    if (typeof cb === "function") listeners.push(cb);
  }

  /** 切换语言：写 localStorage、更新 <html lang>、重跑 applyStatic、通知订阅方。 */
  function setLang(lang) {
    var normalized = normalizeLang(lang);
    if (!normalized || SUPPORTED.indexOf(normalized) === -1) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    } catch (e) {
      // localStorage 不可用时仅本次会话生效
    }
    document.documentElement.lang = normalized;
    updateLangSwitch();
    if (normalized === currentLang) return;
    currentLang = normalized;
    applyStatic(document);
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](normalized);
      } catch (e) {
        // 单个回调失败不影响其余回调与切换流程
      }
    }
  }

  function getLang() {
    return currentLang;
  }

  // ---- 导出与初始化 ----
  window.AdminI18n = {
    DICT: DICT,
    t: t,
    detectLang: detectLang,
    setLang: setLang,
    getLang: getLang,
    applyStatic: applyStatic,
    onLangChange: onLangChange,
  };

  // 本脚本置于 body 末尾，DOM 已完整：立即检测语言、校正 <html lang>、应用静态文案。
  currentLang = detectLang();
  document.documentElement.lang = currentLang;
  applyStatic(document);
  updateLangSwitch();

  // 语言切换器事件绑定
  document.querySelectorAll(".lang-switch [data-lang]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setLang(btn.getAttribute("data-lang"));
    });
  });
})();
