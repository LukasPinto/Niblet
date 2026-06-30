import { create } from "zustand";
import { NOTE_LINK_SELECTOR } from "../lib/noteLinkDom";
import { isPointerInHoverZone } from "../lib/hoverPreviewGeometry";

let showTimer: number | undefined;
let hideTimer: number | undefined;
let pointer = { x: 0, y: 0 };
let pointerListenerAttached = false;

function ensurePointerListener() {
  if (pointerListenerAttached) return;
  pointerListenerAttached = true;
  document.addEventListener(
    "pointermove",
    (e) => {
      pointer = { x: e.clientX, y: e.clientY };
    },
    { passive: true },
  );
}

interface HoverPreviewState {
  relPath: string | null;
  anchorEl: HTMLElement | null;
  overCard: boolean;
  requestShow: (
    relPath: string,
    anchorEl: HTMLElement,
    pt: { x: number; y: number },
  ) => void;
  requestHide: () => void;
  setOverCard: (over: boolean) => void;
  dismiss: () => void;
  refreshAnchor: (pt: { x: number; y: number }) => void;
  registerCardEl: (el: HTMLElement | null) => void;
}

let cardEl: HTMLElement | null = null;

function resolveAnchorAtPointer(
  fallback: HTMLElement,
  pt: { x: number; y: number },
): HTMLElement | null {
  const under = document.elementFromPoint(pt.x, pt.y);
  if (under instanceof Element && under.closest(".note-hover-preview")) {
    return fallback.isConnected ? fallback : null;
  }
  const link =
    under instanceof Element
      ? under.closest<HTMLElement>(NOTE_LINK_SELECTOR)
      : null;
  return link ?? (fallback.isConnected ? fallback : null);
}

function scheduleHideCheck(get: () => HoverPreviewState, set: (p: Partial<HoverPreviewState>) => void) {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    const state = get();
    if (state.overCard) return;
    const card = cardEl ?? document.querySelector<HTMLElement>(".note-hover-preview");
    if (isPointerInHoverZone(pointer.x, pointer.y, state.anchorEl, card)) {
      scheduleHideCheck(get, set);
      return;
    }
    set({ relPath: null, anchorEl: null, overCard: false });
  }, 220);
}

export const useHoverPreviewStore = create<HoverPreviewState>((set, get) => {
  ensurePointerListener();

  return {
    relPath: null,
    anchorEl: null,
    overCard: false,

    registerCardEl: (el) => {
      cardEl = el;
    },

    requestShow: (relPath, anchorEl, pt) => {
      pointer = pt;
      window.clearTimeout(hideTimer);
      window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => {
        if (!isPointerInHoverZone(pt.x, pt.y, anchorEl, null)) {
          const anchor = resolveAnchorAtPointer(anchorEl, pointer);
          if (!anchor || !isPointerInHoverZone(pointer.x, pointer.y, anchor, null)) {
            return;
          }
          set({ relPath, anchorEl: anchor, overCard: false });
          return;
        }
        const anchor = resolveAnchorAtPointer(anchorEl, pointer);
        if (!anchor) return;
        set({ relPath, anchorEl: anchor, overCard: false });
      }, 360);
    },

    refreshAnchor: (pt) => {
      pointer = pt;
      const { relPath, anchorEl } = get();
      if (!relPath || !anchorEl) return;
      const anchor = resolveAnchorAtPointer(anchorEl, pt);
      if (anchor && anchor !== anchorEl) set({ anchorEl: anchor });
    },

    requestHide: () => {
      window.clearTimeout(showTimer);
      scheduleHideCheck(get, set);
    },

    setOverCard: (over) => {
      if (over) window.clearTimeout(hideTimer);
      set({ overCard: over });
      if (!over) scheduleHideCheck(get, set);
    },

    dismiss: () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      set({ relPath: null, anchorEl: null, overCard: false });
    },
  };
});
