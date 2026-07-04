import { detectWikilinkSuggest } from "./wikilinkSuggest";

export const WIKILINK_COMPLETE_RE = /\[\[([^\]|#]+?)(?:\|([^\]]+?))?\]\]/g;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Formato inline que se renderiza en bloques no enfocados: código, negrita
// (`**`/`__`), cursiva (`*`/`_`) y tachado (`~~`) — el mismo subconjunto que
// muestra la Vista (remark + GFM). Cada chip guarda su markdown original en
// `data-md` para serializar sin pérdidas. Los delimitadores con `_` exigen
// límite de palabra (como CommonMark) para no romper snake_case, globs ni
// comandos; `*`/`~~` exigen contenido sin espacio pegado al delimitador.
const INLINE_FMT_RE =
  /(`[^`\n]+?`)|(\*\*(?!\s)[^\n]+?(?<!\s)\*\*)|(?<![A-Za-z0-9_])(__(?!\s)[^\n]+?(?<!\s)__)(?![A-Za-z0-9_])|(\*(?![\s*])[^*\n]*?(?<![\s*])\*)|(?<![A-Za-z0-9_])(_(?![\s_])[^_\n]*?(?<![\s_])_)(?![A-Za-z0-9_])|(~~(?!\s)[^~\n]+?(?<!\s)~~)/g;

function fmtChip(tag: string, cls: string, md: string, innerHtml: string): string {
  return `<${tag} class="${cls}" contenteditable="false" data-md="${escapeHtml(md)}">${innerHtml}</${tag}>`;
}

/** Escapa y decora el formato inline de un fragmento de texto. Recursivo para
 *  anidados tipo `_cursiva con **negrita**_` (el `data-md` externo conserva el
 *  markdown completo, así que la serialización no depende de los chips internos). */
function decorateInlineFormatting(seg: string): string {
  let out = "";
  let last = 0;
  const re = new RegExp(INLINE_FMT_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg)) !== null) {
    out += escapeHtml(seg.slice(last, m.index));
    const [, code, bold, boldU, em, emU, del] = m;
    if (code !== undefined) {
      out += fmtChip("code", "be-inline-code", code, escapeHtml(code.slice(1, -1)));
    } else if (bold !== undefined || boldU !== undefined) {
      const md = (bold ?? boldU) as string;
      out += fmtChip("strong", "be-inline-bold", md, decorateInlineFormatting(md.slice(2, -2)));
    } else if (em !== undefined || emU !== undefined) {
      const md = (em ?? emU) as string;
      out += fmtChip("em", "be-inline-em", md, decorateInlineFormatting(md.slice(1, -1)));
    } else {
      const md = del as string;
      out += fmtChip("del", "be-inline-del", md, decorateInlineFormatting(md.slice(2, -2)));
    }
    last = m.index + m[0].length;
  }
  out += escapeHtml(seg.slice(last));
  return out;
}

/** Convierte `[[nota]]` y formato inline en chips para contentEditable. */
export function decorateWikilinksInPlainText(
  text: string,
  resolveRel?: (title: string) => string | null,
): string {
  let result = "";
  let last = 0;
  const re = new RegExp(WIKILINK_COMPLETE_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    result += decorateInlineFormatting(text.slice(last, match.index));
    const title = match[1].trim();
    const label = (match[2]?.trim() || title).trim();
    const resolved = resolveRel?.(title) ?? null;
    const relAttr = resolved ? ` data-note-rel="${escapeHtml(resolved)}"` : "";
    result += `<span class="block-wikilink" contenteditable="false" data-wiki="${escapeHtml(title)}"${relAttr}><span class="block-wikilink-ico" aria-hidden="true">↗</span><span class="block-wikilink-label">${escapeHtml(label)}</span></span>`;
    last = match.index + match[0].length;
  }
  result += decorateInlineFormatting(text.slice(last));
  return result.replace(/\n/g, "<br>");
}

/** `div`/`p` hijos directos que el navegador crea al pulsar Shift+Enter. */
function isEditableLineElement(node: Node): node is HTMLElement {
  return (
    node instanceof HTMLElement &&
    (node.tagName === "DIV" || node.tagName === "P") &&
    !node.classList.contains("block-wikilink") &&
    node.dataset.md === undefined
  );
}

function serializeInlineNodes(nodes: Iterable<Node>): string {
  let out = "";
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      continue;
    }
    if (node.nodeName === "BR") {
      out += "\n";
      continue;
    }
    if (node instanceof HTMLElement) {
      if (node.classList.contains("block-wikilink")) {
        const wiki =
          node.dataset.wiki ??
          node.querySelector(".block-wikilink-label")?.textContent ??
          "";
        out += `[[${wiki}]]`;
        continue;
      }
      if (node.dataset.md !== undefined) {
        out += node.dataset.md;
        continue;
      }
      out += serializeInlineNodes(node.childNodes);
    }
  }
  return out;
}

/** Contenido de una línea `<div>` (sin el salto entre líneas del contenedor). */
function serializeLineInner(el: HTMLElement): string {
  const kids = [...el.childNodes];
  if (kids.length === 0) return "";
  // Línea vacía típica de Chrome: <div><br></div>
  if (kids.length === 1 && kids[0].nodeName === "BR") return "";
  return serializeInlineNodes(kids);
}

/** Un único nodo de texto: el DOM más simple y fiable para editar. */
export function isPlainTextDom(el: HTMLElement): boolean {
  return (
    el.childNodes.length === 1 &&
    el.firstChild?.nodeType === Node.TEXT_NODE
  );
}

/** Solo nodos de texto (sin br/div/chips), posiblemente varios hermanos. */
export function isTextNodesOnly(el: HTMLElement): boolean {
  if (el.childNodes.length === 0) return false;
  return [...el.childNodes].every((n) => n.nodeType === Node.TEXT_NODE);
}

/** ¿Hay que reescribir el DOM antes de leer/escribir? */
export function editableDomNeedsFlatten(el: HTMLElement): boolean {
  if (isPlainTextDom(el)) return false;
  if (isTextNodesOnly(el)) return true;
  if (el.querySelector(".block-wikilink, .be-inline-code, .be-inline-bold, .be-inline-em, .be-inline-del, br")) {
    return true;
  }
  return [...el.childNodes].some(isEditableLineElement);
}

/**
 * Chromium inserta un `<br>` final en contentEditable que no es texto real pero
 * desplaza el cursor visualmente hacia la derecha/abajo. Lo eliminamos cuando
 * hay contenido; en bloques vacíos se conserva para mantener altura y foco.
 */
export function stripPhantomTrailingBr(el: HTMLElement): void {
  if ((el.textContent ?? "").length === 0) return;
  const last = el.lastChild;
  if (!last || last.nodeName !== "BR") return;

  const sel = window.getSelection();
  let caretWasAfterText = false;
  if (sel?.rangeCount && el.contains(sel.getRangeAt(0).startContainer)) {
    const range = sel.getRangeAt(0);
    caretWasAfterText =
      range.startContainer === last ||
      (range.startContainer === el &&
        range.startOffset === el.childNodes.length);
  }

  last.remove();

  if (!caretWasAfterText || !sel?.rangeCount) return;
  const textNode = [...el.childNodes]
    .reverse()
    .find((n) => n.nodeType === Node.TEXT_NODE);
  if (!textNode) return;
  const r = document.createRange();
  r.setStart(textNode, textNode.textContent?.length ?? 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Aplana el DOM a un único nodo de texto con `\n`. Devuelve el markdown del bloque. */
export function flattenEditableDom(el: HTMLElement): string {
  const text = serializeEditableWithWikilinks(el);
  if (editableDomNeedsFlatten(el) || el.textContent !== text) {
    el.textContent = text;
  }
  return text;
}

/** Lee el texto plano de un bloque, incluyendo chips wikilink. */
export function serializeEditableWithWikilinks(el: HTMLElement): string {
  const kids = [...el.childNodes];
  if (kids.length === 0) return "";

  const hasLineDivs = kids.some(isEditableLineElement);
  if (!hasLineDivs) {
    return serializeInlineNodes(kids);
  }

  let out = "";
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i];
    if (isEditableLineElement(node)) {
      if (i > 0) out += "\n";
      out += serializeLineInner(node);
    } else {
      out += serializeInlineNodes([node]);
    }
  }
  return out;
}

export function shouldDecorateWikilinks(text: string, cursor: number): boolean {
  return detectWikilinkSuggest(text, cursor) === null;
}

export function findWikilinkTargetAt(doc: string, pos: number): string | null {
  const re = new RegExp(WIKILINK_COMPLETE_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(doc)) !== null) {
    if (pos >= match.index && pos <= match.index + match[0].length) {
      return match[1].trim();
    }
  }
  return null;
}

export function findMarkdownLinkTargetAt(doc: string, pos: number): string | null {
  const re = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(doc)) !== null) {
    if (pos >= match.index && pos <= match.index + match[0].length) {
      return match[2].trim();
    }
  }
  return null;
}
