import type { ImageEntry, NoteEntry } from "./tauri";
import { ancestorFolderPaths } from "./folderTree";

export type BreadcrumbTarget =
  | { type: "vault" }
  | { type: "folder"; folder: string }
  | { type: "note"; relPath: string }
  | { type: "database"; folder: string | null }
  | { type: "image"; relPath: string };

export interface BreadcrumbSegment {
  label: string;
  /** null = segmento actual (no navegable). */
  target: BreadcrumbTarget | null;
}

function findNoteByRel(notes: NoteEntry[], relPath: string): NoteEntry | undefined {
  const norm = relPath.toLowerCase();
  return notes.find((n) => n.rel_path.toLowerCase() === norm);
}

function targetForPrefix(
  prefixParts: string[],
  notes: NoteEntry[],
): BreadcrumbTarget {
  const prefixPath = prefixParts.join("/");
  const note = findNoteByRel(notes, `${prefixPath}.md`);
  if (note) return { type: "note", relPath: note.rel_path };
  return { type: "folder", folder: prefixPath };
}

/** Migas para una nota activa (`Hacking/Apuntes Electivo/Nota.md`). */
export function breadcrumbsForNote(
  relPath: string,
  notes: NoteEntry[],
): BreadcrumbSegment[] {
  const stem = relPath.replace(/\.md$/i, "");
  const parts = stem.split("/").filter(Boolean);
  if (parts.length === 0) {
    return [{ label: "Sin título", target: null }];
  }

  const segments: BreadcrumbSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    const label = parts[i];
    if (i === parts.length - 1) {
      segments.push({ label, target: null });
    } else {
      segments.push({
        label,
        target: targetForPrefix(parts.slice(0, i + 1), notes),
      });
    }
  }
  return segments;
}

/** Migas para pestaña de base de datos. */
export function breadcrumbsForDatabase(
  folder: string | null,
  notes: NoteEntry[],
): BreadcrumbSegment[] {
  if (!folder) {
    return [
      { label: "Niblet", target: { type: "vault" } },
      { label: "Base de datos", target: null },
    ];
  }

  const parts = folder.split("/").filter(Boolean);
  const segments: BreadcrumbSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    const label = parts[i];
    const isLast = i === parts.length - 1;
    if (isLast) {
      segments.push({ label, target: null });
    } else {
      segments.push({
        label,
        target: targetForPrefix(parts.slice(0, i + 1), notes),
      });
    }
  }
  return segments;
}

/** Migas para imagen activa. */
export function breadcrumbsForImage(
  relPath: string,
  notes: NoteEntry[],
): BreadcrumbSegment[] {
  const parts = relPath.split("/").filter(Boolean);
  if (parts.length === 0) {
    return [{ label: relPath, target: null }];
  }

  const fileName = parts[parts.length - 1];
  const folderParts = parts.slice(0, -1);
  const segments: BreadcrumbSegment[] = [];

  for (let i = 0; i < folderParts.length; i++) {
    segments.push({
      label: folderParts[i],
      target: targetForPrefix(folderParts.slice(0, i + 1), notes),
    });
  }

  segments.push({ label: fileName, target: null });
  return segments;
}

export const SIDEBAR_REVEAL_EVENT = "niblet-reveal-folders";

export function requestSidebarReveal(folderPath: string): void {
  const paths = folderPath ? ancestorFolderPaths(folderPath) : [];
  window.dispatchEvent(
    new CustomEvent(SIDEBAR_REVEAL_EVENT, { detail: paths as string[] }),
  );
}

export async function navigateBreadcrumbTarget(
  target: BreadcrumbTarget,
  actions: {
    setView: (view: "note") => void;
    openByRelPath: (rel: string) => Promise<void>;
    openDatabaseTab: (folder: string | null, pinned?: boolean) => Promise<void>;
    openImageTab: (path: string) => Promise<void>;
    notes: NoteEntry[];
    images: ImageEntry[];
  },
): Promise<void> {
  actions.setView("note");

  switch (target.type) {
    case "note": {
      await actions.openByRelPath(target.relPath);
      const entry = actions.notes.find((n) => n.rel_path === target.relPath);
      if (entry?.folder) requestSidebarReveal(entry.folder);
      break;
    }
    case "folder":
      await actions.openDatabaseTab(target.folder, true);
      requestSidebarReveal(target.folder);
      break;
    case "database":
      await actions.openDatabaseTab(target.folder, true);
      if (target.folder) requestSidebarReveal(target.folder);
      break;
    case "vault":
      await actions.openDatabaseTab(null, true);
      break;
    case "image": {
      const image = actions.images.find((i) => i.rel_path === target.relPath);
      if (image) {
        await actions.openImageTab(image.path);
        if (image.folder) requestSidebarReveal(image.folder);
      }
      break;
    }
  }
}
