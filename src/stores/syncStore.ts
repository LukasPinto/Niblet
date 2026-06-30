import { create } from "zustand";
import { getAccount, syncAll, type SyncResult } from "../lib/onedrive";
import { useVaultStore } from "./vaultStore";
import { useNotesStore } from "./notesStore";
import { useTasksStore } from "./tasksStore";

export type SyncStatus = "idle" | "syncing" | "error";

interface SyncState {
  status: SyncStatus;
  error: string | null;
  lastResult: SyncResult | null;
  runSync: () => Promise<void>;
  scheduleSyncOnSave: () => void;
}

let saveDebounceTimer: number | undefined;
let pendingAfterSync = false;

async function refreshVaultData() {
  await useNotesStore.getState().refreshNotes();
  await useTasksStore.getState().refreshTasks();
  await useTasksStore.getState().refreshConflicts();
}

function canSync(): { vaultPath: string; remoteFolder: string } | null {
  const vaultPath = useVaultStore.getState().vaultPath;
  const od = useVaultStore.getState().config.onedrive;
  if (!vaultPath || !od?.remoteFolder?.trim()) return null;
  return { vaultPath, remoteFolder: od.remoteFolder.trim() };
}

export const useSyncStore = create<SyncState>((set, get) => ({
  status: "idle",
  error: null,
  lastResult: null,

  runSync: async () => {
    if (get().status === "syncing") {
      pendingAfterSync = true;
      return;
    }

    const target = canSync();
    if (!target) return;

    const account = await getAccount();
    if (!account) return;

    set({ status: "syncing", error: null });
    try {
      const result = await syncAll(target.vaultPath, target.remoteFolder);
      const od = useVaultStore.getState().config.onedrive;
      if (od) {
        await useVaultStore.getState().updateConfig({
          onedrive: { ...od, lastSync: new Date().toISOString() },
        });
      }
      await refreshVaultData();
      set({ status: "idle", lastResult: result, error: null });
    } catch (e) {
      set({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      if (pendingAfterSync) {
        pendingAfterSync = false;
        void get().runSync();
      }
    }
  },

  scheduleSyncOnSave: () => {
    const od = useVaultStore.getState().config.onedrive;
    if (!od?.syncOnSave) return;
    window.clearTimeout(saveDebounceTimer);
    const delay = od.syncOnSaveDelayMs ?? 3000;
    saveDebounceTimer = window.setTimeout(() => {
      void get().runSync();
    }, delay);
  },
}));

export function resetSaveSyncTimer() {
  window.clearTimeout(saveDebounceTimer);
  pendingAfterSync = false;
}
