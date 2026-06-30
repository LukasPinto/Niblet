import { create } from "zustand";
import {
  scanAllTasks,
  toggleTask,
  setTaskStatus,
  setTaskDueDate,
  setTaskPriority,
  detectConflicts,
  type Task,
  type ConflictEntry,
} from "../lib/tauri";
import { useVaultStore } from "./vaultStore";
import { useTabsStore } from "./tabsStore";
import { useSyncStore } from "./syncStore";

interface TasksState {
  tasks: Task[];
  conflicts: ConflictEntry[];
  refreshTasks: () => Promise<void>;
  refreshConflicts: () => Promise<void>;
  toggle: (task: Task) => Promise<void>;
  moveTo: (task: Task, status: Task["status"]) => Promise<void>;
  setDueDate: (task: Task, date: string | null) => Promise<void>;
  setPriority: (task: Task, priority: string | null) => Promise<void>;
  tasksForNote: (relPath: string) => Task[];
}

async function reloadSourceNote(path: string) {
  await useTabsStore.getState().reloadTabFromDisk(path);
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  conflicts: [],

  refreshTasks: async () => {
    const vault = useVaultStore.getState().vaultPath;
    if (!vault) return;
    const tasks = await scanAllTasks(vault);
    set({ tasks });
  },

  refreshConflicts: async () => {
    const vault = useVaultStore.getState().vaultPath;
    if (!vault) return;
    try {
      const conflicts = await detectConflicts(vault);
      set({ conflicts });
    } catch {
      set({ conflicts: [] });
    }
  },

  toggle: async (task) => {
    await toggleTask(task.source_path, task.source_line, !task.done);
    await get().refreshTasks();
    await reloadSourceNote(task.source_path);
    useSyncStore.getState().scheduleSyncOnSave();
  },

  moveTo: async (task, status) => {
    await setTaskStatus(task.source_path, task.source_line, status);
    await get().refreshTasks();
    await reloadSourceNote(task.source_path);
    useSyncStore.getState().scheduleSyncOnSave();
  },

  setDueDate: async (task, date) => {
    await setTaskDueDate(task.source_path, task.source_line, date);
    await get().refreshTasks();
    await reloadSourceNote(task.source_path);
    useSyncStore.getState().scheduleSyncOnSave();
  },

  setPriority: async (task, priority) => {
    await setTaskPriority(task.source_path, task.source_line, priority);
    await get().refreshTasks();
    await reloadSourceNote(task.source_path);
    useSyncStore.getState().scheduleSyncOnSave();
  },

  tasksForNote: (relPath) =>
    get().tasks.filter((t) => t.rel_path === relPath),
}));
