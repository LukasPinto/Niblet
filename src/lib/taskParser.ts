// Utilidades de presentación sobre las tareas que devuelve Rust.
import type { CSSProperties } from "react";
import type { Task } from "./tauri";

export type DueBucket = "late" | "today" | "soon" | "none";

export interface TaskGroup {
  bucket: DueBucket;
  label: string;
  tasks: Task[];
}

const MONTHS_ES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** Convierte Date a YYYY-MM-DD. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Intenta interpretar el texto de fecha (YYYY-MM-DD, "hoy", "mañana"). */
export function parseDue(due: string | null): Date | null {
  if (!due) return null;
  const t = due.trim().toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (t === "hoy") return today;
  if (t === "mañana" || t === "manana") {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  return null;
}

/** Texto legible para pills: "29 jun 2026" o "hoy". */
export function formatDueDisplay(due: string | null): string | null {
  if (!due) return null;
  const d = parseDue(due);
  if (!d) return due;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d.getTime() === today.getTime()) return "hoy";
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`;
}

export function dueBucket(task: Task): DueBucket {
  const d = parseDue(task.due_date);
  if (!d) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0) return "late";
  if (diff === 0) return "today";
  return "soon";
}

/** Etiqueta corta para la pill de fecha (incluye emoji). */
export function dueLabel(task: Task): string | null {
  if (task.scheduled && !task.due_date) return `⏳ ${task.scheduled}`;
  const text = formatDueDisplay(task.due_date);
  if (!text) return null;
  return `📅 ${text}`;
}

export function duePillClass(task: Task): string {
  switch (dueBucket(task)) {
    case "late":
      return "due-late";
    case "today":
    case "soon":
      return "due-soon";
    default:
      return "";
  }
}

export interface PriorityInfo {
  label: string;
  className: string;
  value: string;
}

/** Etiqueta y clase CSS para la pill de prioridad. */
export function priorityLabel(task: Task): PriorityInfo | null {
  const raw = task.priority ?? (task.high_priority ? "high" : null);
  if (!raw) return null;
  const p = raw.toLowerCase();
  switch (p) {
    case "high":
      return { label: "Alta", className: "prio-high", value: "high" };
    case "medium":
      return { label: "Media", className: "prio-medium", value: "medium" };
    case "low":
      return { label: "Baja", className: "prio-low", value: "low" };
    default:
      return { label: raw, className: "prio-custom", value: raw };
  }
}

const BUCKET_META: Record<DueBucket, { label: string; order: number }> = {
  late: { label: "Atrasadas", order: 0 },
  today: { label: "Hoy", order: 1 },
  soon: { label: "Próximas", order: 2 },
  none: { label: "Sin fecha", order: 3 },
};

/** Agrupa tareas pendientes por vencimiento (las hechas van al final de "none"). */
export function groupByDue(tasks: Task[]): TaskGroup[] {
  const groups: Record<DueBucket, Task[]> = {
    late: [],
    today: [],
    soon: [],
    none: [],
  };
  for (const t of tasks) {
    groups[dueBucket(t)].push(t);
  }
  return (Object.keys(groups) as DueBucket[])
    .filter((b) => groups[b].length > 0)
    .sort((a, b) => BUCKET_META[a].order - BUCKET_META[b].order)
    .map((bucket) => ({
      bucket,
      label: BUCKET_META[bucket].label,
      tasks: groups[bucket],
    }));
}

/** Nombre de la nota de origen a partir de su ruta relativa. */
export function sourceLabel(relPath: string): string {
  const parts = relPath.replace(/\.md$/, "").split("/");
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join("/")} / ${parts[parts.length - 1]}`;
}

/** Offset visual para subtareas indentadas en listas, kanban y panel lateral. */
export function taskIndentStyle(level: number): CSSProperties {
  return level > 0 ? { paddingLeft: level * 16 } : {};
}

/** Nodo de árbol: una tarea con sus subtareas anidadas. */
export interface TaskNode {
  task: Task;
  children: TaskNode[];
}

/**
 * Construye el árbol de tareas a partir de la lista plana usando `indent_level`.
 * El emparejado es por nota (source_path) y orden de línea: una subtarea cuelga
 * de la tarea anterior con menor indentación dentro de la misma nota.
 */
export function buildTaskTree(tasks: Task[]): TaskNode[] {
  const byFile = new Map<string, Task[]>();
  for (const t of tasks) {
    const arr = byFile.get(t.source_path);
    if (arr) arr.push(t);
    else byFile.set(t.source_path, [t]);
  }

  const roots: TaskNode[] = [];
  for (const fileTasks of byFile.values()) {
    const ordered = [...fileTasks].sort((a, b) => a.source_line - b.source_line);
    const stack: TaskNode[] = [];
    for (const task of ordered) {
      const node: TaskNode = { task, children: [] };
      while (
        stack.length > 0 &&
        stack[stack.length - 1].task.indent_level >= task.indent_level
      ) {
        stack.pop();
      }
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
  }
  return roots;
}

/** Cuenta una tarea por cada nodo del subárbol (raíz + descendientes). */
export function countNodes(nodes: TaskNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

/** Cuenta cuántos nodos del subárbol (raíz + descendientes) están marcados como done. */
export function countDoneNodes(nodes: TaskNode[]): number {
  return nodes.reduce(
    (sum, n) => sum + (n.task.done ? 1 : 0) + countDoneNodes(n.children),
    0,
  );
}

export interface TaskNodeGroup {
  bucket: DueBucket;
  label: string;
  nodes: TaskNode[];
}

/** Igual que groupByDue pero sobre nodos raíz (se agrupa por la tarea principal). */
export function groupNodesByDue(nodes: TaskNode[]): TaskNodeGroup[] {
  const groups: Record<DueBucket, TaskNode[]> = {
    late: [],
    today: [],
    soon: [],
    none: [],
  };
  for (const n of nodes) groups[dueBucket(n.task)].push(n);
  return (Object.keys(groups) as DueBucket[])
    .filter((b) => groups[b].length > 0)
    .sort((a, b) => BUCKET_META[a].order - BUCKET_META[b].order)
    .map((bucket) => ({
      bucket,
      label: BUCKET_META[bucket].label,
      nodes: groups[bucket],
    }));
}

/** Orden documental para nodos raíz. */
export function sortNodesDocumentOrder(a: TaskNode, b: TaskNode): number {
  return sortTasksDocumentOrder(a.task, b.task);
}

/** Orden documental: misma nota → por línea de origen. */
export function sortTasksDocumentOrder(a: Task, b: Task): number {
  const pathCmp = a.rel_path.localeCompare(b.rel_path, undefined, {
    sensitivity: "base",
  });
  if (pathCmp !== 0) return pathCmp;
  return a.source_line - b.source_line;
}
