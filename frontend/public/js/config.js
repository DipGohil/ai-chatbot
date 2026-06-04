/** API base: nginx proxies /api → backend in Docker; override for local dev. */
export const API_BASE = window.__API_BASE__ ?? "/api";

export const STORAGE_KEY = "nexus_active_session";
export const MODEL_STORAGE_KEY = "nexus_selected_model";
