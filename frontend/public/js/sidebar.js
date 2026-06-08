import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_KEY,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "./config.js";

const SIDEBAR_DESKTOP_QUERY = "(min-width: 769px)";

function isDesktopViewport() {
  return window.matchMedia(SIDEBAR_DESKTOP_QUERY).matches;
}

export const SIDEBAR_TOGGLE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M9 3v18"/></svg>`;

function clampWidth(width) {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width));
}

export function applySidebarWidth(width) {
  const clamped = clampWidth(width);
  document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
  return clamped;
}

export function initSidebarWidth() {
  const saved = Number.parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
  applySidebarWidth(Number.isFinite(saved) ? saved : SIDEBAR_WIDTH_DEFAULT);
}

export function bindSidebarResize() {
  const handle = document.getElementById("sidebar-resize");
  if (!handle) return;

  let dragging = false;
  let startX = 0;
  let startWidth = SIDEBAR_WIDTH_DEFAULT;

  const onMove = (event) => {
    if (!dragging) return;
    const pointerX = event.touches?.[0]?.clientX ?? event.clientX;
    applySidebarWidth(startWidth + (pointerX - startX));
  };

  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("sidebar-resizing");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", stopDrag);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", stopDrag);
  };

  const startDrag = (event) => {
    if (!isDesktopViewport()) return;
    if (!document.getElementById("app")?.classList.contains("app--sidebar-open")) {
      return;
    }

    dragging = true;
    startX = event.touches?.[0]?.clientX ?? event.clientX;
    startWidth = clampWidth(
      Number.parseInt(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--sidebar-width")
          .trim(),
        10
      ) || SIDEBAR_WIDTH_DEFAULT
    );
    document.body.classList.add("sidebar-resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stopDrag);
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", stopDrag);
    event.preventDefault();
  };

  handle.addEventListener("mousedown", startDrag);
  handle.addEventListener("touchstart", startDrag, { passive: false });
}
