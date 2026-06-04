import { store } from "./store.js";

export const $ = (id) => document.getElementById(id);

const els = {
  sessionList: () => $("session-list"),
  sessionsEmpty: () => $("sessions-empty"),
  messageList: () => $("message-list"),
  welcome: () => $("welcome"),
  loading: () => $("loading-indicator"),
  loadingStatus: () => $("loading-status"),
  chatTitle: () => $("chat-title"),
  promptInput: () => $("prompt-input"),
  sendBtn: () => $("send-btn"),
  modelBadge: () => $("model-badge"),
  statusDot: () => $("status-dot"),
  sidebar: () => $("sidebar"),
  overlay: () => $("sidebar-overlay"),
  toast: () => $("toast"),
};

let lastSessionsListKey = "";
let lastActiveSessionId = null;
let lastMessagesKey = "";
let lastMessagesSessionId = null;
let lastHeaderKey = "";
let lastStatusKey = "";
let lastLoadingVisible = null;

function sessionsListKey() {
  return store.sessions.map((s) => `${s.session_id}:${s.title}`).join("|");
}

function messagesKey() {
  return store.messages
    .map((m) => `${m.role}\u0001${m.message}\u0001${m.meta ?? ""}`)
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

export function setSidebarOpen(open) {
  els.sidebar()?.classList.toggle("sidebar--open", open);
  els.overlay()?.classList.toggle("sidebar-overlay--visible", open);
  els.overlay()?.setAttribute("aria-hidden", String(!open));
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

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "session-item__delete icon-btn";
    deleteBtn.dataset.sessionId = session.session_id;
    deleteBtn.setAttribute("aria-label", "Delete conversation");
    deleteBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

    li.append(selectBtn, deleteBtn);
    list.appendChild(li);
  });

  lastSessionsListKey = sessionsListKey();
  lastActiveSessionId = store.activeSessionId;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatMessage(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
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
  body.innerHTML = formatMessage(msg.message);

  if (msg.meta) {
    const meta = document.createElement("span");
    meta.className = "message__meta";
    meta.textContent = msg.meta;
    body.appendChild(meta);
  }

  li.append(avatar, body);
  return li;
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
  updateLoadingStatus();
}

function appendMessages(fromIndex, animate = true) {
  const list = els.messageList();
  if (!list) return;

  for (let i = fromIndex; i < store.messages.length; i += 1) {
    list.appendChild(createMessageElement(store.messages[i], animate));
  }

  lastMessagesKey = messagesKey();
  syncWelcomeAndListVisibility();
  updateLoadingStatus();
}

export function renderMessages() {
  const list = els.messageList();
  if (!list) return;

  const sessionChanged = lastMessagesSessionId !== store.activeSessionId;
  const key = messagesKey();
  const previousCount = list.children.length;

  if (sessionChanged || key !== lastMessagesKey) {
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
  updateLoadingStatus();
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
  const shouldDisable = !hasText || store.isLoading;
  if (sendBtn.disabled !== shouldDisable) {
    sendBtn.disabled = shouldDisable;
  }
}

export function updateLoadingStatus() {
  const loading = els.loading();
  const status = els.loadingStatus();
  if (!loading || !status) return;

  const visible = store.isLoading;
  if (lastLoadingVisible !== visible) {
    loading.classList.toggle("hidden", !visible);
    lastLoadingVisible = visible;
  }

  if (!visible) {
    if (status.textContent !== "Thinking… local models can take 30–90 seconds") {
      status.textContent = "Thinking… local models can take 30–90 seconds";
    }
    return;
  }

  let nextText = "Thinking… local models can take 30–90 seconds";
  if (store.loadingStartedAt) {
    const seconds = Math.floor((Date.now() - store.loadingStartedAt) / 1000);
    if (seconds >= 15) {
      nextText = `Still generating… ${seconds}s elapsed`;
    }
  }

  if (status.textContent !== nextText) {
    status.textContent = nextText;
  }
}

export function renderStatus() {
  const dot = els.statusDot();
  const badge = els.modelBadge();
  if (!dot) return;

  dot.classList.remove("status-dot--ok", "status-dot--error");

  if (store.apiOnline === true) {
    dot.classList.add("status-dot--ok");
    dot.title = "API connected";
  } else if (store.apiOnline === false) {
    dot.classList.add("status-dot--error");
    dot.title = "API unreachable";
  } else {
    dot.title = "Checking API...";
  }

  if (badge && store.modelName) {
    badge.textContent = store.modelName;
  }

  lastStatusKey = `${store.apiOnline}|${store.modelName}`;
}

/** Update only the parts of the UI whose data changed. */
export function renderChanged() {
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
  updateLoadingStatus();

  const statusKey = `${store.apiOnline}|${store.modelName}`;
  if (statusKey !== lastStatusKey) {
    renderStatus();
  }
}

/** Full initial paint (used once on startup). */
export function render() {
  lastSessionsListKey = "";
  lastActiveSessionId = null;
  lastMessagesKey = "";
  lastMessagesSessionId = null;
  lastHeaderKey = "";
  lastStatusKey = "";
  lastLoadingVisible = null;

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
