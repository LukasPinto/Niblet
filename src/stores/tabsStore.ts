import { create } from "zustand";
import { readNote, writeNote, recordSave, normalizePath } from "../lib/tauri";
import { useVaultStore } from "./vaultStore";
import { useNotesStore } from "./notesStore";
import { useSyncStore } from "./syncStore";
import { useUiStore } from "./uiStore";
import { useLinksStore } from "./linksStore";
import type { VaultWorkspace } from "../lib/workspaceState";
import { isValidStoredTab, storedTabKey } from "../lib/workspaceState";

export type TabKind = "note" | "database" | "image" | "tasks";

export interface EditorTab {
  id: string;
  kind: TabKind;
  pinned: boolean;
  /** Nota/imagen: ruta absoluta del archivo. */
  path?: string;
  content?: string;
  dirty?: boolean;
  /** Incrementa cuando el contenido cambia en disco (p. ej. enlaces tras mover). */
  contentEpoch?: number;
  /** BD: carpeta relativa; null = vault completo. */
  folder?: string | null;
}

interface TabsState {
  tabs: EditorTab[];
  activeTabId: string | null;
  previewTabId: string | null;
  /** Historial de navegación (ids de pestañas visitadas). */
  history: string[];
  historyIndex: number;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  openPreview: (path: string) => Promise<void>;
  openPinned: (path: string) => Promise<void>;
  openImageTab: (path: string) => Promise<void>;
  openTasksTab: () => Promise<void>;
  pinTab: (id: string) => Promise<void>;
  openDatabaseTab: (folder: string | null, pinned?: boolean) => Promise<void>;
  setActiveTab: (id: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  closeTabByPath: (path: string) => Promise<void>;
  setTabContent: (path: string, content: string) => void;
  saveTab: (path: string) => Promise<void>;
  saveActiveTab: () => Promise<void>;
  resetTabs: () => void;
  getTab: (id: string) => EditorTab | undefined;
  getNoteTab: (path: string) => EditorTab | undefined;
  activeTab: () => EditorTab | undefined;
  activePath: () => string | null;
  reloadTabFromDisk: (path: string) => Promise<void>;
  applyExternalTabContent: (
    path: string,
    content: string,
    opts?: { keepDirty?: boolean },
  ) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  pruneMissingTabs: () => Promise<void>;
  restoreFromWorkspace: (ws: VaultWorkspace) => Promise<boolean>;
}

export function noteTabId(path: string): string {
  return `note:${normalizePath(path)}`;
}

export function databaseTabId(folder: string | null): string {
  return `db:${folder ?? ""}`;
}

export function imageTabId(path: string): string {
  return `img:${normalizePath(path)}`;
}

/** Id de la pestaña de tareas (singleton: solo existe una). */
export function tasksTabId(): string {
  return "tasks:";
}

function updateLastOpened(path: string) {
  const entry = useNotesStore.getState().notes.find((n) => n.path === path);
  if (entry) {
    useVaultStore.getState().updateConfig({ lastOpenedNote: entry.rel_path });
  }
}

async function loadContent(path: string): Promise<string> {
  return readNote(path);
}

async function persistNoteTab(tab: EditorTab) {
  if (tab.kind !== "note" || !tab.path || !tab.dirty) return;
  await writeNote(tab.path, tab.content ?? "");
  const vault = useVaultStore.getState().vaultPath;
  const entry = useNotesStore.getState().notes.find((n) => n.path === tab.path);
  if (vault && entry) {
    await recordSave(vault, entry.rel_path, tab.content ?? "").catch(() => {});
  }
}

async function saveActiveNoteTab() {
  const active = useTabsStore.getState().activeTab();
  if (active?.kind === "note" && active.path) {
    await useTabsStore.getState().saveTab(active.path);
  }
}

function focusEditorTab(tab: EditorTab) {
  useUiStore.getState().setView("note");
  if (tab.kind === "database") {
    useUiStore.setState({ dbFolder: tab.folder ?? null });
  }
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  previewTabId: null,
  history: [],
  historyIndex: -1,

  goBack: async () => {
    const { history, historyIndex, tabs } = get();
    let idx = historyIndex - 1;
    while (idx >= 0 && !tabs.some((t) => t.id === history[idx])) idx--;
    if (idx < 0) return;
    navigatingHistory = true;
    try {
      set({ historyIndex: idx });
      await get().setActiveTab(history[idx]);
    } finally {
      navigatingHistory = false;
    }
  },

  goForward: async () => {
    const { history, historyIndex, tabs } = get();
    let idx = historyIndex + 1;
    while (idx < history.length && !tabs.some((t) => t.id === history[idx])) idx++;
    if (idx >= history.length) return;
    navigatingHistory = true;
    try {
      set({ historyIndex: idx });
      await get().setActiveTab(history[idx]);
    } finally {
      navigatingHistory = false;
    }
  },

  getTab: (id) => get().tabs.find((t) => t.id === id),

  getNoteTab: (path) => get().tabs.find((t) => t.kind === "note" && t.path === path),

  activeTab: () => {
    const { tabs, activeTabId } = get();
    return tabs.find((t) => t.id === activeTabId);
  },

  activePath: () => {
    const tab = get().activeTab();
    return tab?.kind === "note" ? (tab.path ?? null) : null;
  },

  resetTabs: () =>
    set({
      tabs: [],
      activeTabId: null,
      previewTabId: null,
      history: [],
      historyIndex: -1,
    }),

  reloadTabFromDisk: async (path) => {
    const tab = get().getNoteTab(path);
    if (!tab) return;
    const content = await loadContent(path);
    set({
      tabs: get().tabs.map((t) =>
        t.id === tab.id
          ? {
              ...t,
              content,
              dirty: false,
              contentEpoch: (t.contentEpoch ?? 0) + 1,
            }
          : t,
      ),
    });
  },

  applyExternalTabContent: (path, content, opts = {}) => {
    const tab = get().getNoteTab(path);
    if (!tab) return;
    set({
      tabs: get().tabs.map((t) =>
        t.id === tab.id
          ? {
              ...t,
              content,
              dirty: opts.keepDirty ? (t.dirty ?? false) : false,
              contentEpoch: (t.contentEpoch ?? 0) + 1,
            }
          : t,
      ),
    });
  },

  reorderTabs: (fromIndex, toIndex) => {
    const { tabs } = get();
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= tabs.length ||
      toIndex >= tabs.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const next = [...tabs];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    set({ tabs: next });
  },

  pruneMissingTabs: async () => {
    const notes = useNotesStore.getState().notes;
    const images = useNotesStore.getState().images;
    const notePaths = new Set(notes.map((n) => n.path));
    const imagePaths = new Set(images.map((i) => i.path));

    const toClose = get().tabs.filter((t) => {
      if (t.kind === "note" && t.path) return !notePaths.has(t.path);
      if (t.kind === "image" && t.path) return !imagePaths.has(t.path);
      return false;
    });

    for (const tab of toClose) {
      await get().closeTab(tab.id);
    }
  },

  restoreFromWorkspace: async (ws) => {
    const notes = useNotesStore.getState().notes;
    const images = useNotesStore.getState().images;
    const folders = useNotesStore.getState().folders;
    const noteRelPaths = new Set(notes.map((n) => n.rel_path));
    const imageRelPaths = new Set(images.map((i) => i.rel_path));
    const noteFolders = notes.map((n) => n.folder);

    const valid = ws.tabs.filter((t) =>
      isValidStoredTab(t, noteRelPaths, imageRelPaths, folders, noteFolders),
    );
    if (valid.length === 0) return false;

    const newTabs: EditorTab[] = [];
    const keyToId = new Map<string, string>();

    for (const st of valid) {
      if (st.kind === "note" && st.relPath) {
        const note = notes.find((n) => n.rel_path === st.relPath);
        if (!note) continue;
        const content = await loadContent(note.path);
        const id = noteTabId(note.path);
        newTabs.push({
          id,
          kind: "note",
          path: note.path,
          pinned: st.pinned,
          content,
          dirty: false,
        });
        keyToId.set(storedTabKey(st), id);
      } else if (st.kind === "image" && st.relPath) {
        const image = images.find((i) => i.rel_path === st.relPath);
        if (!image) continue;
        const id = imageTabId(image.path);
        newTabs.push({ id, kind: "image", path: image.path, pinned: true });
        keyToId.set(storedTabKey(st), id);
      } else if (st.kind === "database") {
        const id = databaseTabId(st.folder ?? null);
        newTabs.push({
          id,
          kind: "database",
          folder: st.folder ?? null,
          pinned: st.pinned,
        });
        keyToId.set(storedTabKey(st), id);
      } else if (st.kind === "tasks") {
        const id = tasksTabId();
        newTabs.push({ id, kind: "tasks", pinned: true });
        keyToId.set(storedTabKey(st), id);
      }
    }

    if (newTabs.length === 0) return false;

    let activeTabId = ws.activeTabKey
      ? (keyToId.get(ws.activeTabKey) ?? null)
      : null;
    if (activeTabId && !newTabs.some((t) => t.id === activeTabId)) {
      activeTabId = null;
    }
    if (!activeTabId) activeTabId = newTabs[0]?.id ?? null;

    let previewTabId = ws.previewTabKey
      ? (keyToId.get(ws.previewTabKey) ?? null)
      : null;
    if (previewTabId && !newTabs.some((t) => t.id === previewTabId)) {
      previewTabId = null;
    }

    set({ tabs: newTabs, activeTabId, previewTabId });

    const restoredView =
      ws.view === "base" || ws.view === "tasks" ? "note" : ws.view;
    useUiStore.setState({
      view: restoredView,
      rightPanelOpen: ws.rightPanelOpen,
      noteTasksCollapsed: ws.noteTasksCollapsed,
      noteBacklinksCollapsed: ws.noteBacklinksCollapsed,
    });

    const active = newTabs.find((t) => t.id === activeTabId);
    if (active) {
      focusEditorTab(active);
      if (active.kind === "note" && active.path) updateLastOpened(active.path);
    }

    return true;
  },

  saveTab: async (path) => {
    const tab = get().getNoteTab(path);
    if (!tab?.dirty) return;
    await persistNoteTab(tab);
    set({
      tabs: get().tabs.map((t) =>
        t.id === tab.id ? { ...t, dirty: false } : t,
      ),
    });
    useLinksStore.getState().scheduleRefresh();
    useSyncStore.getState().scheduleSyncOnSave();
  },

  saveActiveTab: async () => {
    const active = get().activeTab();
    if (active?.kind === "note" && active.path) {
      await get().saveTab(active.path);
    }
  },

  setTabContent: (path, content) => {
    const tab = get().getNoteTab(path);
    if (!tab) return;
    set({
      tabs: get().tabs.map((t) =>
        t.id === tab.id ? { ...t, content, dirty: true } : t,
      ),
    });
  },

  setActiveTab: async (id) => {
    const state = get();
    if (state.activeTabId === id) return;
    await saveActiveNoteTab();
    const tab = state.getTab(id);
    if (!tab) return;
    set({ activeTabId: id });
    focusEditorTab(tab);
    if (tab.kind === "note" && tab.path) updateLastOpened(tab.path);
  },

  closeTab: async (id) => {
    const state = get();
    const tab = state.getTab(id);
    if (!tab) return;
    if (tab.kind === "note") await persistNoteTab(tab);

    const remaining = state.tabs.filter((t) => t.id !== id);
    let { activeTabId, previewTabId } = state;

    if (previewTabId === id) previewTabId = null;
    if (activeTabId === id) {
      const closedIdx = state.tabs.findIndex((t) => t.id === id);
      const next =
        remaining[closedIdx] ??
        remaining[closedIdx - 1] ??
        remaining[remaining.length - 1] ??
        null;
      activeTabId = next?.id ?? null;
    }

    set({ tabs: remaining, activeTabId, previewTabId });
    const active = remaining.find((t) => t.id === activeTabId);
    if (active) focusEditorTab(active);
  },

  closeTabByPath: async (path) => {
    const tab = get().tabs.find((t) => t.kind === "image" && t.path === path);
    if (tab) await get().closeTab(tab.id);
  },

  openDatabaseTab: async (folder, pinned = true) => {
    const state = get();
    await saveActiveNoteTab();

    const id = databaseTabId(folder);
    const existing = state.getTab(id);
    if (existing) {
      set({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, pinned: pinned || t.pinned } : t,
        ),
        activeTabId: id,
        previewTabId: state.previewTabId === id ? null : state.previewTabId,
      });
      focusEditorTab({ ...existing, folder });
      return;
    }

