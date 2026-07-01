import { serializeEditableWithWikilinks } from "./wikilinkDisplay";
import {
  getCaretClientRect,
  getCaretOffset,
  placeCaretAtOffset,
} from "./taskMetaSuggest";
import { getCmView } from "./codeMirrorBlock";

/** Campo editable de un bloque: textarea (texto), div CodeMirror (código) o div legacy. */
export type BlockInputEl = HTMLTextAreaElement | HTMLDivElement;

export function readBlockText(el: BlockInputEl): string {
  const cm = getCmView(el);
  if (cm) return cm.state.doc.toString();
  if (el instanceof HTMLTextAreaElement) return el.value;
  return el.textContent ?? serializeEditableWithWikilinks(el);
}

export function getBlockCaret(el: BlockInputEl): number {
  const cm = getCmView(el);
  if (cm) return cm.state.selection.main.head;
  if (el instanceof HTMLTextAreaElement) {
    return el.selectionStart ?? el.value.length;
  }
  return getCaretOffset(el);
}

export function setBlockText(el: BlockInputEl, text: string): void {
  const cm = getCmView(el);
  if (cm) {
    const cur = cm.state.doc.toString();
    if (cur !== text) {
      cm.dispatch({
        changes: { from: 0, to: cur.length, insert: text },
      });
    }
    return;
  }
  if (el instanceof HTMLTextAreaElement) {
    el.value = text;
    autoResizeTextarea(el);
  } else {
    el.textContent = text;
  }
}

export function setBlockCaret(el: BlockInputEl, offset: number): void {
  const cm = getCmView(el);
  if (cm) {
    cm.focus();
    const pos = Math.min(Math.max(0, offset), cm.state.doc.length);
    cm.dispatch({ selection: { anchor: pos } });
    return;
  }
  if (el instanceof HTMLTextAreaElement) {
    el.focus();
    const pos = Math.min(Math.max(0, offset), el.value.length);
    el.setSelectionRange(pos, pos);
  } else {
    placeCaretAtOffset(el, offset);
  }
}

export function placeBlockCaret(
  el: BlockInputEl,
  pos: "start" | "end",
): void {
  const cm = getCmView(el);
  if (cm) {
    cm.focus();
    const p = pos === "start" ? 0 : cm.state.doc.length;
    cm.dispatch({ selection: { anchor: p } });
    return;
  }
  if (el instanceof HTMLTextAreaElement) {
    el.focus();
    const p = pos === "start" ? 0 : el.value.length;
    el.setSelectionRange(p, p);
  } else {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(pos === "start");
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

/** Ajusta la altura del textarea al contenido (multilínea). */
export function autoResizeTextarea(ta: HTMLTextAreaElement): void {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
}

export function syncBlockTextFromRef(
  el: BlockInputEl | undefined,
  fallback: string,
): string {
  if (!el) return fallback;
  const cm = getCmView(el);
  if (cm) return cm.state.doc.toString();
  if (el instanceof HTMLTextAreaElement) return el.value;
  return serializeEditableWithWikilinks(el);
}

const MIRROR_PROPS = [
  "direction",
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "textIndent",
  "textDecoration",
  "wordSpacing",
  "tabSize",
  "whiteSpace",
  "wordBreak",
  "wordWrap",
] as const;

/** Rect del cursor en un textarea (para popovers de /, wikilink, meta). */
function getTextareaCaretClientRect(ta: HTMLTextAreaElement): {
  left: number;
  top: number;
  bottom: number;
} {
  const pos = ta.selectionStart ?? ta.value.length;
  const style = window.getComputedStyle(ta);
  const taRect = ta.getBoundingClientRect();
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  for (const prop of MIRROR_PROPS) {
    mirror.style[prop] = style[prop];
  }
  mirror.style.position = "fixed";
  mirror.style.top = `${taRect.top}px`;
  mirror.style.left = `${taRect.left}px`;
  mirror.style.width = `${taRect.width}px`;
  mirror.style.visibility = "hidden";
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.textContent = ta.value.substring(0, pos);
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const rect = marker.getBoundingClientRect();
  document.body.removeChild(mirror);
  return { left: rect.left, top: rect.top, bottom: rect.bottom };
}

export function getBlockCaretClientRect(el: BlockInputEl): {
  left: number;
  top: number;
  bottom: number;
} {
  const cm = getCmView(el);
  if (cm) {
    const coords = cm.coordsAtPos(cm.state.selection.main.head);
    if (coords) {
      return { left: coords.left, top: coords.top, bottom: coords.bottom };
    }
    const r = cm.dom.getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom };
  }
  if (el instanceof HTMLTextAreaElement) return getTextareaCaretClientRect(el);
  return getCaretClientRect(el);
}
