import { formatMarkdown } from "./markdown.js";
import { patchState, store } from "./store.js";

export const $ = (id) => document.getElementById(id);

const els = {
  sessionList: () => $("session-list"),
  sessionsEmpty: () => $("sessions-empty"),
  modelsEmpty: () => $("models-empty"),
  modelSelect: () => $("model-select"),
  modelDropdownWrap: () => $("model-dropdown-wrap"),
  modelActivateSpinner: () => $("model-activate-spinner"),
  modelActivateLabel: () => $("model-activate-label"),
  messageList: () => $("message-list"),
  welcome: () => $("welcome"),
  chatTitle: () => $("chat-title"),
  promptInput: () => $("prompt-input"),
  sendBtn: () => $("send-btn"),
  statusDot: () => $("status-dot"),
  apiStatusLabel: () => $("api-status-label"),
  sidebar: () => $("sidebar"),
  overlay: () => $("sidebar-overlay"),
  toast: () => $("toast"),
};

let lastSessionsListKey = "";
let lastActiveSessionId = null;
let lastModelsListKey = "";
let lastModelUiKey = "";
let lastMessagesKey = "";
let lastMessagesSessionId = null;
let lastHeaderKey = "";
let lastStatusKey = "";

function modelsListKey() {
  return store.models.map((m) => `${m.name}:${m.size ?? ""}`).join("|");
}

function sessionsListKey() {
  return store.sessions.map((s) => `${s.session_id}:${s.title}`).join("|");
}

function messagesKey() {
  return store.messages
    .map((m) => `${m.role}\u0001${m.message}\u0001${m.meta ?? ""}\u0001${m.streaming ?? ""}`)
    .join("\u0002");
}

function headerKey() {
  const active = store.sessions.find(
    (s) => s.session_id === store.activeSessionId
  );
  return `${store.activeSessionId ?? ""}:${active?.title ?? ""}`;
}

export function showToast(message, isError = false) {
  const toast = els.toast();
  toast.textContent = message;
  toast.classList.toggle("toast--error", isError);
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add("hidden"), 4000);
}

const SIDEBAR_DESKTOP_QUERY = "(min-width: 769px)";

export function isDesktopViewport() {
  return window.matchMedia(SIDEBAR_DESKTOP_QUERY).matches;
}

export function getDefaultSidebarOpen() {
  return isDesktopViewport();
}

export function setSidebarOpen(open) {
  patchState({ isSidebarOpen: open });

  const sidebar = els.sidebar();
  const overlay = els.overlay();
  const app = $("app");
  const toggle = $("sidebar-toggle");

  sidebar?.classList.toggle("sidebar--open", open);
  sidebar?.setAttribute("aria-hidden", String(!open));
  app?.classList.toggle("app--sidebar-open", open);

  const showOverlay = open && !isDesktopViewport();
  overlay?.classList.toggle("sidebar-overlay--visible", showOverlay);
  overlay?.setAttribute("aria-hidden", String(!showOverlay));

  const resize = $("sidebar-resize");
  resize?.classList.toggle("sidebar__resize--visible", open && isDesktopViewport());

  if (toggle) {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close sidebar" : "Open sidebar");
  }
}

export function closeSidebarOnMobile() {
  if (!isDesktopViewport()) {
    setSidebarOpen(false);
  }
}

function updateSessionActiveState() {
  const list = els.sessionList();
  if (!list) return;

  list.querySelectorAll(".session-item").forEach((item) => {
    const sessionId = item.querySelector(".session-item__btn")?.dataset.sessionId;
    item.classList.toggle(
      "session-item--active",
      sessionId === store.activeSessionId
    );
  });
}

function modelUiKey() {
  return [
    modelsListKey(),
    store.selectedModel ?? "",
    store.activeModel ?? "",
    store.isActivatingModel,
    store.isLoading,
  ].join("|");
}

export function renderModelDropdown() {
  const select = els.modelSelect();
  const empty = els.modelsEmpty();
  const wrap = els.modelDropdownWrap();
  const spinner = els.modelActivateSpinner();
  const label = els.modelActivateLabel();
  if (!select) return;

  const { models } = store;
  const isActivating = store.isActivatingModel;

  if (models.length === 0) {
    empty?.classList.remove("hidden");
    select.disabled = true;
    select.replaceChildren();
    wrap?.classList.remove("model-dropdown-wrap--loading");
    spinner?.classList.add("hidden");
    label?.classList.add("hidden");
    lastModelsListKey = "";
    lastModelUiKey = "";
    return;
  }

  empty?.classList.add("hidden");

  const names = models.map((m) => m.name);
  const currentOptions = [...select.options].map((o) => o.value);
  if (currentOptions.join("|") !== names.join("|")) {
    select.replaceChildren();
    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.name;
      const sizeGb =
        model.size && !Number.isNaN(model.size) && model.size > 0
          ? ` (${(model.size / 1e9).toFixed(1)} GB)`
          : "";
      const cloudTag = model.cloud ? " ☁" : "";
      option.textContent = `${model.name}${sizeGb}${cloudTag}`;
      select.appendChild(option);
    });
  }

  if (store.selectedModel && select.value !== store.selectedModel) {
    select.value = store.selectedModel;
  }

  select.disabled =
    isActivating || store.isLoading || models.length === 0;

  wrap?.classList.toggle("model-dropdown-wrap--loading", isActivating);
  spinner?.classList.toggle("hidden", !isActivating);
  spinner?.setAttribute("aria-hidden", String(!isActivating));

  if (label) {
    label.classList.toggle("hidden", !isActivating);
    if (isActivating) {
      label.textContent = `Activating ${store.selectedModel ?? "model"}…`;
    }
  }

  lastModelsListKey = modelsListKey();
  lastModelUiKey = modelUiKey();
}

