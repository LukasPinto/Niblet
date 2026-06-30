// Wrappers tipados sobre los comandos Rust expuestos por Tauri.
// Los nombres de campo usan snake_case para coincidir con serde en Rust.
import { invoke } from "@tauri-apps/api/core";

export interface NoteEntry {
  path: string;
  rel_path: string;
  name: string;
  folder: string;
  modified: number;
}

export interface ImageEntry {
  path: string;
  rel_path: string;
  name: string;
  folder: string;
  modified: number;
}

export interface Task {
  text: string;
  done: boolean;
  status: "todo" | "doing" | "done";
  due_date: string | null;
  scheduled: string | null;
  priority: string | null;
  high_priority: boolean;
  source_path: string;
  rel_path: string;
  source_line: number;
  /** Nivel de indentación (0 = raíz). 2 espacios = 1 nivel. */
  indent_level: number;
}

export interface ConflictEntry {
  rel_path: string;
  path: string;
  saved_hash: string;
  disk_hash: string;
  disk_modified: number;
}

/** Normaliza separadores de Windows a "/" para que las rutas absolutas
 *  coincidan con las que construye el frontend (`${vault}/${rel}`). */
export const normalizePath = (p: string) => p.replace(/\\/g, "/");

/* ---------- vault ---------- */
export const listNotes = (vaultPath: string) =>
  invoke<NoteEntry[]>("list_notes", { vaultPath }).then((notes) =>
    notes.map((n) => ({ ...n, path: normalizePath(n.path) })),
  );

export const readNote = (path: string) => invoke<string>("read_note", { path });

export const writeNote = (path: string, content: string) =>
  invoke<void>("write_note", { path, content });

export const createNote = (path: string, template: string) =>
  invoke<void>("create_note", { path, template });

export const deleteNote = (path: string) => invoke<void>("delete_note", { path });

export const deleteFolder = (vaultPath: string, relFolder: string) =>
  invoke<void>("delete_folder", { vaultPath, relFolder });

export const deleteFile = (path: string) => invoke<void>("delete_file", { path });

export const listFolders = (vaultPath: string) =>
  invoke<string[]>("list_folders", { vaultPath });

export const createFolder = (vaultPath: string, relFolder: string) =>
  invoke<void>("create_folder", { vaultPath, relFolder });

/* ---------- images ---------- */
export const listImages = (vaultPath: string) =>
  invoke<ImageEntry[]>("list_images", { vaultPath }).then((images) =>
    images.map((i) => ({ ...i, path: normalizePath(i.path) })),
  );

export const saveImage = (vaultPath: string, filename: string, data: number[]) =>
  invoke<string>("save_image", { vaultPath, filename, data });

export const savePastedImage = (vaultPath: string, ext: string, data: number[]) =>
  invoke<string>("save_pasted_image", { vaultPath, ext, data });

export const saveClipboardImage = (vaultPath: string) =>
  invoke<string>("save_clipboard_image", { vaultPath });

export const moveFile = (fromPath: string, toPath: string) =>
  invoke<void>("move_file", { fromPath, toPath });

export const moveFolder = (vaultPath: string, oldRel: string, newRel: string) =>
  invoke<void>("move_folder", { vaultPath, oldRel, newRel });

export const updateImageLinks = (
  vaultPath: string,
  oldRelPath: string,
  newRelPath: string,
) => invoke<void>("update_image_links", { vaultPath, oldRelPath, newRelPath });

export const readImageBase64 = (path: string) =>
  invoke<string>("read_image_base64", { path });

export const readFileBytes = (path: string) =>
  invoke<number[]>("read_file_bytes", { path });

export const writeFileBytes = (path: string, data: number[]) =>
  invoke<void>("write_file_bytes", { path, data });

/* ---------- tasks ---------- */
export const scanAllTasks = (vaultPath: string) =>
  invoke<Task[]>("scan_all_tasks", { vaultPath }).then((tasks) =>
    tasks.map((t) => ({ ...t, source_path: normalizePath(t.source_path) })),
  );

export const toggleTask = (filePath: string, line: number, done: boolean) =>
  invoke<void>("toggle_task", { filePath, line, done });

export const setTaskStatus = (
  filePath: string,
  line: number,
  status: Task["status"],
) => invoke<void>("set_task_status", { filePath, line, status });

export const setTaskDueDate = (
  filePath: string,
  line: number,
  dueDate: string | null,
) => invoke<void>("set_task_due_date", { filePath, line, dueDate });

export const setTaskPriority = (
  filePath: string,
  line: number,
  priority: string | null,
) => invoke<void>("set_task_priority", { filePath, line, priority });

/* ---------- sync ---------- */
export const hashFile = (path: string) => invoke<string>("hash_file", { path });

export const recordSave = (vaultPath: string, relPath: string, content: string) =>
  invoke<void>("record_save", { vaultPath, relPath, content });

export const recordFileSave = (vaultPath: string, relPath: string) =>
  invoke<void>("record_file_save", { vaultPath, relPath });

export const readSnapshot = (vaultPath: string, relPath: string) =>
  invoke<string>("read_snapshot", { vaultPath, relPath });

export const recordMovedNote = (
  vaultPath: string,
  oldRel: string,
  newRel: string,
) => invoke<void>("record_moved_note", { vaultPath, oldRel, newRel });

export const detectConflicts = (vaultPath: string) =>
  invoke<ConflictEntry[]>("detect_conflicts", { vaultPath }).then((conflicts) =>
    conflicts.map((c) => ({ ...c, path: normalizePath(c.path) })),
  );

export const watchVault = (vaultPath: string) =>
  invoke<void>("watch_vault", { vaultPath });

export const createDirectory = (path: string) =>
  invoke<void>("create_directory", { path });

export const setTitlebarTheme = (dark: boolean) =>
  invoke<void>("set_titlebar_theme", { dark });
