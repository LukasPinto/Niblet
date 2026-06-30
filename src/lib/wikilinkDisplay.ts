import { detectWikilinkSuggest } from "./wikilinkSuggest";

export const WIKILINK_COMPLETE_RE = /\[\[([^\]|#]+?)(?:\|([^\]]+?))?\]\]/g;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convierte `[[nota]]` completos en chips inline para contentEditable. */
export function decorateWikilinksInPlainText(
  text: string,
  resolveRel?: (title: string) => string | null,
): string {
  let result = "";
  let last = 0;
  const re = new RegExp(WIKILINK_COMPLETE_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    result += escapeHtml(text.slice(last, match.index));
    const title = match[1].trim();
    const label = (match[2]?.trim() || title).trim();
    const resolved = resolveRel?.(title) ?? null;
    const relAttr = resolved ? ` data-note-rel="${escapeHtml(resolved)}"` : "";
    result += `<span class="block-wikilink" contenteditable="false" data-wiki="${escapeHtml(title)}"${relAttr}><span class="block-wikilink-ico" aria-hidden="true">↗</span><span class="block-wikilink-label">${escapeHtml(label)}</span></span>`;
    last = match.index + match[0].length;
  }
  result += escapeHtml(text.slice(last));
  return result.replace(/\n/g, "<br>");
}

/** Lee el texto plano de un bloque, incluyendo chips wikilink. */
export function serializeEditableWithWikilinks(el: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (node.nodeName === "BR") {
      out += "\n";
      return;
    }
    if (node instanceof HTMLElement) {
      if (node.classList.contains("block-wikilink")) {
        const wiki =
          node.dataset.wiki ??
          node.querySelector(".block-wikilink-label")?.textContent ??
          "";
        out += `[[${wiki}]]`;
        return;
      }
      node.childNodes.forEach(walk);
    }
  };
  el.childNodes.forEach(walk);
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
