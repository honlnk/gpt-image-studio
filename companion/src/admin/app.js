// Companion 管理页 —— 原生 JS，零框架依赖。
//
// 运行在 Companion 同源 loopback 下（127.0.0.1:19750/admin），所有 fetch 走相对路径，
// 不需要 accessKey（凭据/状态/日志的 API 端点都在 loopbackGuard 保护下，本机浏览器默认信任）。
//
// 功能对齐原 Web 项目 CompanionPanel.vue：
// 状态总览、凭据 CRUD + 激活、损坏恢复、日志查看。

// ---- 全局状态 ----
const state = {
  online: false,
  health: null, // { app, version }
  authStatus: null, // { provider, ready, accountLabel, model, ... }
  corrupt: null, // { message } 损坏事件
  presets: [], // ProviderPreset[]
  credentials: [], // CredentialEntry[]
  activeCredentialId: null,
  // 凭据表单本地态：null=新增，string=编辑该 id，""=关闭
  editingId: "",
  showApiKey: {}, // id -> bool 列表中的 key 显隐
  // 日志
  logs: null, // { lines, logFile, date }
  logDate: todayStr(),
  logLines: 100,
  // 存储位置（数据集）
  datasets: [], // DatasetView[]
  activeDataset: null, // DatasetView | null
  ossConfig: null, // 脱敏视图 | null（未配置）
  ossEditing: false, // 已配置凭据时，是否展开完整表单（点「重新配置」后才为 true）
  storageKind: "filesystem-default", // 当前选中的切换目标
  storageSuccess: "", // 切换成功提示（渲染间保留）
  customDirHistory: [], // 历史自定义目录（从数据集记录提取，下拉列表 + 预填）
  dirDropdownOpen: false, // 历史目录下拉展开态
  // 对话框
  dialog: null, // { kind: 'delete'|'reset'|'storage', title, desc, payload? }
  // loading 标记
  loadingCredentials: false,
  loadingPresets: false,
  savingCredentials: false,
  loadingLogs: false,
  loadingReset: false,
  loadingRestore: false,
  loadingStorage: false,
  switchingStorage: false,
  pickingDirectory: false,
  // 开机自启
  autostart: null, // { enabled, platform, linger?, error? }
  autostartLoading: false,
};

// ---- DOM 引用 ----
const $ = (id) => document.getElementById(id);

const el = {
  // 状态
  statusDot: $("status-dot"),
  statusText: $("status-text"),
  statusVersion: $("status-version"),
  offlineHint: $("offline-hint"),
  authSummary: $("auth-summary"),
  // 损坏
  corruptCard: $("corrupt-card"),
  corruptMessage: $("corrupt-message"),
  restoreBtn: $("restore-btn"),
  resetBtn: $("reset-btn"),
  // 凭据
  credentialsCard: $("credentials-card"),
  credentialsLoading: $("credentials-loading"),
  credentialsEmpty: $("credentials-empty"),
  credForm: $("cred-form"),
  formTitle: $("form-title"),
  fLabel: $("f-label"),
  fProvider: $("f-provider"),
  fBaseUrl: $("f-baseurl"),
  fModel: $("f-model"),
  fApiKey: $("f-apikey"),
  formSubmit: $("form-submit"),
  formCancel: $("form-cancel"),
  credList: $("cred-list"),
  credError: $("cred-error"),
  // 日志
  logsCard: $("logs-card"),
  logDate: $("log-date"),
  logLines: $("log-lines"),
  logsPre: $("logs-pre"),
  logsEmpty: $("logs-empty"),
  logsHint: $("logs-hint"),
  logsError: $("logs-error"),
  // 存储位置
  storageCard: $("storage-card"),
  storageLoading: $("storage-loading"),
  storageBody: $("storage-body"),
  storageCurrentLabel: $("storage-current-label"),
  storageCustomDir: $("storage-custom-dir"),
  storageDir: $("storage-dir"),
  storageDirDropdownBtn: $("storage-dir-dropdown-btn"),
  storageDirList: $("storage-dir-list"),
  storagePickDir: $("storage-pick-dir"),
  storageOssForm: $("storage-oss-form"),
  storageOssEndpoint: $("storage-oss-endpoint"),
  storageOssBucket: $("storage-oss-bucket"),
  storageOssAk: $("storage-oss-ak"),
  storageOssSk: $("storage-oss-sk"),
  storageOssCurrent: $("storage-oss-current"),
  storageOssSummary: $("storage-oss-summary"),
  storageOssFields: $("storage-oss-fields"),
  storageOssReconfig: $("storage-oss-reconfig"),
  storageOssReconfigCancel: $("storage-oss-reconfig-cancel"),
  storageOssCancelWrap: $("storage-oss-cancel-wrap"),
  storageError: $("storage-error"),
  storageSuccess: $("storage-success"),
  storageSwitchWrap: $("storage-switch-wrap"),
  storageSwitchBtn: $("storage-switch-btn"),
  // 开机自启
  autostartCard: $("autostart-card"),
  autostartPlatform: $("autostart-platform"),
  autostartToggle: $("autostart-toggle"),
  autostartHint: $("autostart-hint"),
  autostartError: $("autostart-error"),
  // 对话框
  dialogBackdrop: $("dialog-backdrop"),
  dialogTitle: $("dialog-title"),
  dialogDesc: $("dialog-desc"),
  dialogConfirm: $("dialog-confirm"),
  dialogCancel: $("dialog-cancel"),
  // 按钮
  refreshStatus: $("refresh-status"),
  addBtn: $("add-btn"),
  refreshLogs: $("refresh-logs"),
};

