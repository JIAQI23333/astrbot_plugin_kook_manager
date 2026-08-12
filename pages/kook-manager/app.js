// ============================================================
// KOOK 消息管理 - 前端逻辑
// 通过 window.AstrBotPluginPage bridge 与 AstrBot Dashboard 通信
// ============================================================

const bridge = window.AstrBotPluginPage;
const $ = (sel) => document.querySelector(sel);

// ---- 元素引用 ----
const els = {
  connStatus: $("#connStatus"),
  themeToggle: $("#themeToggle"),
  channelTree: $("#channelTree"),
  refreshChannels: $("#refreshChannels"),
  searchInput: $("#searchInput"),
  clearSearch: $("#clearSearch"),
  imageOnlyToggle: $("#imageOnlyToggle"),
  autoscrollToggle: $("#autoscrollToggle"),
  currentChannelBadge: $("#currentChannelBadge"),
  emptyState: $("#emptyState"),
  emptyMessages: $("#emptyMessages"),
  noMatch: $("#noMatch"),
  messagesWrap: $("#messagesWrap"),
  loadMoreRow: $("#loadMoreRow"),
  loadMoreBtn: $("#loadMoreBtn"),
  messageList: $("#messageList"),
  configModal: $("#configModal"),
  configClose: $("#configClose"),
  configToken: $("#configToken"),
  configSourceHint: $("#configSourceHint"),
  configClear: $("#configClear"),
  configSave: $("#configSave"),
  deleteModal: $("#deleteModal"),
  deleteCancel: $("#deleteCancel"),
  deleteConfirm: $("#deleteConfirm"),
  toast: $("#toast"),
};

// ---- 状态 ----
const state = {
  guilds: [],
  selfId: "",
  channels: [], // 拍平后的文字频道列表
  currentChannelId: "",
  currentChannelName: "",
  messages: [], // 当前频道的全部已加载消息（升序）
  hasMore: false,
  oldestMsgId: "",
  search: "",
  imageOnly: false,
  autoscroll: true,
  loadingChannels: false,
  loadingMessages: false,
  deleting: false,
  pendingDeleteId: "",
};

// ---- 工具 ----
function esc(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

let toastTimer = null;
function toast(msg, kind = "") {
  els.toast.textContent = msg;
  els.toast.className = `toast ${kind}`.trim();
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2600);
}

function setConn(stateVal, text) {
  els.connStatus.dataset.state = stateVal;
  els.connStatus.querySelector(".conn-text").textContent = text;
}

// ---- 主题 ----
function applyTheme(isDark) {
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
}

async function initTheme() {
  const ctx = await bridge.ready();
  applyTheme(Boolean(ctx.isDark));
  bridge.onContext((c) => applyTheme(Boolean(c.isDark)));
}

// ---- 频道树 ----
function buildChannelTree() {
  const root = els.channelTree;
  root.innerHTML = "";

  if (!state.guilds.length) {
    root.innerHTML = '<div class="no-channels">未找到机器人加入的服务器。</div>';
    return;
  }

  for (const guild of state.guilds) {
    const group = document.createElement("div");
    group.className = "guild-group open";

    const head = document.createElement("div");
    head.className = "guild-head";

    const icon = document.createElement("img");
    icon.className = "guild-icon";
    icon.src = guild.icon || "";
    icon.alt = "";
    icon.onerror = () => (icon.style.display = "none");

    const name = document.createElement("span");
    name.className = "guild-name";
    name.textContent = guild.name || "未命名服务器";

    const caret = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    caret.setAttribute("class", "guild-caret");
    caret.setAttribute("viewBox", "0 0 24 24");
    caret.setAttribute("fill", "none");
    caret.setAttribute("stroke", "currentColor");
    caret.setAttribute("stroke-width", "2.5");
    caret.setAttribute("stroke-linecap", "round");
    caret.setAttribute("stroke-linejoin", "round");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m9 18 6-6-6-6");
    caret.appendChild(path);

    head.append(icon, name, caret);
    head.addEventListener("click", () => group.classList.toggle("open"));

    const list = document.createElement("div");
    list.className = "guild-channels";

    if (!guild.channels.length) {
      const none = document.createElement("div");
      none.className = "no-channels";
      none.textContent = "没有文字频道";
      list.appendChild(none);
    } else {
      for (const ch of guild.channels) {
        const item = document.createElement("div");
        item.className = "channel-item";
        item.dataset.channelId = ch.id;
        item.dataset.channelName = ch.name;

        const hash = document.createElement("span");
        hash.className = "channel-hash";
        hash.textContent = "#";

        const chName = document.createElement("span");
        chName.className = "channel-name";
        chName.textContent = ch.name;

        item.append(hash, chName);
        item.addEventListener("click", () => selectChannel(ch.id, ch.name));
        list.appendChild(item);
      }
    }

    group.append(head, list);
    root.appendChild(group);
  }
}

