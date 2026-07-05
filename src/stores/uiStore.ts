import { create } from "zustand";
import type { ConflictEntry } from "../lib/tauri";

export type ViewName = "note" | "tasks" | "base" | "settings";
export type TasksMode = "list" | "kanban";
export type FloatingPanelKind = "calendar" | "tasks" | "backlinks";

export type ContextItemType = "folder" | "note" | "image";

export interface ContextMenuState {
  x: number;
  y: number;
  /** Carpeta contenedora (para "Nueva nota"/"Nueva carpeta"). */
  folder: string;
  /** Tipo del ítem sobre el que se hizo clic derecho (para "Eliminar"). */
  itemType?: ContextItemType;
  /** Ruta absoluta del ítem (nota/imagen) o relativa de la carpeta. */
  itemPath?: string;
  /** Nombre legible para el diálogo de confirmación. */
  itemName?: string;
}

interface UiState {
  view: ViewName;
  paletteOpen: boolean;
  tasksMode: TasksMode;
  conflict: ConflictEntry | null;
  dbFolder: string | null;
  contextMenu: ContextMenuState | null;
  /** Panel derecho (calendario) visible. Persistido en workspace local. */
  rightPanelOpen: boolean;
  /** Barra lateral izquierda anclada. Persistido en workspace local. */
  sidebarOpen: boolean;
  /** Resumen de tareas de la nota colapsado. Persistido en workspace local. */
  noteTasksCollapsed: boolean;
  noteBacklinksCollapsed: boolean;
  /** Popover flotante del panel derecho (solo con la barra plegada). */
  floatingPanel: FloatingPanelKind | null;
  setView: (view: ViewName) => void;
  togglePalette: (open?: boolean) => void;
  setTasksMode: (mode: TasksMode) => void;
  openConflict: (c: ConflictEntry | null) => void;
  openDatabase: (folder: string | null) => void;
  openContextMenu: (
    x: number,
    y: number,
    folder: string,
    itemType?: ContextItemType,
    itemPath?: string,
    itemName?: string,
  ) => void;
  closeContextMenu: () => void;
  toggleRightPanel: (open?: boolean) => void;
  toggleSidebar: (open?: boolean) => void;
  setNoteTasksCollapsed: (v: boolean) => void;
  setNoteBacklinksCollapsed: (v: boolean) => void;
  toggleFloatingPanel: (kind: FloatingPanelKind) => void;
  closeFloatingPanel: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "note",
  paletteOpen: false,
  tasksMode: "list",
  conflict: null,
  dbFolder: null,
  contextMenu: null,
  rightPanelOpen: true,
  sidebarOpen: true,
  noteTasksCollapsed: false,
  noteBacklinksCollapsed: false,
  floatingPanel: null,
  setView: (view) => set({ view, paletteOpen: false, floatingPanel: null }),
  togglePalette: (open) =>
    set((s) => ({ paletteOpen: open ?? !s.paletteOpen })),
  setTasksMode: (mode) => set({ tasksMode: mode }),
  openConflict: (conflict) => set({ conflict }),
  openDatabase: (dbFolder) => set({ dbFolder, view: "base", paletteOpen: false }),
  openContextMenu: (x, y, folder, itemType, itemPath, itemName) =>
    set({ contextMenu: { x, y, folder, itemType, itemPath, itemName } }),
  closeContextMenu: () => set({ contextMenu: null }),
  toggleRightPanel: (open) =>
    set((s) => {
      const nextOpen = open ?? !s.rightPanelOpen;
      return {
        rightPanelOpen: nextOpen,
        floatingPanel: nextOpen ? null : s.floatingPanel,
      };
    }),
  toggleSidebar: (open) =>
    set((s) => ({ sidebarOpen: open ?? !s.sidebarOpen })),
  setNoteTasksCollapsed: (v) => set({ noteTasksCollapsed: v }),
  setNoteBacklinksCollapsed: (v) => set({ noteBacklinksCollapsed: v }),
  toggleFloatingPanel: (kind) =>
    set((s) => ({
      floatingPanel: s.floatingPanel === kind ? null : kind,
    })),
  closeFloatingPanel: () => set({ floatingPanel: null }),
}));
