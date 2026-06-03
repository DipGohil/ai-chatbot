/**
 * Lightweight reactive store (pub/sub) for UI state.
 */
const listeners = new Set();

export const store = {
  sessions: [],
  messages: [],
  activeSessionId: null,
  isLoading: false,
  loadingStartedAt: null,
  isSidebarOpen: false,
  modelName: "phi3:mini",
  apiOnline: null,
};

export function getState() {
  return { ...store };
}

export function patchState(updates) {
  Object.assign(store, updates);
  listeners.forEach((fn) => fn(getState()));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createSessionId() {
  return crypto.randomUUID();
}

export function getActiveSession() {
  return store.sessions.find((s) => s.session_id === store.activeSessionId);
}
