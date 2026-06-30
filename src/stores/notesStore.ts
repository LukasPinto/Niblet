import { create } from "zustand";
import {
  listNotes,
  listFolders,
  listImages,
  createNote,
  createFolder,
  deleteNote,
  deleteFolder,
  deleteFile,
  type NoteEntry,
  type ImageEntry,
} from "../lib/tauri";
import { useVaultStore } from "./vaultStore";
import { useTabsStore, noteTabId } from "./tabsStore";
import { useTasksStore } from "./tasksStore";
import { useSyncStore } from "./syncStore";

interface NotesState {
  notes: NoteEntry[];
  folders: string[];
  images: ImageEntry[];
  activePath: string | null;
  activeContent: string;
  dirty: boolean;
  loading: boolean;
  refreshNotes: () => Promise<void>;
  refreshImages: () => Promise<void>;
  openNote: (path: string) => Promise<void>;
  openByRelPath: (relPath: string) => Promise<void>;
  setActiveContent: (content: string) => void;
  saveActive: () => Promise<void>;
  newNote: (folder: string, name: string) => Promise<string | null>;
  newFolder: (parentFolder: string, name: string) => Promise<string | null>;
  removeNote: (path: string) => Promise<void>;
  removeFolder: (relPath: string) => Promise<void>;
  removeImage: (path: string) => Promise<void>;
  activeEntry: () => NoteEntry | undefined;
}

function todayTemplate(name: string): string {
  const d = new Date();
  const iso = d.toISOString().slice(0, 10);
  return `---\nfecha: ${iso}\ntags: []\nanimo: \n---\n# ${name}\n`;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  folders: [],
  images: [],
  activePath: null,
  activeContent: "",
  dirty: false,
  loading: false,

  refreshNotes: async () => {
    const vault = useVaultStore.getState().vaultPath;
    if (!vault) return;
    set({ loading: true });
    try {
      const [notes, folders, images] = await Promise.all([
        listNotes(vault),
        listFolders(vault),
        listImages(vault),
      ]);
      set({ notes, folders, images });
      const tabs = useTabsStore.getState();
      await tabs.pruneMissingTabs();

      if (useTabsStore.getState().tabs.length === 0) {
        const { tryRestoreWorkspace } = await import("./workspaceStore");
        const restored = await tryRestoreWorkspace(vault);
        if (!restored && useTabsStore.getState().tabs.length === 0) {
          const last = useVaultStore.getState().config.lastOpenedNote;
          const target =
            (last && notes.find((n) => n.rel_path === last)) || notes[0];
          if (target) await useTabsStore.getState().openPinned(target.path);
        }
      } else {
        const { scheduleWorkspaceSave } = await import("./workspaceStore");
        scheduleWorkspaceSave();
      }

      const tabsAfter = useTabsStore.getState();
      const active = tabsAfter.activeTab();
      set({
        activePath: tabsAfter.activePath(),
        activeContent: active?.kind === "note" ? (active.content ?? "") : "",
        dirty: active?.dirty ?? false,
      });
    } finally {
      set({ loading: false });
    }
  },

  refreshImages: async () => {
    const vault = useVaultStore.getState().vaultPath;
    if (!vault) return;
    const images = await listImages(vault);
    set({ images });
  },

  openNote: async (path) => {
    await useTabsStore.getState().openPinned(path);
    const tab = useTabsStore.getState().getNoteTab(path);
    set({
      activePath: path,
      activeContent: tab?.content ?? "",
      dirty: tab?.dirty ?? false,
    });
  },

  openByRelPath: async (relPath) => {
    const entry = get().notes.find((n) => n.rel_path === relPath);
    if (entry) await get().openNote(entry.path);
  },

  setActiveContent: (content) => {
    const path = useTabsStore.getState().activePath();
    if (path) useTabsStore.getState().setTabContent(path, content);
    set({ activeContent: content, dirty: true });
  },

  saveActive: async () => {
    const path = useTabsStore.getState().activePath();
    if (!path) return;
    await useTabsStore.getState().saveTab(path);
    const tab = useTabsStore.getState().getNoteTab(path);
    set({ dirty: tab?.dirty ?? false, activeContent: tab?.content ?? "" });
  },

  newNote: async (folder, name) => {
    const vault = useVaultStore.getState().vaultPath;
    if (!vault) return null;
    const safe = name.trim().replace(/[\\/:*?"<>|]/g, "-") || "Sin título";
    const rel = folder ? `${folder}/${safe}.md` : `${safe}.md`;
    const path = `${vault}/${rel}`;
    await createNote(path, todayTemplate(safe));
    await get().refreshNotes();
    await useTabsStore.getState().openPinned(path);
    set({ activePath: path, activeContent: todayTemplate(safe), dirty: false });
    useSyncStore.getState().scheduleSyncOnSave();
    return path;
  },

  newFolder: async (parentFolder, name) => {
    const vault = useVaultStore.getState().vaultPath;
    if (!vault) return null;
    const safe = name.trim().replace(/[\\/:*?"<>|]/g, "-");
    if (!safe) return null;
    const rel = parentFolder ? `${parentFolder}/${safe}` : safe;
    await createFolder(vault, rel);
    await get().refreshNotes();
    useSyncStore.getState().scheduleSyncOnSave();
    return rel;
  },

  removeNote: async (path) => {
    await deleteNote(path);
    await useTabsStore.getState().closeTab(noteTabId(path));
    const tabs = useTabsStore.getState();
    const activePath = tabs.activePath();
    const active = tabs.activeTab();
    set({
      activePath,
      activeContent: active?.kind === "note" ? (active.content ?? "") : "",
      dirty: active?.dirty ?? false,
    });
    await get().refreshNotes();
    await useTasksStore.getState().refreshConflicts();
    useSyncStore.getState().scheduleSyncOnSave();
  },

  removeFolder: async (relPath) => {
    const vault = useVaultStore.getState().vaultPath;
    if (!vault) return;
    await deleteFolder(vault, relPath);
    // Cerrar cualquier pestaña (nota o imagen) cuyo archivo esté bajo la carpeta.
    const prefix = `${vault}/${relPath}/`;
    const tabs = useTabsStore.getState();
    for (const tab of [...tabs.tabs]) {
      if (tab.path && tab.path.startsWith(prefix)) {
        await tabs.closeTab(tab.id);
      }
    }
    await get().refreshNotes();
    await get().refreshImages();
    await useTasksStore.getState().refreshConflicts();
    useSyncStore.getState().scheduleSyncOnSave();
  },

  removeImage: async (path) => {
    await deleteFile(path);
    await useTabsStore.getState().closeTabByPath(path);
    await get().refreshImages();
    useSyncStore.getState().scheduleSyncOnSave();
  },

  activeEntry: () => {
    const { notes } = get();
    const activePath = useTabsStore.getState().activePath();
    return notes.find((n) => n.path === activePath);
  },
}));