export function renderSessions() {
  const list = els.sessionList();
  const empty = els.sessionsEmpty();
  if (!list) return;

  list.replaceChildren();
  const { sessions } = store;

  if (sessions.length === 0) {
    empty?.classList.remove("hidden");
    lastSessionsListKey = "";
    return;
  }

  empty?.classList.add("hidden");

  sessions.forEach((session) => {
    const li = document.createElement("li");
    li.className = "session-item";
    if (session.session_id === store.activeSessionId) {
      li.classList.add("session-item--active");
    }

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "session-item__btn";
    selectBtn.textContent = session.title || "Untitled chat";
    selectBtn.dataset.sessionId = session.session_id;
    selectBtn.title = session.title || "Untitled chat";

    const actions = document.createElement("div");
    actions.className = "session-item__actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "session-item__rename icon-btn";
    renameBtn.dataset.sessionId = session.session_id;
    renameBtn.setAttribute("aria-label", "Rename conversation");
    renameBtn.title = "Rename";
    renameBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "session-item__delete icon-btn";
    deleteBtn.dataset.sessionId = session.session_id;
    deleteBtn.setAttribute("aria-label", "Delete conversation");
    deleteBtn.title = "Delete";
    deleteBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

    actions.append(renameBtn, deleteBtn);
    li.append(selectBtn, actions);
    list.appendChild(li);
  });

  lastSessionsListKey = sessionsListKey();
  lastActiveSessionId = store.activeSessionId;
}

function formatInlineText(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function formatMessage(msg) {
  if (msg.role === "assistant") {
    return formatMarkdown(msg.message || "");
  }
  return formatInlineText(msg.message || "").replace(/\n/g, "<br>");
}

function createMessageElement(msg, animate = false) {
  const li = document.createElement("li");
  const isUser = msg.role === "user";
  li.className = `message message--${isUser ? "user" : "assistant"}`;
  if (animate) {
    li.classList.add("message--enter");
  }

  const avatar = document.createElement("div");
  avatar.className = "message__avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = isUser ? "You" : "AI";

  const body = document.createElement("div");
  body.className = "message__body";
  body.classList.toggle("message__body--streaming", Boolean(msg.streaming));
  body.innerHTML = formatMessage(msg);

  if (msg.streaming) {
    const cursor = document.createElement("span");
    cursor.className = "message__cursor";
    body.appendChild(cursor);
  }

  if (msg.meta) {
    const meta = document.createElement("span");
    meta.className = "message__meta";
    meta.textContent = msg.meta;
    body.appendChild(meta);
  }

  if (msg.streaming) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "message__cancel";
    cancel.dataset.cancelChat = "true";
    cancel.textContent = "Cancel";
    body.appendChild(cancel);
  }

  li.append(avatar, body);
  return li;
}

function updateMessageElement(li, msg) {
  const body = li.querySelector(".message__body");
  if (!body) return;

  body.classList.toggle("message__body--streaming", Boolean(msg.streaming));
  body.innerHTML = formatMessage(msg);

  if (msg.streaming) {
    const cursor = document.createElement("span");
    cursor.className = "message__cursor";
    body.appendChild(cursor);
  }

  if (msg.meta) {
    const meta = document.createElement("span");
    meta.className = "message__meta";
    meta.textContent = msg.meta;
    body.appendChild(meta);
  }

  if (msg.streaming) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "message__cancel";
    cancel.dataset.cancelChat = "true";
    cancel.textContent = "Cancel";
    body.appendChild(cancel);
  }
}

function syncWelcomeAndListVisibility() {
  const welcome = els.welcome();
  const list = els.messageList();
  if (!welcome || !list) return;

  const hasMessages = store.messages.length > 0;
  welcome.classList.toggle("hidden", hasMessages || store.isLoading);
  list.classList.toggle("hidden", !hasMessages);
}

function rebuildMessages(animateLast = false) {
  const list = els.messageList();
  if (!list) return;

  list.replaceChildren();
  store.messages.forEach((msg, index) => {
    const animate =
      animateLast && index === store.messages.length - 1 && store.messages.length > 0;
    list.appendChild(createMessageElement(msg, animate));
  });

  lastMessagesKey = messagesKey();
  lastMessagesSessionId = store.activeSessionId;
  syncWelcomeAndListVisibility();
}

