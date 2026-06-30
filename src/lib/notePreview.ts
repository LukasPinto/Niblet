import { parseFrontmatter, renderMarkdown } from "./markdown";
import { readNote } from "./tauri";
import { sourceLabel } from "./taskParser";
import { useNotesStore } from "../stores/notesStore";
import { useTabsStore } from "../stores/tabsStore";
import { useVaultStore } from "../stores/vaultStore";

export interface NotePreviewModel {
  name: string;
  relPath: string;
  breadcrumb: string;
  tags: string[];
  html: string;
}

function extractSnippet(body: string, maxLen: number): string {
  const trimmed = body.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastBreak = cut.lastIndexOf("\n\n");
  const snippet = lastBreak > 120 ? cut.slice(0, lastBreak) : cut;
  return `${snippet.trimEnd()}\n\n…`;
}

export async function buildNotePreview(relPath: string): Promise<NotePreviewModel | null> {
  const notes = useNotesStore.getState().notes;
  const entry = notes.find((n) => n.rel_path === relPath);
  if (!entry) return null;

  const vault = useVaultStore.getState().vaultPath;
  const tab = useTabsStore.getState().getNoteTab(entry.path);
  let raw = tab?.content;
  if (raw === undefined) {
    try {
      raw = await readNote(entry.path);
    } catch {
      return null;
    }
  }

  const { data, content: body } = parseFrontmatter(raw);
  const snippet = extractSnippet(body, 1400);
  const html = await renderMarkdown(snippet, vault ?? undefined, notes);

  const tags = data.tags
    ? Array.isArray(data.tags)
      ? data.tags.map(String)
      : [String(data.tags)]
    : [];

  return {
    name: entry.name,
    relPath: entry.rel_path,
    breadcrumb: sourceLabel(entry.rel_path),
    tags,
    html,
  };
}