function highlightActiveChannel() {
  document.querySelectorAll(".channel-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.channelId === state.currentChannelId);
  });
}

async function loadChannels() {
  if (state.loadingChannels) return;
  state.loadingChannels = true;
  els.refreshChannels.disabled = true;
  try {
    const res = await bridge.apiGet("guilds");
    if (!res || !res.ok) {
      const msg = (res && res.message) || "加载失败";
      setConn("error", "加载失败");
      toast(msg, "error");
      return;
    }
    state.guilds = res.guilds || [];
    state.selfId = res.self_id || "";
    setConn("ok", "已连接");
    buildChannelTree();
    // 尽量保持当前选中频道可见
    highlightActiveChannel();
  } catch (e) {
    setConn("error", "连接失败");
    toast("加载频道失败：" + e.message, "error");
  } finally {
    state.loadingChannels = false;
    els.refreshChannels.disabled = false;
  }
}

// ---- 消息加载 ----
async function loadMessages({ prepend = false } = {}) {
  if (!state.currentChannelId) return;
  if (state.loadingMessages) return;
  state.loadingMessages = true;

  const params = { channel_id: state.currentChannelId, page_size: 50 };
  if (prepend && state.oldestMsgId) {
    params.msg_id = state.oldestMsgId;
  }

  try {
    const res = await bridge.apiGet("messages", params);
    if (!res || !res.ok) {
      toast((res && res.message) || "加载消息失败", "error");
      return;
    }

    const prevHeight = els.messageList.scrollHeight;
    const prevScrollTop = els.messageList.scrollTop;

    const newMsgs = res.messages || [];
    state.hasMore = Boolean(res.has_more);

    if (prepend) {
      state.messages = [...newMsgs, ...state.messages];
    } else {
      state.messages = newMsgs;
    }

    // 记录最早一条消息 id 用于更早分页
    state.oldestMsgId = state.messages.length ? state.messages[0].id : "";

    renderMessages();

    if (prepend) {
      // 保持滚动位置（新内容插入在顶部之后，恢复之前的可视区域）
      const afterHeight = els.messageList.scrollHeight;
      els.messageList.scrollTop = prevScrollTop + (afterHeight - prevHeight);
    } else {
      scrollToBottom();
    }

    els.loadMoreRow.hidden = !state.hasMore;
    els.loadMoreBtn.disabled = false;
  } catch (e) {
    toast("加载消息失败：" + e.message, "error");
  } finally {
    state.loadingMessages = false;
  }
}

function selectChannel(channelId, channelName) {
  if (state.currentChannelId === channelId) return;
  state.currentChannelId = channelId;
  state.currentChannelName = channelName;
  state.messages = [];
  state.hasMore = false;
  state.oldestMsgId = "";

  els.currentChannelBadge.hidden = false;
  els.currentChannelBadge.textContent = `# ${channelName}`;
  els.loadMoreRow.hidden = true;

  highlightActiveChannel();
  updateEmptyStates();

  els.messageList.innerHTML = "";
  loadMessages();
}

// ---- 渲染 ----
function segIcon(kind) {
  if (kind === "image") {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
  }
  if (kind === "video") {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-3v10l-6-3z"/></svg>';
  }
  if (kind === "file") {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  }
  if (kind === "audio") {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  }
  return "";
}

