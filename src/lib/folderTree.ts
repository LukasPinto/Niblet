import type { ImageEntry, NoteEntry } from "./tauri";
import { isVaultMetaPath } from "./vaultPaths";

export interface FolderTreeNode {
  name: string;
  /** Ruta relativa de la carpeta: "" en raíz, "Universidad/Semestre 1" anidado. */
  path: string;
  folders: FolderTreeNode[];
  notes: NoteEntry[];
  images: ImageEntry[];
}

function sortNotes(notes: NoteEntry[]): NoteEntry[] {
  return [...notes].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function sortFolders(folders: FolderTreeNode[]): FolderTreeNode[] {
  return [...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function sortImages(images: ImageEntry[]): ImageEntry[] {
  return [...images].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function getOrCreateFolder(parent: FolderTreeNode, name: string, path: string): FolderTreeNode {
  let child = parent.folders.find((f) => f.name === name);
  if (!child) {
    child = { name, path, folders: [], notes: [], images: [] };
    parent.folders.push(child);
  }
  return child;
}

/** Desciende por las carpetas indicadas, creándolas si no existen. */
function descend(root: FolderTreeNode, folder: string): FolderTreeNode {
  const segments = folder.split("/").filter(Boolean);
  let current = root;
  let path = "";
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment;
    current = getOrCreateFolder(current, segment, path);
  }
  return current;
}

/** Construye el árbol de carpetas, notas e imágenes a partir del vault. */
export function buildFolderTree(
  notes: NoteEntry[],
  folderPaths: string[] = [],
  images: ImageEntry[] = [],
): FolderTreeNode {
  const root: FolderTreeNode = { name: "", path: "", folders: [], notes: [], images: [] };

  for (const note of notes) {
    if (isVaultMetaPath(note.rel_path)) continue;
    if (!note.folder) {
      root.notes.push(note);
      continue;
    }
    descend(root, note.folder).notes.push(note);
  }

  for (const image of images) {
    if (isVaultMetaPath(image.rel_path)) continue;
    if (!image.folder) {
      root.images.push(image);
      continue;
    }
    descend(root, image.folder).images.push(image);
  }

  for (const folderPath of folderPaths) {
    if (!folderPath || isVaultMetaPath(folderPath)) continue;
    descend(root, folderPath);
  }

  sortTree(root);
  return root;
}

function sortTree(node: FolderTreeNode): void {
  node.notes = sortNotes(node.notes);
  node.images = sortImages(node.images);
  node.folders = sortFolders(node.folders);
  for (const child of node.folders) sortTree(child);
}

/** Devuelve los paths de carpeta ancestros de una nota (para auto-expandir). */
export function ancestorFolderPaths(noteFolder: string): string[] {
  if (!noteFolder) return [];
  const segments = noteFolder.split("/").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    paths.push(segments.slice(0, i + 1).join("/"));
  }
  return paths;
}

const EXPANDED_KEY_PREFIX = "niblet-tree-expanded-";

export function loadExpandedPaths(vaultPath: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${EXPANDED_KEY_PREFIX}${vaultPath}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveExpandedPaths(vaultPath: string, expanded: Set<string>): void {
  try {
    localStorage.setItem(`${EXPANDED_KEY_PREFIX}${vaultPath}`, JSON.stringify([...expanded]));
  } catch {
    /* localStorage puede no estar disponible */
  }
}
