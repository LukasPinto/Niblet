import { buildNoteIndex, resolveNoteTarget } from "./linkParser";
import type { NoteEntry } from "./tauri";

export const NOTE_LINK_SELECTOR =
  "a.wikilink-pill, a.wikilink[href^='note:'], .block-wikilink, .backlink[data-rel]";

export function relPathFromLinkEl(
  el: HTMLElement,
  notes: NoteEntry[],
  sourceRelPath = "",
): string | null {
  const link = el.closest<HTMLElement>(NOTE_LINK_SELECTOR) ?? el;

  const dataRel = link.dataset.noteRel ?? link.dataset.rel;
  if (dataRel) {
    try {
      return decodeURIComponent(dataRel);
    } catch {
      return dataRel;
    }
  }

  if (link instanceof HTMLAnchorElement) {
    const href = link.getAttribute("href");
    if (href?.startsWith("note:")) {
      const decoded = decodeURIComponent(href.slice(5));
      const index = buildNoteIndex(notes);
      return resolveNoteTarget(decoded, sourceRelPath, index) ?? decoded;
    }
  }

  const wiki = link.dataset.wiki;
  if (wiki) {
    return resolveNoteTarget(wiki, sourceRelPath, buildNoteIndex(notes));
  }

  return null;
}

export function isNoteLinkEl(el: HTMLElement): boolean {
  return !!el.closest(NOTE_LINK_SELECTOR);
}
