import { api, ApiError, CHAT_TIMEOUT_MS } from "./api.js";
import { MODEL_STORAGE_KEY, STORAGE_KEY } from "./config.js";
import {
  bindSidebarResize,
  initSidebarWidth,
  SIDEBAR_TOGGLE_ICON,
} from "./sidebar.js";
import {
  createSessionId,
  getActiveSession,
  patchState,
  store,
  subscribe,
} from "./store.js";
import {
  $,
  autoResizeTextarea,
  els,
  render,
  renderChanged,
  scrollToBottom,
  closeSidebarOnMobile,
  getDefaultSidebarOpen,
  setSidebarOpen,
  showToast,
  updateComposer,
} from "./ui.js";

function persistActiveSession() {
  if (store.activeSessionId) {
    localStorage.setItem(STORAGE_KEY, store.activeSessionId);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function persistSelectedModel() {
  if (store.selectedModel) {
    localStorage.setItem(MODEL_STORAGE_KEY, store.selectedModel);
  }
}

async function checkHealth() {
  try {
    await api.health();
    patchState({ apiOnline: true });
  } catch {
    patchState({ apiOnline: false });
  }
}

async function loadModels(showFeedback = false) {
  try {
    const data = await api.models();
    const models = Array.isArray(data?.models) ? data.models : [];
    const defaultModel = data?.default ?? store.defaultModel;

    let selected = localStorage.getItem(MODEL_STORAGE_KEY);
    if (!selected || !models.some((m) => m.name === selected)) {
      selected =
        models.find((m) => m.name === defaultModel)?.name ??
        models[0]?.name ??
        defaultModel;
    }

    patchState({
      models,
      selectedModel: selected,
      activeModel: data?.active ?? store.activeModel,
      defaultModel,
      apiOnline: true,
    });
    persistSelectedModel();

    if (selected && models.some((m) => m.name === selected)) {
      activateModel(selected, { quiet: true });
    }

    if (showFeedback) {
      showToast(
        models.length
          ? `Loaded ${models.length} model${models.length === 1 ? "" : "s"}`
          : "No models installed in Ollama"
      );
    }
  } catch (err) {
    patchState({ apiOnline: false });
    if (showFeedback || store.models.length === 0) {
      showToast(
        err instanceof ApiError ? err.message : "Failed to load models",
        true
      );
    }
  }
}

async function refreshSessions() {
  try {
    const sessions = await api.sessions();
    patchState({
      sessions: Array.isArray(sessions) ? sessions : [],
      apiOnline: true,
    });
  } catch (err) {
    patchState({ apiOnline: false });
    if (err instanceof ApiError) showToast(err.message, true);
  }
}

async function loadSessionMemory(sessionId) {
  try {
    const memory = await api.memory(sessionId);
    patchState({
      messages: Array.isArray(memory) ? memory : [],
      activeSessionId: sessionId,
      isLoading: false,
    });
    persistActiveSession();
    scrollToBottom();
  } catch (err) {
    showToast(
      err instanceof ApiError ? err.message : "Failed to load conversation",
      true
    );
  }
}

let modelActivateController = null;
let activateGeneration = 0;

async function activateModel(modelName, { quiet = false } = {}) {
  if (!modelName) return;

  if (
    modelName === store.activeModel &&
    modelName === store.selectedModel &&
    !store.isActivatingModel
  ) {
    persistSelectedModel();
    return;
  }

  if (store.isLoading) return;

  const generation = ++activateGeneration;
  const previousSelected = store.selectedModel;
  const previousActive = store.activeModel;

  modelActivateController?.abort();
  modelActivateController = new AbortController();

  patchState({
    isActivatingModel: true,
    selectedModel: modelName,
  });

  try {
    const result = await api.activateModel(
      modelName,
      modelActivateController.signal
    );

    if (generation !== activateGeneration) return;

    const unloaded = result.unloaded?.length
      ? ` (unloaded ${result.unloaded.join(", ")})`
      : "";

    patchState({
      selectedModel: modelName,
      activeModel: result.active ?? modelName,
      isActivatingModel: false,
    });
    persistSelectedModel();

    if (!quiet) {
      showToast(`${modelName} is now active${unloaded}`);
    }
  } catch (err) {
    if (generation !== activateGeneration) return;

    if (err.name !== "AbortError") {
      patchState({
        selectedModel: previousSelected,
        activeModel: previousActive,
      });

      const select = $("model-select");
      if (select && previousSelected) {
        select.value = previousSelected;
      }

      showToast(
        err instanceof ApiError ? err.message : "Failed to activate model",
        true
      );
    }
  } finally {
    if (generation === activateGeneration) {
      patchState({ isActivatingModel: false });
      modelActivateController = null;
    }
  }
}

function startNewChat() {
  const sessionId = createSessionId();
  patchState({
    activeSessionId: sessionId,
    messages: [],
    isLoading: false,
  });
  persistActiveSession();
  closeSidebarOnMobile();
  els.promptInput()?.focus();
}

async function selectSession(sessionId) {
  if (sessionId === store.activeSessionId && store.messages.length > 0) {
    closeSidebarOnMobile();
    return;
  }

  patchState({ activeSessionId: sessionId, messages: [], isLoading: false });
  persistActiveSession();
  await loadSessionMemory(sessionId);
  closeSidebarOnMobile();
}

async function renameSession(sessionId) {
  const session = store.sessions.find((s) => s.session_id === sessionId);
  const current = session?.title || "Untitled chat";
  const next = window.prompt("Rename conversation", current);
  if (next === null) return;

  const trimmed = next.trim();
  if (!trimmed || trimmed === current) return;

  try {
    await api.renameSession(sessionId, trimmed);
    patchState({
      sessions: store.sessions.map((s) =>
        s.session_id === sessionId ? { ...s, title: trimmed } : s
      ),
    });
    showToast("Conversation renamed");
  } catch (err) {
    showToast(
      err instanceof ApiError ? err.message : "Failed to rename conversation",
      true
    );
  }
}

async function deleteSession(sessionId) {
  const confirmed = window.confirm(
    "Delete this conversation? This cannot be undone."
  );
  if (!confirmed) return;

  try {
    await api.deleteSession(sessionId);
    await refreshSessions();

    if (store.activeSessionId === sessionId) {
      if (store.sessions.length > 0) {
        await selectSession(store.sessions[0].session_id);
      } else {
        startNewChat();
      }
    }

    showToast("Conversation deleted");
  } catch (err) {
    showToast(
      err instanceof ApiError ? err.message : "Failed to delete session",
      true
    );
  }
}

let chatAbortController = null;

function cancelChatRequest() {
  chatAbortController?.abort();
  patchState({ isLoading: false, loadingStartedAt: null });
  showToast("Request cancelled");
}

function updateMessageAt(index, updates) {
  const messages = store.messages.map((message, currentIndex) =>
    currentIndex === index ? { ...message, ...updates } : message
  );
  patchState({ messages });
}

function createTokenAnimator(messageIndex) {
  let queued = "";
  let visible = "";
  let frame = null;
  let resolveIdle;
  let idlePromise = Promise.resolve();

  const finishIdle = () => {
    if (resolveIdle && queued.length === 0) {
      resolveIdle();
      resolveIdle = null;
    }
  };

  const paint = () => {
    if (queued.length === 0) {
      frame = null;
      finishIdle();
      return;
    }

    const step = Math.min(Math.max(Math.ceil(queued.length / 6), 1), 8);
    visible += queued.slice(0, step);
    queued = queued.slice(step);
    updateMessageAt(messageIndex, { message: visible });
    scrollToBottom();
    frame = requestAnimationFrame(paint);
  };

  return {
    push(token) {
      if (!token) return;
      queued += token;
      if (!resolveIdle) {
        idlePromise = new Promise((resolve) => {
          resolveIdle = resolve;
        });
      }
      if (!frame) {
        frame = requestAnimationFrame(paint);
      }
    },
    async flush() {
      await idlePromise;
      return visible;
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      queued = "";
      finishIdle();
    },
  };
}

function generatingMeta(model, startedAt, source = "ollama") {
  const prefix = source === "redis" ? "Cached" : "Generating";
  const modelLabel = model ?? store.selectedModel ?? "model";
  if (!startedAt || source === "redis") {
    return `${prefix} · ${modelLabel}`;
  }

  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  return seconds >= 3
    ? `${prefix} · ${modelLabel} · ${seconds}s`
    : `${prefix} · ${modelLabel}`;
}

async function sendMessage(prompt) {
  const trimmed = prompt.trim();
  if (!trimmed || store.isLoading) return;

  if (!store.selectedModel) {
    showToast("Select a model before chatting", true);
    return;
  }

  if (store.isActivatingModel) {
    showToast("Wait for the model to finish loading", true);
    return;
  }

  if (store.activeModel !== store.selectedModel) {
    showToast("Activating model, please try again in a moment", true);
    activateModel(store.selectedModel, { quiet: true });
    return;
  }

  let sessionId = store.activeSessionId;
  if (!sessionId) {
    sessionId = createSessionId();
    patchState({ activeSessionId: sessionId });
    persistActiveSession();
  }

  const userMessage = { role: "user", message: trimmed };
  const assistantMessage = {
    role: "assistant",
    message: "",
    meta: `Connecting · ${store.selectedModel}`,
    streaming: true,
  };
  chatAbortController = new AbortController();
  const timeoutId = setTimeout(() => chatAbortController?.abort(), CHAT_TIMEOUT_MS);

  const nextMessages = [...store.messages, userMessage, assistantMessage];
  const assistantIndex = nextMessages.length - 1;
  const animator = createTokenAnimator(assistantIndex);
  let streamMeta = {
    source: "ollama",
    model: store.selectedModel,
    truncated: false,
  };
  const startedAt = Date.now();
  let metaTimer = null;

  patchState({
    messages: nextMessages,
    isLoading: true,
    loadingStartedAt: Date.now(),
  });
  metaTimer = setInterval(() => {
    updateMessageAt(assistantIndex, {
      meta: generatingMeta(streamMeta.model, startedAt, streamMeta.source),
    });
  }, 1000);
  scrollToBottom();

  try {
    await api.chatStream(
      sessionId,
      trimmed,
      store.selectedModel,
      chatAbortController.signal,
      {
        meta(event) {
          streamMeta = { ...streamMeta, ...event };
          updateMessageAt(assistantIndex, {
            meta: generatingMeta(
              event.model ?? store.selectedModel,
              startedAt,
              event.source
            ),
          });
        },
        token(event) {
          animator.push(event.token);
        },
        done(event) {
          streamMeta = { ...streamMeta, ...event };
        },
      }
    );
    const finalAnswer = await animator.flush();
    let sourceLabel =
      streamMeta.source === "redis"
        ? `Cached · ${streamMeta.model ?? store.selectedModel}`
        : `via ${streamMeta.model ?? store.selectedModel}`;

    if (streamMeta.truncated) {
      sourceLabel += " · Hit token limit — ask to continue";
    }

    updateMessageAt(assistantIndex, {
      message: finalAnswer,
      meta: sourceLabel,
      streaming: false,
    });

    await refreshSessions();

    const active = getActiveSession();
    if (!active) {
      patchState({
        sessions: [
          {
            session_id: sessionId,
            title: trimmed.slice(0, 50),
          },
          ...store.sessions,
        ],
      });
    }

    scrollToBottom();
  } catch (err) {
    animator.stop();
    if (err.name === "AbortError") {
      updateMessageAt(assistantIndex, {
        message: "Response interrupted.",
        meta: `via ${store.selectedModel}`,
        streaming: false,
      });
      showToast("Request cancelled or timed out. Try again.", true);
    } else {
      updateMessageAt(assistantIndex, {
        message: "Response failed.",
        meta: `via ${store.selectedModel}`,
        streaming: false,
      });
      showToast(
        err instanceof ApiError
          ? err.message
          : "Failed to get a response. Is Ollama running?",
        true
      );
    }
    scrollToBottom();
  } finally {
    clearTimeout(timeoutId);
    if (metaTimer) clearInterval(metaTimer);
    chatAbortController = null;
    patchState({ isLoading: false, loadingStartedAt: null });
  }
}

function bindEvents() {
  subscribe(() => renderChanged());

  $("new-chat-btn")?.addEventListener("click", startNewChat);

  $("refresh-models-btn")?.addEventListener("click", () =>
    loadModels(true)
  );

  $("model-select")?.addEventListener("change", (e) => {
    activateModel(e.target.value);
  });

  const sidebarToggle = $("sidebar-toggle");
  if (sidebarToggle) {
    sidebarToggle.innerHTML = SIDEBAR_TOGGLE_ICON;
    sidebarToggle.addEventListener("click", () =>
      setSidebarOpen(!store.isSidebarOpen)
    );
  }

  $("sidebar-overlay")?.addEventListener("click", () => setSidebarOpen(false));
  bindSidebarResize();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && store.isSidebarOpen) {
      setSidebarOpen(false);
    }
  });

  window.addEventListener("resize", () => {
    if (store.isSidebarOpen) {
      setSidebarOpen(true);
    }
  });

  $("session-list")?.addEventListener("click", (e) => {
    const renameBtn = e.target.closest(".session-item__rename");
    if (renameBtn?.dataset.sessionId) {
      e.stopPropagation();
      renameSession(renameBtn.dataset.sessionId);
      return;
    }

    const deleteBtn = e.target.closest(".session-item__delete");
    if (deleteBtn?.dataset.sessionId) {
      e.stopPropagation();
      deleteSession(deleteBtn.dataset.sessionId);
      return;
    }

    const selectBtn = e.target.closest(".session-item__btn");
    if (selectBtn?.dataset.sessionId) {
      selectSession(selectBtn.dataset.sessionId);
    }
  });

  $("message-list")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-cancel-chat]")) {
      cancelChatRequest();
    }
  });

  const form = $("chat-form");
  const input = $("prompt-input");

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!input) return;
    const value = input.value;
    input.value = "";
    autoResizeTextarea(input);
    sendMessage(value);
  });

  input?.addEventListener("input", () => {
    autoResizeTextarea(input);
    updateComposer();
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form?.requestSubmit();
    }
  });

  document.querySelectorAll(".hint-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = chip.dataset.prompt;
      if (prompt) sendMessage(prompt);
    });
  });

  $("cancel-chat-btn")?.addEventListener("click", cancelChatRequest);
}

async function init() {
  try {
    bindEvents();
  } catch (err) {
    console.error("Failed to bind UI events:", err);
    showToast("UI failed to initialize. Please refresh the page.", true);
    return;
  }

  initSidebarWidth();
  setSidebarOpen(getDefaultSidebarOpen());
  render();

  await Promise.all([checkHealth(), loadModels(), refreshSessions()]);

  const saved = localStorage.getItem(STORAGE_KEY);
  const sessionExists =
    saved && store.sessions.some((s) => s.session_id === saved);

  if (sessionExists) {
    await selectSession(saved);
  } else if (store.sessions.length > 0) {
    await selectSession(store.sessions[0].session_id);
  } else {
    startNewChat();
  }

  render();
}

init();
