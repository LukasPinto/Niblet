import {
  isPlainTextDom,
  isTextNodesOnly,
  serializeEditableWithWikilinks,
} from "./wikilinkDisplay";

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

  const rects = range.getClientRects();
  for (let i = rects.length - 1; i >= 0; i--) {
    const rect = rects[i];
    if (rect.width > 0 || rect.height > 0) {
      return { left: rect.left, top: rect.top, bottom: rect.bottom };
    }
  }

  const { startContainer, startOffset } = range;

  if (startContainer.nodeName === "BR") {
    const r = (startContainer as HTMLElement).getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom };
  }

  if (startContainer.nodeType === Node.ELEMENT_NODE) {
    const before =
      startOffset > 0 ? startContainer.childNodes[startOffset - 1] : null;
    if (before?.nodeName === "BR") {
      const r = (before as HTMLElement).getBoundingClientRect();
      return { left: r.right, top: r.top, bottom: r.bottom };
    }
    const at = startContainer.childNodes[startOffset];
    if (at?.nodeName === "BR") {
      const r = (at as HTMLElement).getBoundingClientRect();
      return { left: r.left, top: r.top, bottom: r.bottom };
    }
  }

  if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
    const prev = startContainer.previousSibling;
    if (prev?.nodeName === "BR") {
      const r = (prev as HTMLElement).getBoundingClientRect();
      return { left: r.left, top: r.top, bottom: r.bottom };
    }
  }

  const r = range.getBoundingClientRect();
  if (r.width > 0 || r.height > 0) {
    return { left: r.left, top: r.top, bottom: r.bottom };
  }

  return fallback();
}

/**
 * Offset del cursor dentro de un contentEditable, en las mismas unidades que
 * `serializeEditableWithWikilinks` (los `<br>` cuentan como `\n`, los chips de
 * wikilink/formato como su markdown). `Range.toString()` ignora `<br>` y rompe
 * el alineamiento en bloques multilínea decorados.
 */
export function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return (el.textContent ?? serializeEditableWithWikilinks(el)).length;
  }
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) {
    return (el.textContent ?? serializeEditableWithWikilinks(el)).length;
  }
  // Camino rápido: solo nodos de texto → sumar longitudes (sin clonar DOM).
  if (isPlainTextDom(el) || isTextNodesOnly(el)) {
    if (range.startContainer === el) {
      let offset = 0;
      for (let i = 0; i < range.startOffset; i++) {
        const node = el.childNodes[i];
        if (node.nodeType === Node.TEXT_NODE) {
          offset += node.textContent?.length ?? 0;
        }
      }
      return offset;
    }
    let offset = 0;
    for (const node of el.childNodes) {
      if (node === range.startContainer && node.nodeType === Node.TEXT_NODE) {
        return offset + range.startOffset;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        offset += node.textContent?.length ?? 0;
      }
    }
    return offset;
  }
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const probe = document.createElement("div");
  probe.appendChild(pre.cloneContents());
  return serializeEditableWithWikilinks(probe).length;
}

/** Coloca el cursor en un offset (mismas unidades que `serializeEditableWithWikilinks`). */
export function placeCaretAtOffset(el: HTMLElement, offset: number) {
  el.focus();
  const range = document.createRange();
  const clamped = Math.max(0, offset);

  if (isPlainTextDom(el)) {
    const text = el.firstChild as Text;
    range.setStart(text, Math.min(clamped, text.length));
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return;
  }

  let remaining = clamped;
  let placed = false;

  const placeInText = (node: Text, pos: number) => {
    range.setStart(node, pos);
    range.collapse(true);
    placed = true;
  };

  const placeBefore = (node: Node) => {
    range.setStartBefore(node);
    range.collapse(true);
    placed = true;
  };

  const placeAfter = (node: Node) => {
    range.setStartAfter(node);
    range.collapse(true);
    placed = true;
  };

  const walkInline = (nodes: Iterable<Node>): boolean => {
    for (const node of nodes) {
      if (placed) return true;
      if (node.nodeType === Node.TEXT_NODE) {
        const len = node.textContent?.length ?? 0;
        if (remaining <= len) {
          placeInText(node as Text, remaining);
          return true;
        }
        remaining -= len;
        continue;
      }
      if (node.nodeName === "BR") {
        if (remaining <= 0) {
          placeBefore(node);
          return true;
        }
        remaining -= 1;
        continue;
      }
      if (node instanceof HTMLElement) {
        if (node.classList.contains("block-wikilink")) {
          const md = `[[${node.dataset.wiki ?? node.querySelector(".block-wikilink-label")?.textContent ?? ""}]]`;
          if (remaining <= md.length) {
            placeAfter(node);
            return true;
          }
          remaining -= md.length;
          continue;
        }
        if (node.dataset.md !== undefined) {
          const md = node.dataset.md;
          if (remaining <= md.length) {
            placeAfter(node);
            return true;
          }
          remaining -= md.length;
          continue;
        }
        if (walkInline(node.childNodes)) return true;
      }
    }
    return false;
  };

  const kids = [...el.childNodes];
  const hasLineDivs = kids.some(
    (n) =>
      n instanceof HTMLElement &&
      (n.tagName === "DIV" || n.tagName === "P") &&
      !n.classList.contains("block-wikilink"),
  );

  if (!hasLineDivs) {
    walkInline(kids);
  } else {
    for (let i = 0; i < kids.length; i++) {
      if (placed) break;
      const node = kids[i];
      if (
        node instanceof HTMLElement &&
        (node.tagName === "DIV" || node.tagName === "P") &&
        !node.classList.contains("block-wikilink")
      ) {
        if (i > 0) {
          if (remaining <= 0) {
            placeBefore(node);
            break;
          }
          remaining -= 1;
        }
        const innerKids = [...node.childNodes];
        const emptyLine =
          innerKids.length === 0 ||
          (innerKids.length === 1 && innerKids[0].nodeName === "BR");
        if (emptyLine) {
          if (remaining <= 0) {
            placeBefore(node);
            break;
          }
          continue;
        }
        if (walkInline(innerKids)) break;
      } else if (walkInline([node])) {
        break;
      }
    }
  }

  if (!placed) {
    range.selectNodeContents(el);
    range.collapse(false);
  }

  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
