import { create } from "zustand";
import { readNote, writeNote } from "../lib/tauri";
import { useSyncStore } from "./syncStore";
import {
  DB_VIEWS_REL,
  defaultViewConfig,
  mergeViewConfig,
  type DatabaseViewConfig,
  type DatabaseViewsFile,
} from "../lib/database/viewConfig";
import { viewKey } from "../lib/database/types";

interface DatabaseViewState {
  loaded: boolean;
  views: Record<string, DatabaseViewConfig>;
  load: (vaultPath: string) => Promise<void>;
  reset: () => void;
  getView: (folder: string | null) => DatabaseViewConfig;
  updateView: (
    vaultPath: string | null,
    folder: string | null,
    patch: Partial<DatabaseViewConfig>,
  ) => Promise<void>;
}

async function readViewsFile(vaultPath: string): Promise<DatabaseViewsFile> {
  try {
    const raw = await readNote(`${vaultPath}/${DB_VIEWS_REL}`);
    const parsed = JSON.parse(raw) as Partial<DatabaseViewsFile>;
    const views: Record<string, DatabaseViewConfig> = {};
    if (parsed.views) {
      for (const [k, v] of Object.entries(parsed.views)) {
        views[k] = mergeViewConfig(v);
      }
    }
    return { views };
  } catch {
    return { views: {} };
  }
}

async function writeViewsFile(
  vaultPath: string,
  data: DatabaseViewsFile,
): Promise<void> {
  await writeNote(
    `${vaultPath}/${DB_VIEWS_REL}`,
    JSON.stringify(data, null, 2),
  );
}

export const useDatabaseViewStore = create<DatabaseViewState>((set, get) => {
  const stableDefault = defaultViewConfig();

  return {
  loaded: false,
  views: {},

  load: async (vaultPath) => {
    const file = await readViewsFile(vaultPath);
    set({ views: file.views, loaded: true });
  },

  reset: () => set({ loaded: false, views: {} }),

  getView: (folder) => {
    const key = viewKey(folder);
    return get().views[key] ?? stableDefault;
  },

  updateView: async (vaultPath, folder, patch) => {
    const key = viewKey(folder);
    const current = get().getView(folder);
    const next = { ...current, ...patch };
    set({ views: { ...get().views, [key]: next } });
    if (!vaultPath) return;
    await writeViewsFile(vaultPath, { views: { ...get().views, [key]: next } });
    useSyncStore.getState().scheduleSyncOnSave();
  },
};
});