function segmentHtml(seg) {
  if (seg.kind === "image") {
    return `<img class="seg-image" src="${esc(seg.url)}" alt="图片" loading="lazy" data-full="${esc(seg.url)}" />`;
  }
  if (seg.kind === "video") {
    return `<video class="seg-video" src="${esc(seg.url)}" controls preload="metadata"></video>`;
  }
  if (seg.kind === "file") {
    return `<a class="seg-file" href="${esc(seg.url)}" target="_blank" rel="noopener">${segIcon("file")}<span>${esc(seg.name || "文件")}</span></a>`;
  }
  if (seg.kind === "audio") {
    return `<a class="seg-file" href="${esc(seg.url)}" target="_blank" rel="noopener">${segIcon("audio")}<span>音频</span></a>`;
  }
  return `<span class="seg-text">${esc(seg.text)}</span>`;
}

function msgHtml(msg, index) {
  const segs = (msg.segments || []).map(segmentHtml).join("");
  const time = fmtTime(msg.create_at);
  const initial = (msg.author || "机")[0];

  return `
    <div class="msg" data-id="${esc(msg.id)}" data-index="${index}">
      <div class="msg-avatar">${esc(initial)}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-author">${esc(msg.author)}</span>
          <span class="msg-time">${esc(time)}</span>
        </div>
        <div class="msg-content">${segs}</div>
      </div>
      <div class="msg-actions">
        <button class="delete-btn" data-delete="${esc(msg.id)}" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          删除
        </button>
      </div>
    </div>
  `;
}

function matchesFilter(msg) {
  if (state.imageOnly) {
    const hasImage = (msg.segments || []).some((s) => s.kind === "image");
    if (!hasImage) return false;
  }
  if (state.search) {
    const hay = ((msg.search_text || "") + " " + JSON.stringify(msg.segments || [])).toLowerCase();
    if (!hay.includes(state.search.toLowerCase())) return false;
  }
  return true;
}

function renderMessages() {
  const filtered = state.messages.filter(matchesFilter);
  const wrap = els.messageList;

  // 三种空状态
  const hasAnyMessages = state.messages.length > 0;
  const hasFiltered = filtered.length > 0;

  els.emptyState.hidden = Boolean(state.currentChannelId);
  els.emptyMessages.hidden = hasAnyMessages || !state.currentChannelId;
  els.noMatch.hidden = !(hasAnyMessages && !hasFiltered);

  if (!state.currentChannelId) {
    wrap.innerHTML = "";
    els.messagesWrap.hidden = true;
    return;
  }
  els.messagesWrap.hidden = false;

  if (!hasAnyMessages) {
    wrap.innerHTML = "";
    return;
  }
  if (!hasFiltered) {
    wrap.innerHTML = "";
    return;
  }

  wrap.innerHTML = filtered.map(msgHtml).join("");

  // 图片点击放大
  wrap.querySelectorAll(".seg-image").forEach((img) => {
    img.addEventListener("click", () => {
      openImage(img.dataset.full || img.src);
    });
  });

  // 删除按钮事件
  wrap.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.pendingDeleteId = btn.dataset.delete;
      els.deleteModal.hidden = false;
    });
  });
}

function updateEmptyStates() {
  const hasAny = state.messages.length > 0;
  const filtered = state.messages.filter(matchesFilter).length > 0;

  // 未选频道时只显示引导空状态，隐藏消息容器
  els.messagesWrap.hidden = !state.currentChannelId;
  els.emptyState.hidden = Boolean(state.currentChannelId);
  els.emptyMessages.hidden = hasAny || !state.currentChannelId;
  els.noMatch.hidden = !(hasAny && !filtered);
}

// ---- 滚动 ----
function scrollToBottom() {
  if (!state.autoscroll) return;
  requestAnimationFrame(() => {
    els.messageList.scrollTop = els.messageList.scrollHeight;
  });
}

