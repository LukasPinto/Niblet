// Lógica de "notas diarias" estilo Obsidian/Capacities.
// Sin dependencias de UI: usa los stores vía getState().
import { readNote, createNote } from "./tauri";
import { useVaultStore } from "../stores/vaultStore";
import { useNotesStore } from "../stores/notesStore";
import { useSyncStore } from "../stores/syncStore";

/**
 * Formatea una fecha con un subconjunto simple de tokens.
 * Soporta: YYYY, MM, DD.
 */
export function formatDate(date: Date, fmt: string): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return fmt.replace("YYYY", y).replace("MM", m).replace("DD", d);
}

/** Ruta absoluta del archivo de la nota diaria para una fecha dada. */
export function dailyNotePath(
  vaultPath: string,
  folder: string,
  dateFormat: string,
  date: Date,
): string {
  const fileName = formatDate(date, dateFormat);
  return `${vaultPath.replace(/\\/g, "/")}/${folder}/${fileName}.md`;
}

/** rel_path de la nota diaria (para buscar en notesStore.notes). */
export function dailyNoteRelPath(
  folder: string,
  dateFormat: string,
  date: Date,
): string {
  const fileName = formatDate(date, dateFormat);
  return `${folder}/${fileName}.md`;
}

/** Indica si un rel_path pertenece a la carpeta de notas diarias. */
export function isDailyNoteRel(relPath: string, dailyNotesFolder: string): boolean {
  const folder = dailyNotesFolder.trim().replace(/\\/g, "/");
  if (!folder) return false;
  const norm = relPath.replace(/\\/g, "/");
  const lower = norm.toLowerCase();
  const folderLower = folder.toLowerCase();
  return lower === `${folderLower}.md` || lower.startsWith(`${folderLower}/`);
}

/** Compara rel_paths sin importar separadores o mayúsculas. */
export function sameRelPath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

/** Plantilla por defecto de una nota diaria nueva. */
function defaultDailyTemplate(date: Date, dateFormat: string): string {
  const iso = formatDate(date, dateFormat);
  return `---\nfecha: ${iso}\ntags: [daily]\nanimo: \n---\n# ${iso}\n\n`;
}

/**
 * Abre la nota diaria de la fecha indicada (hoy por defecto).
 * Si no existe, la crea con plantilla y refresca el árbol de notas.
 */
export async function openDailyNote(date: Date = new Date()): Promise<void> {
  const { vaultPath, config } = useVaultStore.getState();
  const { openNote, refreshNotes } = useNotesStore.getState();
  if (!vaultPath) return;

  const { dailyNotesFolder, dailyNotesDateFormat } = config;
  const absPath = dailyNotePath(
    vaultPath,
    dailyNotesFolder,
    dailyNotesDateFormat,
    date,
  );

  // readNote lanza si el archivo no existe; ese es nuestro detector de "crear".
  try {
    await readNote(absPath);
  } catch {
    const template = defaultDailyTemplate(date, dailyNotesDateFormat);
    await createNote(absPath, template);
    await refreshNotes();
    useSyncStore.getState().scheduleSyncOnSave();
  }

  await openNote(absPath);
}
