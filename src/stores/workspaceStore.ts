import { captureWorkspace, saveWorkspace } from "../lib/workspacePersist";
import { loadWorkspace } from "../lib/workspaceState";
import { useTabsStore } from "./tabsStore";
import { useUiStore } from "./uiStore";
import { useVaultStore } from "./vaultStore";

let saveTimer: number | undefined;
let sessionVault: string | null = null;
let restoreAttempted = false;

export function resetWorkspaceSession(): void {
  sessionVault = null;
  restoreAttempted = false;
}

export function onVaultSessionStart(vault: string): void {
  sessionVault = vault;
  restoreAttempted = false;
}

export function scheduleWorkspaceSave(): void {
  const vault = useVaultStore.getState().vaultPath;
  if (!vault) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const vaultNow = useVaultStore.getState().vaultPath;
    if (!vaultNow) return;
    saveWorkspace(vaultNow, captureWorkspace());
  }, 400);
}

export function flushWorkspaceSave(): void {
  const vault = useVaultStore.getState().vaultPath;
  if (!vault) return;
  window.clearTimeout(saveTimer);
  saveWorkspace(vault, captureWorkspace());
}

export async function tryRestoreWorkspace(vault: string): Promise<boolean> {
  if (sessionVault !== vault) onVaultSessionStart(vault);
  if (restoreAttempted) return false;
  restoreAttempted = true;

  const ws = loadWorkspace(vault);
  if (!ws?.tabs.length) return false;

  return useTabsStore.getState().restoreFromWorkspace(ws);
}

export function initWorkspacePersistence(): void {
  useTabsStore.subscribe((state, prev) => {
    if (
      state.tabs !== prev.tabs ||
      state.activeTabId !== prev.activeTabId ||
      state.previewTabId !== prev.previewTabId
    ) {
      scheduleWorkspaceSave();
    }
  });

  useUiStore.subscribe((state, prev) => {
    if (
      state.view !== prev.view ||
      state.rightPanelOpen !== prev.rightPanelOpen ||
      state.sidebarOpen !== prev.sidebarOpen ||
      state.noteTasksCollapsed !== prev.noteTasksCollapsed ||
      state.noteBacklinksCollapsed !== prev.noteBacklinksCollapsed
    ) {
      scheduleWorkspaceSave();
    }
  });
}
