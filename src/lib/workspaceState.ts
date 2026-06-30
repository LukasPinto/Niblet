import type { ViewName } from "../stores/uiStore";

export const WORKSPACE_KEY_PREFIX = "niblet-workspace-";

export type StoredTabKind = "note" | "database" | "image" | "tasks";

export interface StoredTab {
  kind: StoredTabKind;
  /** Ruta relativa para notas e imágenes. */
  relPath?: string;
  /** Carpeta relativa para pestañas de base de datos; null = vault completo. */
  folder?: string | null;
  pinned: boolean;
}

export interface VaultWorkspace {
  version: 1;
  tabs: StoredTab[];
  activeTabKey: string | null;
  previewTabKey: string | null;
  view: ViewName;
  rightPanelOpen: boolean;
  noteTasksCollapsed: boolean;
  noteBacklinksCollapsed: boolean;
}

export function storedTabKey(tab: StoredTab): string {
  if (tab.kind === "note" && tab.relPath) return `note:${tab.relPath}`;
  if (tab.kind === "image" && tab.relPath) return `img:${tab.relPath}`;
  if (tab.kind === "database") return `db:${tab.folder ?? ""}`;
  if (tab.kind === "tasks") return "tasks:";
  return "";
}

export function isValidStoredTab(
  tab: StoredTab,
  noteRelPaths: Set<string>,
  imageRelPaths: Set<string>,
  folders: string[],
  noteFolders: string[],
): boolean {
  if (tab.kind === "note") {
    return !!tab.relPath && noteRelPaths.has(tab.relPath);
  }
  if (tab.kind === "image") {
    return !!tab.relPath && imageRelPaths.has(tab.relPath);
  }
  if (tab.kind === "database") {
    const folder = tab.folder ?? "";
    if (!folder) return true;
    return (
      folders.includes(folder) ||
      folders.some((f) => f.startsWith(`${folder}/`)) ||
      noteFolders.some((f) => f === folder || f.startsWith(`${folder}/`))
    );
  }
  if (tab.kind === "tasks") return true;
  return false;
}

export function loadWorkspace(vaultPath: string): VaultWorkspace | null {
  try {
    const raw = localStorage.getItem(`${WORKSPACE_KEY_PREFIX}${vaultPath}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VaultWorkspace>;
    if (parsed.version !== 1 || !Array.isArray(parsed.tabs)) return null;
    return {
      version: 1,
      tabs: parsed.tabs,
      activeTabKey: parsed.activeTabKey ?? null,
      previewTabKey: parsed.previewTabKey ?? null,
      view: parsed.view ?? "note",
      rightPanelOpen: parsed.rightPanelOpen ?? true,
      noteTasksCollapsed: parsed.noteTasksCollapsed ?? false,
      noteBacklinksCollapsed: parsed.noteBacklinksCollapsed ?? false,
    };
  } catch {
    return null;
  }
}

export function saveWorkspace(vaultPath: string, workspace: VaultWorkspace): void {
  try {
    localStorage.setItem(
      `${WORKSPACE_KEY_PREFIX}${vaultPath}`,
      JSON.stringify(workspace),
    );
  } catch {
    /* localStorage puede no estar disponible */
  }
}

export function clearWorkspace(vaultPath: string): void {
  try {
    localStorage.removeItem(`${WORKSPACE_KEY_PREFIX}${vaultPath}`);
  } catch {
    /* ignore */
  }
}
