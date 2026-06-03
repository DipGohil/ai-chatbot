import { API_BASE } from "./config.js";

/** Must stay below nginx proxy_read_timeout (1200s). */
export const CHAT_TIMEOUT_MS = 1_200_000;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw err;
    }
    throw new ApiError(
      "Network error — the request timed out or the connection was lost.",
      0
    );
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? body.message ?? detail;
    } catch {
      if (response.status === 504) {
        detail = "Gateway timeout — Ollama is taking too long. Try again.";
      }
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
  chat: (sessionId, prompt, signal) =>
    request("/chat", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, prompt }),
      signal,
    }),
  deleteSession: (sessionId) =>
    request(`/session/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }),
};

export { ApiError };