function appendMessages(fromIndex, animate = true) {
  const list = els.messageList();
  if (!list) return;

  for (let i = fromIndex; i < store.messages.length; i += 1) {
    list.appendChild(createMessageElement(store.messages[i], animate));
  }

  lastMessagesKey = messagesKey();
  syncWelcomeAndListVisibility();
}

export function renderMessages() {
  const list = els.messageList();
  if (!list) return;

  const sessionChanged = lastMessagesSessionId !== store.activeSessionId;
  const key = messagesKey();
  const previousCount = list.children.length;

  if (sessionChanged || key !== lastMessagesKey) {
    if (!sessionChanged && previousCount === store.messages.length) {
      store.messages.forEach((msg, index) => {
        updateMessageElement(list.children[index], msg);
      });
      lastMessagesKey = key;
      syncWelcomeAndListVisibility();
      return;
    }

    if (
      !sessionChanged &&
      key.startsWith(lastMessagesKey) &&
      store.messages.length > previousCount &&
      previousCount > 0
    ) {
      appendMessages(previousCount, true);
      return;
    }

    rebuildMessages(true);
    return;
  }

  syncWelcomeAndListVisibility();
}

export function renderHeader() {
  const title = els.chatTitle();
  if (!title) return;

  const active = store.sessions.find(
    (s) => s.session_id === store.activeSessionId
  );

  if (active?.title) {
    title.textContent = active.title;
  } else if (store.activeSessionId) {
    title.textContent = "New conversation";
  } else {
    title.textContent = "AI Chatbot Platform";
  }

  lastHeaderKey = headerKey();
}

export function updateComposer() {
  const sendBtn = els.sendBtn();
  if (!sendBtn) return;

  const input = els.promptInput();
  const hasText = (input?.value.trim().length ?? 0) > 0;
  const shouldDisable =
    !hasText ||
    store.isLoading ||
    store.isActivatingModel ||
    !store.selectedModel;
  if (sendBtn.disabled !== shouldDisable) {
    sendBtn.disabled = shouldDisable;
  }
}

export function renderStatus() {
  const dot = els.statusDot();
  const label = els.apiStatusLabel();
  if (!dot) return;

  dot.classList.remove("status-dot--ok", "status-dot--error");

  let statusText = "Checking API…";
  if (store.apiOnline === true) {
    dot.classList.add("status-dot--ok");
    dot.title = "API connected";
    statusText = `${store.models.length} model${store.models.length === 1 ? "" : "s"} available`;
  } else if (store.apiOnline === false) {
    dot.classList.add("status-dot--error");
    dot.title = "API unreachable";
    statusText = "API offline";
  } else {
    dot.title = "Checking API...";
  }

  if (label && label.textContent !== statusText) {
    label.textContent = statusText;
  }

  lastStatusKey = `${store.apiOnline}|${store.models.length}`;
}

/** Update only the parts of the UI whose data changed. */
export function renderChanged() {
  if (modelUiKey() !== lastModelUiKey) {
    renderModelDropdown();
  }

  const listKey = sessionsListKey();

  if (listKey !== lastSessionsListKey) {
    renderSessions();
    renderHeader();
  } else if (store.activeSessionId !== lastActiveSessionId) {
    updateSessionActiveState();
    lastActiveSessionId = store.activeSessionId;
    if (headerKey() !== lastHeaderKey) {
      renderHeader();
    }
  } else if (headerKey() !== lastHeaderKey) {
    renderHeader();
  }

  const msgKey = messagesKey();
  const sessionChanged = lastMessagesSessionId !== store.activeSessionId;

  if (sessionChanged || msgKey !== lastMessagesKey) {
    renderMessages();
  } else {
    syncWelcomeAndListVisibility();
  }

  updateComposer();

  const statusKey = `${store.apiOnline}|${store.models.length}|${store.activeModel ?? ""}`;
  if (statusKey !== lastStatusKey) {
    renderStatus();
  }
}

/** Full initial paint (used once on startup). */
export function render() {
  lastSessionsListKey = "";
  lastActiveSessionId = null;
  lastModelsListKey = "";
  lastModelUiKey = "";
  lastMessagesKey = "";
  lastMessagesSessionId = null;
  lastHeaderKey = "";
  lastStatusKey = "";

  renderModelDropdown();
  renderSessions();
  rebuildMessages(false);
  renderHeader();
  updateComposer();
  renderStatus();
}

export function scrollToBottom() {
  const viewport = $("chat-viewport");
  if (!viewport) return;
  requestAnimationFrame(() => {
    viewport.scrollTop = viewport.scrollHeight;
  });
}

export function autoResizeTextarea(textarea) {
  const maxHeight = 160;
  textarea.style.height = "0px";
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  if (textarea.offsetHeight !== nextHeight) {
    textarea.style.height = `${nextHeight}px`;
  }
}

export { els };
