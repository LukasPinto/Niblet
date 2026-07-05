import type { Frontmatter } from "../markdown";

export interface DatabaseRow {
  path: string;
  rel_path: string;
  name: string;
  folder: string;
  raw: string;
  data: Frontmatter;
}

export const NOTE_COLUMN = "__note__";
export const TASKS_COLUMN = "__tasks__";
export const DRAG_COLUMN = "__drag__";
export const CHECK_COLUMN = "__check__";

export const DRAG_COL_WIDTH = 28;
export const CHECK_COL_WIDTH = 36;

export const DEFAULT_COL_WIDTH = 280;
export const NOTE_COL_WIDTH = 240;
export const TASKS_COL_WIDTH = 88;

export const KNOWN_ORDER = ["fecha", "tags", "animo"];
export const COL_LABEL: Record<string, string> = {
  fecha: "Fecha",
  tags: "Tags",
  animo: "Ánimo",
};

export function columnLabel(key: string): string {
  if (key === NOTE_COLUMN) return "Nota";
  if (key === TASKS_COLUMN) return "Tareas";
  return COL_LABEL[key] ?? key;
}

export function viewKey(folder: string | null): string {
  return folder ?? "";
}
