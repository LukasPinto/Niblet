// Genera diffs entre dos versiones de una nota para el modal de conflictos.
import { diffLines, createTwoFilesPatch } from "diff";

export interface DiffSegment {
  value: string;
  added: boolean;
  removed: boolean;
}

/** Diff por líneas: usado para colorear las dos columnas del modal. */
export function lineDiff(mine: string, theirs: string): DiffSegment[] {
  return diffLines(mine, theirs).map((part) => ({
    value: part.value,
    added: !!part.added,
    removed: !!part.removed,
  }));
}

/** Solo las líneas presentes en `mine` (las quitadas se marcan como rem). */
export function ownSide(mine: string, theirs: string): DiffSegment[] {
  return lineDiff(mine, theirs).filter((s) => !s.added);
}

/** Solo las líneas presentes en `theirs` (las añadidas se marcan como add). */
export function theirSide(mine: string, theirs: string): DiffSegment[] {
  return lineDiff(mine, theirs).filter((s) => !s.removed);
}

/**
 * Fusión automática sencilla: parte de `mine` y añade al final las líneas
 * que solo existen en `theirs`. Suficiente para el caso típico de tareas
 * añadidas en dos dispositivos distintos.
 */
export function autoMerge(mine: string, theirs: string): string {
  const mineLines = new Set(mine.split(/\r?\n/));
  const extra = theirs
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !mineLines.has(l));
  if (extra.length === 0) return mine;
  const base = mine.replace(/\s*$/, "");
  return `${base}\n${extra.join("\n")}\n`;
}

/** Patch unificado en texto plano (por si se quiere mostrar/exportar). */
export function unifiedPatch(
  relPath: string,
  mine: string,
  theirs: string,
): string {
  return createTwoFilesPatch(
    `${relPath} (mío)`,
    `${relPath} (OneDrive)`,
    mine,
    theirs,
  );
}
