import type { VaultWorkspace } from "./workspaceState";
import { saveWorkspace as persistWorkspace } from "./workspaceState";
import { useNotesStore } from "../stores/notesStore";
import { useTabsStore, type EditorTab } from "../stores/tabsStore";
import { useUiStore } from "../stores/uiStore";

export { loadWorkspace } from "./workspaceState";

export function editorTabToStored(
  tab: EditorTab,
  notes: ReturnType<typeof useNotesStore.getState>["notes"],
  images: ReturnType<typeof useNotesStore.getState>["images"],
) {
  if (tab.kind === "note" && tab.path) {
    const note = notes.find((n) => n.path === tab.path);
    if (!note) return null;
    return { kind: "note" as const, relPath: note.rel_path, pinned: tab.pinned };
  }
  if (tab.kind === "image" && tab.path) {
    const image = images.find((i) => i.path === tab.path);
    if (!image) return null;
    return { kind: "image" as const, relPath: image.rel_path, pinned: true };
  }
  if (tab.kind === "database") {
    return { kind: "database" as const, folder: tab.folder ?? null, pinned: tab.pinned };
  }
  if (tab.kind === "tasks") {
    return { kind: "tasks" as const, pinned: true };
  }
  return null;
}

export function editorTabKey(
  tab: EditorTab,
  notes: ReturnType<typeof useNotesStore.getState>["notes"],
  images: ReturnType<typeof useNotesStore.getState>["images"],
): string | null {
  if (tab.kind === "note" && tab.path) {
    const rel = notes.find((n) => n.path === tab.path)?.rel_path;
    return rel ? `note:${rel}` : null;
  }
  if (tab.kind === "image" && tab.path) {
    const rel = images.find((i) => i.path === tab.path)?.rel_path;
    return rel ? `img:${rel}` : null;
  }
  if (tab.kind === "database") return `db:${tab.folder ?? ""}`;
  if (tab.kind === "tasks") return "tasks:";
  return null;
}

export function captureWorkspace(): VaultWorkspace {
  const notes = useNotesStore.getState().notes;
  const images = useNotesStore.getState().images;
  const tabsState = useTabsStore.getState();
  const ui = useUiStore.getState();

  const tabs = tabsState.tabs
    .map((t) => editorTabToStored(t, notes, images))
    .filter((t): t is NonNullable<typeof t> => t !== null);

  const active = tabsState.activeTab();
  const preview = tabsState.tabs.find((t) => t.id === tabsState.previewTabId);

  const view = ui.view === "base" ? "note" : ui.view;

  return {
    version: 1,
    tabs,
    activeTabKey: active ? editorTabKey(active, notes, images) : null,
    previewTabKey: preview ? editorTabKey(preview, notes, images) : null,
    view,
    rightPanelOpen: ui.rightPanelOpen,
    sidebarOpen: ui.sidebarOpen,
    noteTasksCollapsed: ui.noteTasksCollapsed,
    noteBacklinksCollapsed: ui.noteBacklinksCollapsed,
  };
}

export function saveWorkspace(vaultPath: string, workspace: VaultWorkspace): void {
  persistWorkspace(vaultPath, workspace);
}