// ---- 工具 ----

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "***";
  return key.slice(0, 8) + "***";
}

function providerLabel(id) {
  const p = state.presets.find((x) => x.id === id);
  return p ? p.label : id;
}

async function api(path, options = {}) {
  // 只有带 body 的请求才设 Content-Type，避免 Fastify 对「JSON content-type + 空 body」
  // 报 FST_ERR_CTP_EMPTY_JSON_BODY（激活/删除这类无 body 的 POST/DELETE 不需要该头）。
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, {
    ...options,
    headers,
  });
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      // 非 JSON 错误响应
    }
    const err = new Error(body?.error || `请求失败（${res.status}）`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---- 渲染 ----

function renderStatus() {
  el.statusDot.classList.toggle("online", state.online);
  el.statusDot.classList.toggle("offline", !state.online);
  el.statusText.textContent = state.online ? "Companion 在线" : "Companion 离线";
  el.statusVersion.textContent = state.health ? `v${state.health.version}` : "";
  el.offlineHint.hidden = state.online;

  // 状态摘要
  if (state.online && state.authStatus) {
    const s = state.authStatus;
    const parts = [];
    parts.push(
      `<span class="${s.ready ? "ready-true" : "ready-false"}">${
        s.ready ? "凭据已配置" : "凭据未配置"
      }</span>`,
    );
    if (s.ready) {
      if (s.accountLabel) parts.push(`<span class="meta"> · ${escapeHtml(s.accountLabel)}</span>`);
      if (s.provider) parts.push(`<span class="meta"> · ${escapeHtml(s.provider)}</span>`);
      if (s.model) parts.push(`<span class="meta"> · ${escapeHtml(s.model)}</span>`);
    }
    el.authSummary.innerHTML = parts.join("");
    el.authSummary.hidden = false;
  } else {
    el.authSummary.hidden = true;
  }
}

function renderCorrupt() {
  const hasCorrupt = !!state.corrupt;
  el.corruptCard.hidden = !hasCorrupt;
  if (hasCorrupt) {
    el.corruptMessage.textContent = state.corrupt.message;
  }
  el.restoreBtn.disabled = state.loadingRestore || state.loadingReset;
  el.resetBtn.disabled = state.loadingRestore || state.loadingReset;
  el.restoreBtn.textContent = state.loadingRestore ? "恢复中…" : "从备份恢复";
  el.resetBtn.textContent = state.loadingReset ? "重置中…" : "重置成空配置";
}

function renderCredentialsVisibility() {
  // 损坏时不显示凭据卡、存储位置卡和日志卡
  el.credentialsCard.hidden = !state.online || !!state.corrupt;
  el.logsCard.hidden = !state.online || !!state.corrupt;
  el.storageCard.hidden = !state.online || !!state.corrupt;
}

function renderCredentials() {
  // loading / empty / form 切换
  el.credentialsLoading.hidden = !state.loadingCredentials;
  const showEmpty =
    !state.loadingCredentials && state.credentials.length === 0 && state.editingId === "";
  el.credentialsEmpty.hidden = !showEmpty;
  el.addBtn.hidden = state.editingId !== "";
  el.credForm.hidden = state.editingId === "";

  // 列表
  el.credList.innerHTML = "";
  if (state.editingId === "") {
    for (const entry of state.credentials) {
      el.credList.appendChild(renderEntry(entry));
    }
  }
}

function renderEntry(entry) {
  const node = document.createElement("div");
  node.className = "cred-entry" + (entry.id === state.activeCredentialId ? " active" : "");

  // 头部
  const head = document.createElement("div");
  head.className = "entry-head";

  const dot = document.createElement("span");
  dot.className = "entry-active-dot" + (entry.id === state.activeCredentialId ? " on" : "");
  head.appendChild(dot);

  const label = document.createElement("span");
  label.className = "entry-label";
  label.textContent = entry.label;
  head.appendChild(label);

  if (entry.id === state.activeCredentialId) {
    const badge = document.createElement("span");
    badge.className = "entry-badge";
    badge.textContent = "激活中";
    head.appendChild(badge);
  }

  const actions = document.createElement("div");
  actions.className = "entry-actions";

  if (entry.id !== state.activeCredentialId) {
    const actBtn = document.createElement("button");
    actBtn.className = "btn-entry";
    actBtn.type = "button";
    actBtn.textContent = "激活";
    actBtn.onclick = () => activateCredential(entry.id);
    actions.appendChild(actBtn);
  }

  const editBtn = document.createElement("button");
  editBtn.className = "btn-entry";
  editBtn.type = "button";
  editBtn.textContent = "编辑";
  editBtn.onclick = () => startEdit(entry);
  actions.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "btn-entry danger";
  delBtn.type = "button";
  delBtn.textContent = "删除";
  delBtn.onclick = () => confirmDelete(entry);
  actions.appendChild(delBtn);

  head.appendChild(actions);
  node.appendChild(head);

  // 详情
  const detail = document.createElement("div");
  detail.className = "entry-detail";
  detail.innerHTML = `
    <div><span class="key">Provider：</span><span class="val">${escapeHtml(providerLabel(entry.provider))}</span></div>
    <div><span class="key">Base URL：</span><span class="val mono">${escapeHtml(entry.apiBaseUrl)}</span></div>
    <div><span class="key">Model：</span><span class="val mono">${escapeHtml(entry.model || "（未设置）")}</span></div>
    <div class="apikey-row">
      <span class="key">API Key：</span>
      <span class="val mono" data-key="${entry.id}">${escapeHtml(maskKey(entry.apiKey))}</span>
    </div>
  `;
  // key 显隐按钮
  const keyToggle = document.createElement("button");
  keyToggle.className = "btn-entry";
  keyToggle.type = "button";
  keyToggle.textContent = state.showApiKey[entry.id] ? "隐藏" : "显示";
  keyToggle.onclick = () => {
    state.showApiKey[entry.id] = !state.showApiKey[entry.id];
    const keySpan = detail.querySelector(`[data-key="${entry.id}"]`);
    keySpan.textContent = state.showApiKey[entry.id] ? entry.apiKey : maskKey(entry.apiKey);
    keyToggle.textContent = state.showApiKey[entry.id] ? "隐藏" : "显示";
  };
  detail.querySelector(".apikey-row").appendChild(keyToggle);
  node.appendChild(detail);

  return node;
}

function renderForm() {
  if (state.editingId === "") {
    el.credForm.hidden = true;
    return;
  }
  el.credForm.hidden = false;
  el.formTitle.textContent = state.editingId === null ? "新增配置" : "编辑配置";
  // 下拉
  el.fProvider.innerHTML = "";
  for (const p of state.presets) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    el.fProvider.appendChild(opt);
  }
  el.formSubmit.disabled = state.savingCredentials;
  el.formSubmit.textContent = state.savingCredentials ? "保存中…" : "保存";
}

