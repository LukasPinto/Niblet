export type MetaSuggestKind = "due-date" | "prior";

export interface MetaSuggestTrigger {
  kind: MetaSuggestKind;
  /** Índice donde empieza el valor (justo después de `due-date:` / `prior:`). */
  valueStart: number;
  /** Posición del cursor (fin del texto a reemplazar). */
  replaceEnd: number;
  partial: string;
}

const PRIOR_PRESETS = new Set(["high", "medium", "low"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkToken(
  token: string,
  kind: MetaSuggestKind,
  text: string,
  cursor: number,
): MetaSuggestTrigger | null {
  const idx = text.lastIndexOf(token, Math.max(0, cursor - 1));
  if (idx < 0) return null;

  const prefixBeforeCursor = text.slice(idx + token.length, cursor);
  if (prefixBeforeCursor.includes(" ")) return null;

  const ws = prefixBeforeCursor.match(/^\s*/)?.[0].length ?? 0;
  const valueStart = idx + token.length + ws;
  const partial = text.slice(valueStart, cursor);

  if (kind === "due-date" && ISO_DATE.test(partial)) return null;
  if (kind === "prior" && PRIOR_PRESETS.has(partial)) return null;

  return { kind, valueStart, replaceEnd: cursor, partial };
}

/** Detecta si el cursor está justo tras `due-date:` o `prior:` (valor incompleto). */
export function detectMetaSuggest(
  text: string,
  cursor: number,
): MetaSuggestTrigger | null {
  return (
    checkToken("due-date:", "due-date", text, cursor) ??
    checkToken("prior:", "prior", text, cursor)
  );
}

/** Rect del cursor en pantalla (viewport). Evita (0,0) con caret colapsado. */
export function getCaretClientRect(el: HTMLElement): {
  left: number;
  top: number;
  bottom: number;
} {
  const fallback = () => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom };
  };

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return fallback();

  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return fallback();

  const probe = range.cloneRange();
  probe.collapse(true);

  let rect = probe.getClientRects()[0];
  if (!rect) rect = probe.getBoundingClientRect();

  const empty =
    !rect || (rect.width === 0 && rect.height === 0);

  if (empty) {
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    try {
      probe.insertNode(marker);
      rect = marker.getBoundingClientRect();
      marker.remove();
      el.normalize();
    } catch {
      return fallback();
    }
  }

  if (!rect || (rect.width === 0 && rect.height === 0)) return fallback();

  return { left: rect.left, top: rect.top, bottom: rect.bottom };
}

/** Offset del cursor dentro de un contentEditable. */
export function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return el.textContent?.length ?? 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

/** Coloca el cursor en un offset dentro de un contentEditable. */
export function placeCaretAtOffset(el: HTMLElement, offset: number) {
  el.focus();
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let count = 0;
  let placed = false;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.length;
    if (count + len >= offset) {
      range.setStart(node, offset - count);
      range.collapse(true);
      placed = true;
      break;
    }
    count += len;
  }

  if (!placed) {
    range.selectNodeContents(el);
    range.collapse(false);
  }

  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
