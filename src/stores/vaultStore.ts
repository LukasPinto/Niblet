import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { readNote, writeNote, watchVault, listNotes } from "../lib/tauri";
import { useUiStore } from "./uiStore";
import { useTabsStore } from "./tabsStore";
import { resetSaveSyncTimer, useSyncStore } from "./syncStore";
import { useDatabaseViewStore } from "./databaseViewStore";
import {
  flushWorkspaceSave,
  onVaultSessionStart,
  resetWorkspaceSession,
} from "./workspaceStore";
import { CONFIG_REL, VAULT_META_DIR } from "../lib/vaultPaths";

export type NoteEditorMode = "edit" | "blocks" | "preview";
export type TasksMode = "list" | "kanban";

export type ThemeName = "dark" | "light";
export type AccentName = "blue" | "teal" | "amber" | "rose";

export interface OneDriveConfig {
  /** Carpeta remota dentro de OneDrive (ruta relativa a la raíz del Drive). */
  remoteFolder: string;
  /** Nombre/cuenta del usuario conectado (informativo). */
  accountName: string;
  /** ISO de la última sincronización exitosa. */
  lastSync: string | null;
  /** Sincronizar al abrir el vault. */
  autoSync: boolean;
  /** Sincronizar con OneDrive tras guardar una nota (debounced). */
  syncOnSave: boolean;
  /** Milisegundos de espera tras el último guardado antes de subir. */
  syncOnSaveDelayMs: number;
  /** Intervalo de sync completa en minutos (0 = desactivado). */
  syncIntervalMinutes: number;
}

export const DEFAULT_ONEDRIVE: OneDriveConfig = {
  remoteFolder: "NibletVault",
  accountName: "",
  lastSync: null,
  autoSync: true,
  syncOnSave: true,
  syncOnSaveDelayMs: 3000,
  syncIntervalMinutes: 5,
};

export interface NibletConfig {
  theme: ThemeName;
  accent: AccentName;
  lastOpenedNote: string | null;
  noteEditorMode: NoteEditorMode;
  tasksMode: TasksMode;
  taskSyntax: { due: string; scheduled: string; highPriority: string };
  scanFolders: string[];
  ignoreFolders: string[];
  includeConfigInSync: boolean;
  onedrive: OneDriveConfig | null;
  /** Carpeta donde se crean las notas diarias. */
  dailyNotesFolder: string;
  /** Formato de fecha para el nombre del archivo (soporta YYYY, MM, DD). */
  dailyNotesDateFormat: string;
  /** Al abrir una nota diaria, expandir su carpeta en el árbol lateral. */
  dailyNotesAutoReveal: boolean;
}

export const DEFAULT_CONFIG: NibletConfig = {
  theme: "dark",
  accent: "blue",
  lastOpenedNote: null,
  noteEditorMode: "edit",
  tasksMode: "list",
  taskSyntax: { due: "📅", scheduled: "⏳", highPriority: "⏫" },
  scanFolders: ["*"],
  ignoreFolders: [VAULT_META_DIR, ".obsidian"],
  includeConfigInSync: true,
  onedrive: null,
  dailyNotesFolder: "Daily Notes",
  dailyNotesDateFormat: "YYYY-MM-DD",
  dailyNotesAutoReveal: false,
};

const VAULT_KEY = "niblet-vault-path";

interface VaultState {
  vaultPath: string | null;
  config: NibletConfig;
  ready: boolean;
  configPath: () => string | null;
  applyToDom: () => void;
  openVault: () => Promise<boolean>;
  setVault: (path: string) => Promise<void>;
  closeVault: () => void;
  initVault: () => Promise<boolean>;
  updateConfig: (patch: Partial<NibletConfig>) => Promise<void>;
  persistConfig: () => Promise<void>;
}

function lastSegment(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultPath: null,
  config: DEFAULT_CONFIG,
  ready: false,

  configPath: () => {
    const v = get().vaultPath;
    return v ? `${v}/${CONFIG_REL}` : null;
  },

  applyToDom: () => {
    const { theme, accent } = get().config;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accent;
  },

  openVault: async () => {
    const selected = await open({ directory: true, title: "Elige tu Vault" });
    if (typeof selected !== "string") return false;
    await get().setVault(selected);
    return true;
  },

  setVault: async (path) => {
    // Normalizar separadores a "/" para que las rutas absolutas construidas
    // en el frontend (`${vault}/${rel}`) coincidan con las de list_notes.
    path = path.replace(/\\/g, "/");
    const prev = get().vaultPath;
    if (prev && prev !== path) {
      flushWorkspaceSave();
      resetWorkspaceSession();
    }
    // Cargar config existente (si la hay) desde el propio vault.
    let config = { ...DEFAULT_CONFIG };
    try {
      const raw = await readNote(`${path}/${CONFIG_REL}`);
      const parsed = JSON.parse(raw) as Partial<NibletConfig>;
      config = {
        ...DEFAULT_CONFIG,
        ...parsed,
        onedrive: parsed.onedrive
          ? { ...DEFAULT_ONEDRIVE, ...parsed.onedrive }
          : null,
      };
    } catch {
      // primer arranque del vault: se creará al persistir
    }
    set({ vaultPath: path, config, ready: true });
    useUiStore.setState({ tasksMode: config.tasksMode ?? "list" });
    onVaultSessionStart(path);
    useTabsStore.getState().resetTabs();
    useDatabaseViewStore.getState().reset();
    resetSaveSyncTimer();
    useSyncStore.setState({ status: "idle", error: null, lastResult: null });
    void useDatabaseViewStore.getState().load(path);
    // Recordar el vault para la próxima sesión.
    try {
      localStorage.setItem(VAULT_KEY, path);
    } catch {
      /* localStorage puede no estar disponible */
    }
    get().applyToDom();
    // Persistir (crea .niblet/config.json si no existía) y arrancar watcher.
    await get().persistConfig();
    try {
      await watchVault(path);
    } catch {
      /* watcher es best-effort */
    }
  },

  closeVault: () => {
    flushWorkspaceSave();
    resetWorkspaceSession();
    // Olvidar el vault actual y volver a la pantalla de bienvenida, sin
    // necesidad de reiniciar la app (estilo "cerrar bóveda" de Obsidian).
    try {
      localStorage.removeItem(VAULT_KEY);
    } catch {
      /* localStorage puede no estar disponible */
    }
    set({ vaultPath: null, config: DEFAULT_CONFIG, ready: false });
    useTabsStore.getState().resetTabs();
    useDatabaseViewStore.getState().reset();
    resetSaveSyncTimer();
    useSyncStore.setState({ status: "idle", error: null, lastResult: null });
    useUiStore.setState({ view: "note" });
  },

  initVault: async () => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(VAULT_KEY);
    } catch {
      saved = null;
    }
    if (!saved) return false;
    try {
      // Verificar que el vault sigue existiendo (listNotes falla si no).
      await listNotes(saved);
      await get().setVault(saved);
      return true;
    } catch {
      // El vault guardado ya no es accesible: olvidarlo.
      try {
        localStorage.removeItem(VAULT_KEY);
      } catch {
        /* ignore */
      }
      return false;
    }
  },

  updateConfig: async (patch) => {
    set({ config: { ...get().config, ...patch } });
    get().applyToDom();
    await get().persistConfig();
  },

  persistConfig: async () => {
    const cp = get().configPath();
    if (!cp) return;
    try {
      await writeNote(cp, JSON.stringify(get().config, null, 2));
    } catch {
      /* no romper la UI si falla el guardado de config */
    }
  },
}));

export { lastSegment };
