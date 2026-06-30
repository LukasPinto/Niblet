// Parser de tareas en el frontend para la nota ABIERTA, espejo de
// `parse_tasks_in_file` (src-tauri/src/commands/tasks.rs). El índice global del
// backend (`scanAllTasks`) solo se refresca con un escaneo completo del vault, así
// que para reflejar en vivo lo que se escribe en la nota actual parseamos su
// contenido aquí: es una sola nota (barato) y evita re-escanear todo el vault.

/** Marcadores de metadatos inline (estilo Obsidian Tasks). */
const MARKERS = ["📅", "⏳", "⏫"];
const KEY_DUE = "due-date:";
const KEY_PRIOR = "prior:";

export type NoteTaskStatus = "todo" | "doing" | "done";

export interface NoteTask {
  text: string;
  done: boolean;
  status: NoteTaskStatus;
  /** Índice de línea dentro del archivo completo (0-based), como en el backend. */
  sourceLine: number;
  /** Nivel de indentación (0 = raíz). 2 espacios = 1 nivel. */
  indentLevel: number;
}

/** Primer índice donde empieza un bloque de metadatos, para recortar el texto. */
function firstMetaIndex(rest: string): number {
  let cut = rest.length;
  for (const m of MARKERS) {
    const p = rest.indexOf(m);
    if (p !== -1 && p < cut) cut = p;
  }
  const pd = rest.indexOf(KEY_DUE);
  if (pd !== -1 && pd < cut) cut = pd;
  const pp = rest.indexOf(KEY_PRIOR);
  if (pp !== -1 && pp < cut) cut = pp;
  return cut;
}

/** Cuenta indentación: espacio = 1, tab = 2; nivel = pares de espacios. */
function indentLevelFromLine(line: string): number {
  const trimmed = line.trimStart();
  const leading = line.length - trimmed.length;
  let spaces = 0;
  for (let i = 0; i < leading; i++) {
    const ch = line[i];
    if (ch === " ") spaces += 1;
    else if (ch === "\t") spaces += 2;
  }
  return Math.floor(spaces / 2);
}

function parseCheckbox(
  trimmed: string,
): { status: NoteTaskStatus; done: boolean; rest: string } | null {
  if (trimmed.startsWith("- [ ]"))
    return { status: "todo", done: false, rest: trimmed.slice(5) };
  if (trimmed.startsWith("- [x]") || trimmed.startsWith("- [X]"))
    return { status: "done", done: true, rest: trimmed.slice(5) };
  if (trimmed.startsWith("- [/]"))
    return { status: "doing", done: false, rest: trimmed.slice(5) };
  return null;
}

/** Extrae las tareas del contenido completo de una nota (con frontmatter). */
export function parseNoteTasks(content: string): NoteTask[] {
  const tasks: NoteTask[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cb = parseCheckbox(line.trimStart());
    if (!cb) continue;
    const cut = firstMetaIndex(cb.rest);
    tasks.push({
      text: cb.rest.slice(0, cut).trim(),
      done: cb.done,
      status: cb.status,
      sourceLine: i,
      indentLevel: indentLevelFromLine(line),
    });
  }
  return tasks;
}
