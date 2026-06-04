import { api, ApiError, CHAT_TIMEOUT_MS } from "./api.js";
import { MODEL_STORAGE_KEY, STORAGE_KEY } from "./config.js";
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
  setSidebarOpen,
  showToast,
  updateComposer,
  updateLoadingStatus,
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
  setSidebarOpen(false);
  els.promptInput()?.focus();
}

async function selectSession(sessionId) {
  if (sessionId === store.activeSessionId && store.messages.length > 0) {
    setSidebarOpen(false);
    return;
  }

  patchState({ activeSessionId: sessionId, messages: [], isLoading: false });
  persistActiveSession();
  await loadSessionMemory(sessionId);
  setSidebarOpen(false);
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
let loadingTimer = null;

function clearLoadingTimer() {
  if (loadingTimer) {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }
}

function startLoadingTimer() {
  clearLoadingTimer();
  loadingTimer = setInterval(() => updateLoadingStatus(), 1000);
}

function cancelChatRequest() {
  chatAbortController?.abort();
  clearLoadingTimer();
  patchState({ isLoading: false, loadingStartedAt: null });
  showToast("Request cancelled");
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
  chatAbortController = new AbortController();
  const timeoutId = setTimeout(() => chatAbortController?.abort(), CHAT_TIMEOUT_MS);

  patchState({
    messages: [...store.messages, userMessage],
    isLoading: true,
    loadingStartedAt: Date.now(),
  });
  startLoadingTimer();
  scrollToBottom();

  try {
    const response = await api.chat(
      sessionId,
      trimmed,
      store.selectedModel,
      chatAbortController.signal
    );
    const sourceLabel =
      response.source === "redis"
        ? `Cached · ${response.model ?? store.selectedModel}`
        : `via ${response.model ?? store.selectedModel}`;

    const assistantMessage = {
      role: "assistant",
      message: response.answer,
      meta: sourceLabel,
    };

    const updatedMessages = [...store.messages, assistantMessage];
    patchState({
      messages: updatedMessages,
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
    if (err.name === "AbortError") {
      showToast("Request cancelled or timed out. Try again.", true);
    } else {
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
    clearLoadingTimer();
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

  $("sidebar-toggle")?.addEventListener("click", () =>
    setSidebarOpen(true)
  );
  $("sidebar-close")?.addEventListener("click", () => setSidebarOpen(false));
  $("sidebar-overlay")?.addEventListener("click", () =>
    setSidebarOpen(false)
  );

  $("session-list")?.addEventListener("click", (e) => {
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