function isNearBottom() {
  const el = els.messageList;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

// ---- 删除 ----
async function deleteMessage(msgId) {
  if (state.deleting) return;
  state.deleting = true;
  els.deleteConfirm.disabled = true;
  try {
    const res = await bridge.apiPost("messages/delete", { msg_id: msgId });
    if (!res || !res.ok) {
      toast((res && res.message) || "删除失败", "error");
      return;
    }
    state.messages = state.messages.filter((m) => m.id !== msgId);
    renderMessages();
    toast("消息已删除", "ok");
  } catch (e) {
    toast("删除失败：" + e.message, "error");
  } finally {
    state.deleting = false;
    els.deleteConfirm.disabled = false;
    els.deleteModal.hidden = true;
  }
}

// ---- 配置 ----
async function openConfig() {
  els.configModal.hidden = false;
  try {
    const res = await bridge.apiGet("config");
    if (res && res.override && res.override.token) {
      els.configToken.value = res.override.token;
    } else {
      els.configToken.value = "";
    }
    const srcText = {
      override: "当前使用插件配置中的手动 Token。",
      adapter: "当前自动读取 AstrBot KOOK 适配器的 Token。",
      global_config: "当前自动读取 AstrBot 全局配置的 Token。",
      none: "未找到 Token，请填写下方机器人 Token。",
    };
    els.configSourceHint.textContent = srcText[res.effective_source] || "";
  } catch (e) {
    els.configSourceHint.textContent = "读取配置失败：" + e.message;
  }
}

async function saveConfig() {
  const token = els.configToken.value.trim();
  try {
    await bridge.apiPost("config/save", { token });
    els.configModal.hidden = true;
    toast("配置已保存，正在重新连接…", "ok");
    setTimeout(async () => {
      await loadChannels();
      if (state.currentChannelId) loadMessages();
    }, 300);
  } catch (e) {
    toast("保存失败：" + e.message, "error");
  }
}

// ---- 图片预览 ----
function openImage(url) {
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(
      `<body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh">` +
        `<img src="${esc(url)}" style="max-width:100%;max-height:100%;object-fit:contain"></body>`
    );
  }
}

// ---- 事件绑定 ----
els.themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next === "dark");
});

els.refreshChannels.addEventListener("click", loadChannels);

els.searchInput.addEventListener("input", () => {
  state.search = els.searchInput.value.trim();
  els.clearSearch.hidden = !state.search;
  renderMessages();
  scrollToBottom();
});

els.clearSearch.addEventListener("click", () => {
  els.searchInput.value = "";
  state.search = "";
  els.clearSearch.hidden = true;
  renderMessages();
  scrollToBottom();
});

els.imageOnlyToggle.addEventListener("click", () => {
  state.imageOnly = !state.imageOnly;
  els.imageOnlyToggle.classList.toggle("active", state.imageOnly);
  els.imageOnlyToggle.setAttribute("aria-pressed", String(state.imageOnly));
  renderMessages();
  scrollToBottom();
});

els.autoscrollToggle.addEventListener("click", () => {
  state.autoscroll = !state.autoscroll;
  els.autoscrollToggle.classList.toggle("active", state.autoscroll);
  els.autoscrollToggle.setAttribute("aria-pressed", String(state.autoscroll));
  if (state.autoscroll) scrollToBottom();
});

// 用户向上滚动离开底部时，暂停自动滚动
els.messageList.addEventListener("scroll", () => {
  if (state.autoscroll && !isNearBottom()) {
    state.autoscroll = false;
    els.autoscrollToggle.classList.remove("active");
    els.autoscrollToggle.setAttribute("aria-pressed", "false");
  }
});

// 加载更早消息
els.loadMoreBtn.addEventListener("click", () => {
  if (state.loadingMessages) return;
  els.loadMoreBtn.disabled = true;
  loadMessages({ prepend: true });
});

// 配置弹层
els.configClose.addEventListener("click", () => (els.configModal.hidden = true));
els.configModal.addEventListener("click", (e) => {
  if (e.target === els.configModal) els.configModal.hidden = true;
});
els.configSave.addEventListener("click", saveConfig);
els.configClear.addEventListener("click", async () => {
  els.configToken.value = "";
  await saveConfig();
});
// 顶栏连接状态点击打开配置
els.connStatus.addEventListener("click", openConfig);

// 删除弹层
els.deleteCancel.addEventListener("click", () => (els.deleteModal.hidden = true));
els.deleteConfirm.addEventListener("click", () => {
  if (state.pendingDeleteId) deleteMessage(state.pendingDeleteId);
});
els.deleteModal.addEventListener("click", (e) => {
  if (e.target === els.deleteModal) els.deleteModal.hidden = true;
});

// 键盘：Esc 关闭弹层
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    els.configModal.hidden = true;
    els.deleteModal.hidden = true;
  }
});

// ---- 启动 ----
async function boot() {
  await initTheme();
  buildChannelTree();
  updateEmptyStates();
  loadChannels();
}

boot();
