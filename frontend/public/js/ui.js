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

export function renderSessions() {
  const list = els.sessionList();
  const empty = els.sessionsEmpty();
  if (!list) return;

  list.innerHTML = "";
  const { sessions, activeSessionId } = store;

  if (sessions.length === 0) {
    empty?.classList.remove("hidden");
    return;
  }

  empty?.classList.add("hidden");

  sessions.forEach((session) => {
    const li = document.createElement("li");
    li.className = "session-item";
    if (session.session_id === activeSessionId) {
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
    deleteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>`;

    li.append(selectBtn, deleteBtn);
    list.appendChild(li);
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatMessage(text) {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

export function renderMessages() {
  const list = els.messageList();
  const welcome = els.welcome();
  const { messages, isLoading } = store;

  if (!list || !welcome) return;

  const hasMessages = messages.length > 0;

  welcome.classList.toggle("hidden", hasMessages || isLoading);
  list.classList.toggle("hidden", !hasMessages);

  list.innerHTML = "";

  messages.forEach((msg) => {
    const li = document.createElement("li");
    const isUser = msg.role === "user";
    li.className = `message message--${isUser ? "user" : "assistant"}`;

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
    list.appendChild(li);
  });

  els.loading()?.classList.toggle("hidden", !isLoading);

  const status = els.loadingStatus();
  if (status && isLoading && store.loadingStartedAt) {
    const seconds = Math.floor((Date.now() - store.loadingStartedAt) / 1000);
    status.textContent =
      seconds < 15
        ? "Thinking… local models can take 30–90 seconds"
        : `Still generating… ${seconds}s elapsed`;
  } else if (status) {
    status.textContent = "Thinking… local models can take 30–90 seconds";
  }
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
}

export function renderComposer() {
  const input = els.promptInput();
  const sendBtn = els.sendBtn();
  if (!input || !sendBtn) return;

  const hasText = input.value.trim().length > 0;
  sendBtn.disabled = !hasText || store.isLoading;
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
}

export function render() {
  renderSessions();
  renderMessages();
  renderHeader();
  renderComposer();
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
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
}

export { els };
