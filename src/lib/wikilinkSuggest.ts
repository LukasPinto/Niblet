import type { NoteEntry } from "./tauri";
import { sourceLabel } from "./taskParser";

export interface WikilinkSuggestTrigger {
  /** Índice donde empieza `[[`. */
  openIndex: number;
  /** Primer carácter tras `[[`. */
  valueStart: number;
  /** Posición del cursor (fin del texto a reemplazar). */
  replaceEnd: number;
  partial: string;
}

export const SLASH_WIKILINK_COMMAND = {
  label: "Enlace a nota",
  icon: "🔗",
  hint: "Wikilink [[nota]]",
  keywords: ["enlace", "link", "nota", "wikilink", "backlink", "pagina"],
};

const MAX_RESULTS = 15;

/** Detecta `[[` abierto sin cerrar antes del cursor. */
export function detectWikilinkSuggest(
  text: string,
  cursor: number,
): WikilinkSuggestTrigger | null {
  const before = text.slice(0, cursor);
  const openIdx = before.lastIndexOf("[[");
  if (openIdx < 0) return null;

  const inner = before.slice(openIdx + 2);
  if (inner.includes("]]")) return null;
  if (inner.includes("\n")) return null;

  return {
    openIndex: openIdx,
    valueStart: openIdx + 2,
    replaceEnd: cursor,
    partial: inner,
  };
}

export function slashWikilinkMatches(query: string): boolean {
  const q = query.toLowerCase();
  if (!q) return true;
  const { label, hint, keywords } = SLASH_WIKILINK_COMMAND;
  if (label.toLowerCase().includes(q) || hint.toLowerCase().includes(q)) return true;
  return keywords.some((k) => k.includes(q) || q.includes(k));
}

export function filterNotesForWikilink(
  notes: NoteEntry[],
  query: string,
  excludeRelPath?: string,
): NoteEntry[] {
  const q = query.trim().toLowerCase();
  return notes
    .filter((n) => n.rel_path !== excludeRelPath)
    .filter((n) => {
      if (!q) return true;
      const name = n.name.toLowerCase();
      const path = n.rel_path.replace(/\.md$/i, "").toLowerCase();
      const folder = n.folder.toLowerCase();
      return (
        name.includes(q) ||
        path.includes(q) ||
        folder.includes(q) ||
        sourceLabel(n.rel_path).toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .slice(0, MAX_RESULTS);
}

export function countWikilinkMatches(
  notes: NoteEntry[],
  query: string,
  excludeRelPath?: string,
): number {
  const q = query.trim().toLowerCase();
  return notes
    .filter((n) => n.rel_path !== excludeRelPath)
    .filter((n) => {
      if (!q) return true;
      const name = n.name.toLowerCase();
      const path = n.rel_path.replace(/\.md$/i, "").toLowerCase();
      const folder = n.folder.toLowerCase();
      return (
        name.includes(q) ||
        path.includes(q) ||
        folder.includes(q) ||
        sourceLabel(n.rel_path).toLowerCase().includes(q)
      );
    }).length;
}

export function applyWikilinkSelection(
  text: string,
  trigger: WikilinkSuggestTrigger,
  noteName: string,
): string {
  return (
    text.slice(0, trigger.valueStart) +
    noteName +
    "]]" +
    text.slice(trigger.replaceEnd)
  );
}

export function noteBreadcrumb(note: NoteEntry): string {
  if (!note.folder) return "Raíz";
  return note.folder.replace(/\//g, " / ");
}
