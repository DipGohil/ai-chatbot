import { API_BASE } from "./config.js";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? body.message ?? detail;
    } catch {
      /* ignore parse errors */
    }
    throw new ApiError(detail, response.status);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  health: () => request("/"),
  models: () => request("/models"),
  sessions: () => request("/sessions"),
  memory: (sessionId) => request(`/memory/${encodeURIComponent(sessionId)}`),
  history: () => request("/history"),
  chat: (sessionId, prompt) =>
    request("/chat", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, prompt }),
    }),
  deleteSession: (sessionId) =>
    request(`/session/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }),
};

export { ApiError };