    set({
      tabs: [
        ...state.tabs,
        { id, kind: "database", pinned, folder },
      ],
      activeTabId: id,
    });
    focusEditorTab({ id, kind: "database", pinned, folder });
  },

  openPinned: async (path) => {
    path = normalizePath(path);
    const state = get();
    await saveActiveNoteTab();

    const id = noteTabId(path);
    const existing = state.getTab(id);
    if (existing) {
      set({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, pinned: true } : t,
        ),
        activeTabId: id,
        previewTabId: state.previewTabId === id ? null : state.previewTabId,
      });
      focusEditorTab({ ...existing, path });
      updateLastOpened(path);
      return;
    }

    const content = await loadContent(path);
    set({
      tabs: [
        ...state.tabs,
        { id, kind: "note", path, pinned: true, content, dirty: false },
      ],
      activeTabId: id,
    });
    focusEditorTab({ id, kind: "note", path, pinned: true });
    updateLastOpened(path);
  },

  openImageTab: async (path) => {
    path = normalizePath(path);
    const state = get();
    await saveActiveNoteTab();

    const id = imageTabId(path);
    const existing = state.getTab(id);
    if (existing) {
      set({ activeTabId: id });
      focusEditorTab(existing);
      return;
    }

    set({
      tabs: [...state.tabs, { id, kind: "image", path, pinned: true }],
      activeTabId: id,
    });
    focusEditorTab({ id, kind: "image", path, pinned: true });
  },

  openTasksTab: async () => {
    const state = get();
    await saveActiveNoteTab();

    const id = tasksTabId();
    const existing = state.getTab(id);
    if (existing) {
      set({
        activeTabId: id,
        previewTabId: state.previewTabId === id ? null : state.previewTabId,
      });
      focusEditorTab(existing);
      return;
    }

    set({
      tabs: [...state.tabs, { id, kind: "tasks", pinned: true }],
      activeTabId: id,
    });
    focusEditorTab({ id, kind: "tasks", pinned: true });
  },

  pinTab: async (id) => {
    const state = get();
    const existing = state.getTab(id);
    if (!existing) return;

    await saveActiveNoteTab();
    set({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, pinned: true } : t)),
      activeTabId: id,
      previewTabId: state.previewTabId === id ? null : state.previewTabId,
    });
    focusEditorTab(existing);
    if (existing.kind === "note" && existing.path) updateLastOpened(existing.path);
  },

  openPreview: async (path) => {
    path = normalizePath(path);
    const state = get();
    const id = noteTabId(path);
    const existing = state.getTab(id);
    if (existing) {
      await get().setActiveTab(id);
      return;
    }

    await saveActiveNoteTab();
    const content = await loadContent(path);

    if (state.previewTabId) {
      const previewIdx = state.tabs.findIndex((t) => t.id === state.previewTabId);
      if (previewIdx >= 0) {
        const next = [...state.tabs];
        next[previewIdx] = {
          id,
          kind: "note",
          path,
          pinned: false,
          content,
          dirty: false,
        };
        set({ tabs: next, activeTabId: id, previewTabId: id });
        focusEditorTab({ id, kind: "note", path, pinned: false });
        updateLastOpened(path);
        return;
      }
    }

    set({
      tabs: [
        ...state.tabs,
        { id, kind: "note", path, pinned: false, content, dirty: false },
      ],
      activeTabId: id,
      previewTabId: id,
    });
    focusEditorTab({ id, kind: "note", path, pinned: false });
    updateLastOpened(path);
  },
}));

// Flag para no registrar en el historial cuando navegamos con back/forward.
let navigatingHistory = false;

// Registrar cada cambio de pestaña activa en el historial de navegación.
useTabsStore.subscribe((state, prev) => {
  if (navigatingHistory) return;
  if (state.activeTabId === prev.activeTabId) return;
  const id = state.activeTabId;
  if (!id) return;
  const { history, historyIndex } = state;
  if (history[historyIndex] === id) return;
  const next = history.slice(0, historyIndex + 1);
  next.push(id);
  useTabsStore.setState({ history: next, historyIndex: next.length - 1 });
});
