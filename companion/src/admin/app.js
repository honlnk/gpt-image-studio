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
  // 对话框
  dialog: null, // { kind: 'delete'|'reset', title, desc, payload? }
  // loading 标记
  loadingCredentials: false,
  loadingPresets: false,
  savingCredentials: false,
  loadingLogs: false,
  loadingReset: false,
  loadingRestore: false,
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
  // 损坏时不显示凭据卡和日志卡
  el.credentialsCard.hidden = !state.online || !!state.corrupt;
  el.logsCard.hidden = !state.online || !!state.corrupt;
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
  // 在线则懒加载凭据 + 预设 + 日志
  await loadPresetsAndCredentials();
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
}

function main() {
  el.logDate.value = state.logDate;
  el.logLines.value = String(state.logLines);
  bindEvents();
  renderAll();
  checkStatus();
}

main();