function renderError(node, msg) {
  node.textContent = msg || "";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDialog() {
  if (!state.dialog) {
    el.dialogBackdrop.hidden = true;
    return;
  }
  el.dialogBackdrop.hidden = false;
  el.dialogTitle.textContent = state.dialog.title;
  el.dialogDesc.textContent = state.dialog.desc;
  el.dialogConfirm.textContent = state.dialog.confirmLabel || "确定";
}

// ---- 数据加载 ----

async function checkStatus() {
  try {
    const health = await api("/health");
    state.online = true;
    state.health = health;
  } catch {
    state.online = false;
    state.health = null;
    state.authStatus = null;
    state.corrupt = null;
    renderAll();
    return;
  }
  try {
    const status = await api("/admin/api/status");
    state.authStatus = status;
  } catch {
    state.authStatus = null;
  }
  renderAll();
  // 在线则懒加载凭据 + 预设 + 存储位置 + 开机自启状态
  await Promise.all([loadPresetsAndCredentials(), loadStorage(), loadAutostart()]);
}

async function loadPresetsAndCredentials() {
  if (!state.online) return;
  await Promise.all([loadPresets(), loadCredentials()]);
}

async function loadPresets() {
  state.loadingPresets = true;
  try {
    state.presets = await api("/credentials/presets");
  } catch (e) {
    // presets 失败不致命，下拉会空，表单仍可手填
    state.presets = [];
  } finally {
    state.loadingPresets = false;
  }
}

async function loadCredentials() {
  state.loadingCredentials = true;
  renderCredentials();
  try {
    const data = await api("/credentials");
    state.credentials = data.entries || [];
    state.activeCredentialId = data.activeId;
    state.corrupt = null;
  } catch (e) {
    if (e.body && e.body.corrupt) {
      // 凭据损坏
      state.corrupt = { message: e.body.error || "凭据文件异常" };
      renderCorrupt();
      renderCredentialsVisibility();
      return;
    }
    renderError(el.credError, e.message);
  } finally {
    state.loadingCredentials = false;
    renderCredentials();
  }
}

async function addCredential(form) {
  state.savingCredentials = true;
  renderForm();
  try {
    await api("/credentials", {
      method: "POST",
      body: JSON.stringify(form),
    });
    state.editingId = "";
    await loadCredentials();
    await refreshStatusOnly();
  } catch (e) {
    renderError(el.credError, e.message);
  } finally {
    state.savingCredentials = false;
    renderForm();
  }
}

async function updateCredential(id, form) {
  state.savingCredentials = true;
  renderForm();
  try {
    await api(`/credentials/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(form),
    });
    state.editingId = "";
    await loadCredentials();
    await refreshStatusOnly();
  } catch (e) {
    renderError(el.credError, e.message);
  } finally {
    state.savingCredentials = false;
    renderForm();
  }
}

async function removeCredential(id) {
  try {
    await api(`/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadCredentials();
    await refreshStatusOnly();
  } catch (e) {
    renderError(el.credError, e.message);
  }
}

async function activateCredential(id) {
  try {
    await api(`/credentials/${encodeURIComponent(id)}/activate`, { method: "POST" });
    await loadCredentials();
    await refreshStatusOnly();
  } catch (e) {
    renderError(el.credError, e.message);
  }
}

async function restoreBackup() {
  state.loadingRestore = true;
  renderCorrupt();
  try {
    await api("/credentials/restore-backup", { method: "POST" });
    state.corrupt = null;
    await loadCredentials();
    await refreshStatusOnly();
  } catch (e) {
    // 恢复失败，保留损坏提示
    state.corrupt = { message: e.message };
  } finally {
    state.loadingRestore = false;
    renderCorrupt();
    renderCredentialsVisibility();
  }
}

async function resetEmpty() {
  state.loadingReset = true;
  renderCorrupt();
  try {
    await api("/credentials/reset-empty", { method: "POST" });
    state.corrupt = null;
    await loadCredentials();
    await refreshStatusOnly();
  } catch (e) {
    state.corrupt = { message: e.message };
  } finally {
    state.loadingReset = false;
    renderCorrupt();
    renderCredentialsVisibility();
  }
}

async function refreshStatusOnly() {
  // 凭据变更后刷新状态摘要（ready/accountLabel 可能变）
  try {
    state.authStatus = await api("/admin/api/status");
  } catch {
    // 状态刷新失败不致命
  }
  renderStatus();
}

async function loadLogs() {
  state.loadingLogs = true;
  el.refreshLogs.textContent = "加载中…";
  el.refreshLogs.disabled = true;
  renderError(el.logsError, "");
  try {
    const params = new URLSearchParams({
      lines: String(state.logLines),
      date: state.logDate,
    });
    const data = await api(`/admin/api/logs?${params}`);
    state.logs = data;
    if (data.lines && data.lines.length) {
      el.logsPre.textContent = data.lines.join("\n");
      el.logsPre.hidden = false;
      el.logsEmpty.hidden = true;
      el.logsHint.hidden = true;
    } else {
      el.logsPre.hidden = true;
      el.logsPre.textContent = "";
      el.logsEmpty.hidden = false;
      el.logsHint.hidden = true;
    }
  } catch (e) {
    renderError(el.logsError, e.message);
    el.logsPre.hidden = true;
    el.logsEmpty.hidden = true;
    el.logsHint.hidden = false;
  } finally {
    state.loadingLogs = false;
    el.refreshLogs.textContent = "刷新";
    el.refreshLogs.disabled = false;
  }
}

// ---- 存储位置（数据集） ----

const STORAGE_KIND_LABELS = {
  "filesystem-default": "默认目录",
  "filesystem-custom": "指定目录",
  oss: "阿里云 OSS",
};

async function loadStorage() {
  if (!state.online) return;
  state.loadingStorage = true;
  renderStorage();
  try {
    const data = await api("/admin/api/datasets");
    state.datasets = data.datasets || [];
    state.activeDataset = state.datasets.find((d) => d.is_active) || null;
    if (state.activeDataset) {
      state.storageKind = state.activeDataset.image_store_kind;
    }
    // 历史自定义目录（数据集注册表里每个 custom 数据集都存了自己的 directory，
    // 提取出来做输入框预填 + datalist 候选，避免用户每次重输路径）
    state.customDirHistory = [
      ...new Set(
        state.datasets
          .filter((d) => d.image_store_kind === "filesystem-custom")
          .map((d) => {
            try {
              return JSON.parse(d.storage_config).directory || "";
            } catch {
              return "";
            }
          })
          .filter(Boolean),
      ),
    ];
    if (!el.storageDir.value && state.customDirHistory.length > 0) {
      el.storageDir.value = state.customDirHistory[0];
    }
  } catch (e) {
    renderError(el.storageError, e.message);
  } finally {
    state.loadingStorage = false;
  }
  // OSS 配置未配置时 GET 返回 404，视为 null 而非错误
  try {
    state.ossConfig = await api("/storage/oss/config");
  } catch (e) {
    state.ossConfig = null;
  }
  renderStorage();
}

// ---- 开机自启 ----

const AUTOSTART_PLATFORM_LABEL = {
  macos: "macOS 登录项",
  linux: "systemd 用户服务",
  windows: "Windows 注册表启动项",
  unsupported: "当前系统不支持",
};

async function loadAutostart() {
  if (!state.online) return;
  try {
    state.autostart = await api("/admin/api/autostart/status");
  } catch {
    state.autostart = null;
  }
  renderAutostart();
}

function renderAutostart() {
  const s = state.autostart;
  el.autostartCard.hidden = !state.online;
  if (!s) {
    el.autostartToggle.disabled = true;
    el.autostartToggle.setAttribute("aria-checked", "false");
    el.autostartToggle.classList.remove("on");
    el.autostartPlatform.textContent = "";
    el.autostartHint.textContent = "";
    el.autostartError.hidden = true;
    return;
  }

  const enabled = s.enabled;
  el.autostartToggle.disabled = state.autostartLoading || s.platform === "unsupported";
  el.autostartToggle.setAttribute("aria-checked", String(enabled));
  el.autostartToggle.classList.toggle("on", enabled);
  el.autostartPlatform.textContent = AUTOSTART_PLATFORM_LABEL[s.platform] || s.platform;

  // 提示文案
  const hints = [];
  if (s.platform === "unsupported") {
    hints.push("当前系统不支持开机自启（仅 macOS / Linux / Windows）。");
  } else if (s.platform === "linux" && enabled && !s.linger) {
    hints.push(
      "当前为「登录即启」。如需「开机即启」（无需登录），请在终端执行：sudo loginctl enable-linger $USER",
    );
  }
  el.autostartHint.textContent = hints.join(" ");

  // error 字段（如 Linux linger 降级提示）
  if (s.error && !hints.length) {
    el.autostartError.textContent = s.error;
    el.autostartError.hidden = false;
  } else {
    el.autostartError.hidden = true;
  }
}

async function toggleAutostart() {
  const s = state.autostart;
  if (!s || state.autostartLoading || s.platform === "unsupported") return;
  state.autostartLoading = true;
  renderAutostart();
  try {
    const path = s.enabled ? "/admin/api/autostart/disable" : "/admin/api/autostart/enable";
    state.autostart = await api(path, { method: "POST" });
  } catch (e) {
    el.autostartError.textContent = `切换失败：${e.message}`;
    el.autostartError.hidden = false;
  } finally {
    state.autostartLoading = false;
    renderAutostart();
  }
}

function renderStorage() {
  el.storageLoading.hidden = !state.loadingStorage;
  el.storageBody.hidden = state.loadingStorage;
  if (state.loadingStorage) return;

  // 当前位置
  if (state.activeDataset) {
    const kind = STORAGE_KIND_LABELS[state.activeDataset.image_store_kind] || "";
    el.storageCurrentLabel.textContent = `${state.activeDataset.label}（${kind}）`;
  } else {
    el.storageCurrentLabel.textContent = "未配置";
  }

  // radio 选中态 + 子表单显隐
  const radios = document.querySelectorAll('input[name="storage-kind"]');
  for (const r of radios) {
    r.checked = r.value === state.storageKind;
  }
  el.storageCustomDir.classList.toggle("open", state.storageKind === "filesystem-custom");
  el.storageOssForm.classList.toggle("open", state.storageKind === "oss");

  // 历史目录下拉：无历史时隐藏 ▾ 按钮；展开态由 state.dirDropdownOpen 驱动
  el.storageDirDropdownBtn.hidden = state.customDirHistory.length === 0;
  el.storageDirDropdownBtn.classList.toggle("open", state.dirDropdownOpen);
  el.storageDirList.hidden = !state.dirDropdownOpen;
  el.storageDirList.innerHTML = "";
  for (const dir of state.customDirHistory) {
    const li = document.createElement("li");
    li.textContent = dir;
    li.title = dir;
    li.onclick = () => selectDirFromHistory(dir);
    el.storageDirList.appendChild(li);
  }

  // 原生目录选择按钮态
  el.storagePickDir.disabled = state.pickingDirectory;
  el.storagePickDir.textContent = state.pickingDirectory ? "选择中…" : "选择文件夹…";

  // OSS：已配置凭据时默认只显示摘要面板（Endpoint/Bucket/脱敏 AK + 重新配置按钮），
  // 点「重新配置」（ossEditing）或未配置时才显示完整表单。表单隐藏时输入框仍保留
  // 预填值，askStorageSwitch 的「沿用已保存凭据」逻辑不受影响。
  const ossConfigured = !!state.ossConfig;
  const showOssFields = !ossConfigured || state.ossEditing;
  el.storageOssSummary.hidden = showOssFields;
  el.storageOssFields.hidden = !showOssFields;
  el.storageOssCancelWrap.hidden = !ossConfigured;
  if (ossConfigured) {
    el.storageOssCurrent.textContent =
      `当前已配置：${state.ossConfig.endpoint} / ${state.ossConfig.bucket}（${state.ossConfig.accessKeyIdMasked}）`;
    if (!el.storageOssEndpoint.value) el.storageOssEndpoint.value = state.ossConfig.endpoint;
    if (!el.storageOssBucket.value) el.storageOssBucket.value = state.ossConfig.bucket;
  }

  // 提示与按钮态：切换按钮仅在选中「新目标」（与当前激活位置不同）时展开
  el.storageSuccess.textContent = state.storageSuccess;
  el.storageSuccess.hidden = !state.storageSuccess;
  const isNewTarget =
    !state.activeDataset || state.storageKind !== state.activeDataset.image_store_kind;
  el.storageSwitchWrap.classList.toggle("open", isNewTarget);
  el.storageSwitchBtn.disabled = state.switchingStorage;
  el.storageSwitchBtn.textContent = state.switchingStorage ? "切换中…" : "切换存储位置";
}

function onStorageKindChange(value) {
  state.storageKind = value;
  state.storageSuccess = "";
  state.dirDropdownOpen = false;
  state.ossEditing = false;
  renderError(el.storageError, "");
  renderStorage();
}

function askStorageSwitch() {
  if (state.switchingStorage) return;
  state.storageSuccess = "";

  // 组装切换请求体（与 web 原 StorageLocationPanel 一致：默认目录 directory 传空串占位，
  // 由 Companion 回填默认目录——指纹命中才能复用原默认数据集）
  let input;
  if (state.storageKind === "oss") {
    const endpoint = el.storageOssEndpoint.value.trim();
    const bucket = el.storageOssBucket.value.trim();
    const accessKeyId = el.storageOssAk.value.trim();
    const accessKeySecret = el.storageOssSk.value.trim();
    if (!endpoint || !bucket) {
      renderError(el.storageError, "请填写 Endpoint 和 Bucket");
      return;
    }
    // 已保存过凭据且 Endpoint/Bucket 未变：AK/SK 留空即沿用（oss-credentials.json 与
    // 数据集解耦，切换位置不丢凭据），无需重新填写也不用重复 PUT。
    const reuseExisting =
      !!state.ossConfig &&
      !accessKeyId &&
      !accessKeySecret &&
      endpoint === state.ossConfig.endpoint &&
      bucket === state.ossConfig.bucket;
    if (!reuseExisting && (!accessKeyId || !accessKeySecret)) {
      renderError(
        el.storageError,
        state.ossConfig
          ? "修改 Endpoint/Bucket 时需重新填写完整的 AccessKey ID 和 Secret；沿用已保存凭据请保持 Endpoint/Bucket 不变并将 AccessKey 留空"
          : "请填写完整的 OSS 配置（endpoint/bucket/AccessKey）",
      );
      return;
    }
    input = {
      storageKind: "oss",
      storageConfig: { endpoint, bucket, prefix: "gpt-image-studio" },
      imageStoreKind: "oss",
      // null 表示沿用已保存凭据（跳过 PUT）
      ossCredentials: reuseExisting ? null : { endpoint, bucket, accessKeyId, accessKeySecret },
    };
  } else if (state.storageKind === "filesystem-custom") {
    const directory = el.storageDir.value.trim();
    if (!directory) {
      renderError(el.storageError, "请输入目录路径");
      return;
    }
    input = {
      storageKind: "filesystem",
      storageConfig: { directory },
      imageStoreKind: "filesystem-custom",
    };
  } else {
    input = {
      storageKind: "filesystem",
      storageConfig: { directory: "" },
      imageStoreKind: "filesystem-default",
    };
  }

  // 确认对话框（当前内容将不可见但不删除）
  const currentLabel = state.activeDataset
    ? `${state.activeDataset.label}（${STORAGE_KIND_LABELS[state.activeDataset.image_store_kind] || ""}）`
    : "未知";
  const newLabel = STORAGE_KIND_LABELS[state.storageKind];
  state.dialog = {
    kind: "storage",
    title: `切换到「${newLabel}」`,
    desc: `切换后，当前「${currentLabel}」的内容将不可见（不会删除），新内容会存到新位置。切回「${currentLabel}」可找回原有内容。是否继续？`,
    confirmLabel: "切换",
    payload: input,
  };
  renderDialog();
}

async function doStorageSwitch(input) {
  state.switchingStorage = true;
  renderError(el.storageError, "");
  state.storageSuccess = "";
  renderStorage();
  try {
    // OSS 模式：先保存 OSS 凭据（含连通性测试，凭据错误会被拒绝）
    if (input.ossCredentials) {
      await api("/storage/oss/config", {
        method: "PUT",
        body: JSON.stringify(input.ossCredentials),
      });
    }
    const body = {
      storageKind: input.storageKind,
      storageConfig: input.storageConfig,
      imageStoreKind: input.imageStoreKind,
    };
    const result = await api("/admin/api/datasets/activate", {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.storageSuccess = result.created
      ? "已创建新数据集并切换。请回到 web 页面刷新，以加载新位置的数据。"
      : "已切换数据集。请回到 web 页面刷新，以加载新位置的数据。";
    // 切换成功后收起 OSS 表单回到摘要面板，并清空 AccessKey 输入（凭据已落盘）
    state.ossEditing = false;
    el.storageOssAk.value = "";
    el.storageOssSk.value = "";
    await loadStorage();
  } catch (e) {
    renderError(el.storageError, `切换失败：${e.message}`);
  } finally {
    state.switchingStorage = false;
    renderStorage();
  }
}

/** 历史目录下拉：展开/收起（不做输入过滤，展示全量历史）。 */
function toggleDirDropdown() {
  state.dirDropdownOpen = !state.dirDropdownOpen;
  renderStorage();
}

function selectDirFromHistory(dir) {
  el.storageDir.value = dir;
  state.dirDropdownOpen = false;
  renderError(el.storageError, "");
  renderStorage();
}

/** 点击下拉外部 / 按 Escape 时关闭。 */
function maybeCloseDirDropdown(event) {
  if (!state.dirDropdownOpen) return;
  if (event.target.closest && event.target.closest(".dir-select-wrap")) return;
  state.dirDropdownOpen = false;
  renderStorage();
}

/** 「选择文件夹…」：调 Companion 弹原生目录选择框（浏览器拿不到绝对路径）。 */
async function pickDirectory() {
  if (state.pickingDirectory) return;
  state.pickingDirectory = true;
  renderStorage();
  try {
    const result = await api("/admin/api/pick-directory", { method: "POST" });
    if (result.ok) {
      el.storageDir.value = result.path;
      renderError(el.storageError, "");
    } else if (!result.canceled) {
      renderError(el.storageError, result.error || "无法打开目录选择框，请手动输入路径");
    }
    // canceled：用户主动取消，静默不提示
  } catch (e) {
    renderError(el.storageError, e.message);
  } finally {
    state.pickingDirectory = false;
    renderStorage();
  }
}

// ---- 表单操作 ----

function startAdd() {
  if (state.presets.length === 0) {
    renderError(el.credError, "Provider 预设加载失败，请刷新页面重试");
    return;
  }
  state.editingId = null;
  el.fLabel.value = "";
  el.fProvider.value = state.presets[0].id;
  el.fBaseUrl.value = state.presets[0].defaultBaseUrl;
  el.fModel.value = state.presets[0].defaultModel;
  el.fApiKey.value = "";
  renderError(el.credError, "");
  renderForm();
  renderCredentials();
}

function startEdit(entry) {
  state.editingId = entry.id;
  el.fLabel.value = entry.label;
  el.fProvider.value = entry.provider;
  el.fBaseUrl.value = entry.apiBaseUrl;
  el.fModel.value = entry.model;
  el.fApiKey.value = entry.apiKey;
  renderError(el.credError, "");
  renderForm();
  renderCredentials();
}

function cancelForm() {
  state.editingId = "";
  el.fApiKey.value = "";
  renderForm();
  renderCredentials();
}

function onProviderChange() {
  const preset = state.presets.find((p) => p.id === el.fProvider.value);
  if (preset) {
    el.fBaseUrl.value = preset.defaultBaseUrl;
    el.fModel.value = preset.defaultModel;
  }
}

function submitForm() {
  const form = {
    label: el.fLabel.value.trim() || undefined,
    provider: el.fProvider.value || undefined,
    apiBaseUrl: el.fBaseUrl.value.trim(),
    apiKey: el.fApiKey.value.trim(),
    model: el.fModel.value.trim() || undefined,
  };
  if (!form.apiBaseUrl || !form.apiKey) {
    renderError(el.credError, "API Base URL 和 API Key 不能为空");
    return;
  }
  renderError(el.credError, "");
  if (state.editingId === null) {
    addCredential(form);
  } else if (state.editingId) {
    updateCredential(state.editingId, form);
  }
}

// ---- 对话框 ----

function confirmDelete(entry) {
  state.dialog = {
    kind: "delete",
    title: `删除「${entry.label}」`,
    desc: "确定删除这条 provider 配置吗？此操作不可撤销。",
    confirmLabel: "删除",
    payload: entry.id,
  };
  renderDialog();
}

function askResetEmpty() {
  state.dialog = {
    kind: "reset",
    title: "重置成空配置",
    desc: "将丢弃当前损坏的凭据文件，写入一份干净的空配置。之前备份的 .corrupt-*.json 文件会保留在配置目录中，可手动找回。确定继续吗？",
    confirmLabel: "重置成空配置",
  };
  renderDialog();
}

function onDialogConfirm() {
  const d = state.dialog;
  state.dialog = null;
  renderDialog();
  if (!d) return;
  if (d.kind === "delete" && d.payload) {
    removeCredential(d.payload);
  } else if (d.kind === "reset") {
    resetEmpty();
  } else if (d.kind === "storage" && d.payload) {
    doStorageSwitch(d.payload);
  }
}

function onDialogCancel() {
  state.dialog = null;
  renderDialog();
}

// ---- 事件绑定 ----

function bindEvents() {
  el.refreshStatus.onclick = () => checkStatus();
  el.addBtn.onclick = () => startAdd();
  el.formSubmit.onclick = () => submitForm();
  el.formCancel.onclick = () => cancelForm();
  el.fProvider.onchange = () => onProviderChange();
  el.restoreBtn.onclick = () => restoreBackup();
  el.resetBtn.onclick = () => askResetEmpty();
  el.refreshLogs.onclick = () => loadLogs();
  el.autostartToggle.onclick = () => toggleAutostart();
  el.storageSwitchBtn.onclick = () => askStorageSwitch();
  el.storagePickDir.onclick = () => pickDirectory();
  el.storageDirDropdownBtn.onclick = () => toggleDirDropdown();
  el.storageOssReconfig.onclick = () => {
    state.ossEditing = true;
    renderStorage();
  };
  el.storageOssReconfigCancel.onclick = () => {
    state.ossEditing = false;
    renderError(el.storageError, "");
    renderStorage();
  };
  document.addEventListener("click", maybeCloseDirDropdown);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") maybeCloseDirDropdown(e);
  });
  document.querySelectorAll('input[name="storage-kind"]').forEach((r) => {
    r.onchange = () => onStorageKindChange(r.value);
  });
  el.logDate.onchange = () => {
    state.logDate = el.logDate.value;
  };
  el.logLines.onchange = () => {
    state.logLines = Number(el.logLines.value);
  };
  el.dialogConfirm.onclick = () => onDialogConfirm();
  el.dialogCancel.onclick = () => onDialogCancel();
  el.dialogBackdrop.onclick = (e) => {
    if (e.target === el.dialogBackdrop) onDialogCancel();
  };
}

// ---- 主入口 ----

function renderAll() {
  renderStatus();
  renderCorrupt();
  renderCredentialsVisibility();
  renderCredentials();
  renderForm();
  renderAutostart();
}

function main() {
  el.logDate.value = state.logDate;
  el.logLines.value = String(state.logLines);
  bindEvents();
  renderAll();
  checkStatus();
}

main();
