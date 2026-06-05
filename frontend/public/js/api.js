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

async function streamRequest(path, options = {}, handlers = {}) {
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
    if (err.name === "AbortError") throw err;
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
      // Streaming failures often return plain text from a proxy.
    }
    throw new ApiError(detail, response.status);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ApiError("This browser does not support streaming responses.", 0);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.event === "error") {
        throw new ApiError(event.detail ?? "Streaming response failed", event.status ?? 0);
      }
      handlers[event.event]?.(event);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    if (event.event === "error") {
      throw new ApiError(event.detail ?? "Streaming response failed", event.status ?? 0);
    }
    handlers[event.event]?.(event);
  }
}

export const api = {
  health: () => request("/"),
  models: () => request("/models"),
  activateModel: (model, signal) =>
    request("/models/activate", {
      method: "POST",
      body: JSON.stringify({ model }),
      signal,
    }),
  sessions: () => request("/sessions"),
  memory: (sessionId) => request(`/memory/${encodeURIComponent(sessionId)}`),
  history: () => request("/history"),
  chat: (sessionId, prompt, model, signal) =>
    request("/chat", {
      method: "POST",
      body: JSON.stringify({
        session_id: sessionId,
        prompt,
        model,
      }),
      signal,
    }),
  chatStream: (sessionId, prompt, model, signal, handlers) =>
    streamRequest(
      "/chat/stream",
      {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          prompt,
          model,
        }),
        signal,
      },
      handlers
    ),
  deleteSession: (sessionId) =>
    request(`/session/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    }),
};

export { ApiError };
