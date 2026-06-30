import { create } from "zustand";
import {
  buildNoteIndex,
  scanNoteLinks,
  type ResolvedLink,
} from "../lib/linkParser";
import { readNote } from "../lib/tauri";
import { useVaultStore } from "./vaultStore";
import { useNotesStore } from "./notesStore";

interface LinksState {
  links: ResolvedLink[];
  scanning: boolean;
  refreshLinks: () => Promise<void>;
  scheduleRefresh: () => void;
  outgoingFor: (relPath: string) => ResolvedLink[];
  backlinksFor: (relPath: string) => ResolvedLink[];
}

let refreshTimer: number | undefined;

export const useLinksStore = create<LinksState>((set, get) => ({
  links: [],
  scanning: false,

  refreshLinks: async () => {
    const vault = useVaultStore.getState().vaultPath;
    const notes = useNotesStore.getState().notes;
    if (!vault || notes.length === 0) {
      set({ links: [] });
      return;
    }

    set({ scanning: true });
    try {
      const index = buildNoteIndex(notes);
      const all: ResolvedLink[] = [];
      await Promise.all(
        notes.map(async (n) => {
          try {
            const raw = await readNote(n.path);
            all.push(...scanNoteLinks(n.path, n.rel_path, raw, index));
          } catch {
            /* nota ilegible */
          }
        }),
      );
      set({ links: all });
    } finally {
      set({ scanning: false });
    }
  },

  scheduleRefresh: () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      void get().refreshLinks();
    }, 500);
  },

  outgoingFor: (relPath) =>
    get().links.filter((l) => l.sourceRelPath === relPath),

  backlinksFor: (relPath) =>
    get().links.filter(
      (l) => l.resolvedRelPath === relPath && l.sourceRelPath !== relPath,
    ),
}));
