import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronRight,
  FileText,
  Folder,
  GraduationCap,
  Guitar,
  Image as ImageIcon,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  ancestorFolderPaths,
  buildFolderTree,
  loadExpandedPaths,
  saveExpandedPaths,
  type FolderTreeNode,
} from "../../lib/folderTree";
import { SIDEBAR_REVEAL_EVENT } from "../../lib/breadcrumbs";
import { dailyNoteRelPath, isDailyNoteRel, sameRelPath } from "../../lib/dailyNotes";
import { normalizePath } from "../../lib/tauri";
import { useNotesStore } from "../../stores/notesStore";
import { useTabsStore, noteTabId } from "../../stores/tabsStore";
import {
  activeTabHighlightEqual,
  selectActiveTabHighlight,
} from "../../stores/tabSelectors";
import { useUiStore } from "../../stores/uiStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useSyncStore } from "../../stores/syncStore";
import { useTasksStore } from "../../stores/tasksStore";
import {
  moveFile,
  moveFolder,
  updateImageLinks,
  recordMovedNote,
} from "../../lib/tauri";
import {
  syncOpenTabsAfterFolderMove,
  syncOpenTabsAfterImageMove,
} from "../../lib/patchOpenTabs";
import type { ImageEntry } from "../../lib/tauri";

const IMG_ABS = "niblet/image-abs";
const IMG_REL = "niblet/image-rel";
const NOTE_ABS = "niblet/note-abs";
const NOTE_REL = "niblet/note-rel";
const FOLDER_REL = "niblet/folder-rel";

function imageLabel(img: ImageEntry): string {
  const ext = img.rel_path.split(".").pop() ?? "";
  return ext ? `${img.name}.${ext}` : img.name;
}

/** Tamaño uniforme de los iconos del árbol (el reset global los pondría a 18px). */
const TREE_ICON = { width: 16, height: 16 } as const;

const FOLDER_ICONS: Record<string, LucideIcon> = {
  Diario: CalendarDays,
  Hacking: Terminal,
  Universidad: GraduationCap,
  Práctica: Wrench,
  Guitarra: Guitar,
};

function folderIcon(name: string, depth: number) {
  const Icon = depth === 0 ? FOLDER_ICONS[name] ?? Folder : Folder;
  return <Icon style={TREE_ICON} />;
}

interface TreeBranchProps {
  node: FolderTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  activeNotePath: string | null;
  activeImagePath: string | null;
  activeDbFolder: string | null;
  highlightDailyNotes: boolean;
  todayDailyRelPath: string;
  openDailyRelPath: string | null;
  onOpenPreview: (path: string) => void;
  onPinNote: (path: string) => void;
  onOpenImage: (path: string) => void;
  onMoveImage: (absPath: string, relPath: string, targetFolder: string) => void;
  onMoveNote: (absPath: string, relPath: string, targetFolder: string) => void;
  onMoveFolder: (oldRel: string, targetParent: string) => void;
  onOpenDatabase: (folderPath: string) => void;
  onContextMenu: (
    e: React.MouseEvent,
    folderPath: string,
    itemType?: "folder" | "note" | "image",
    itemPath?: string,
    itemName?: string,
  ) => void;
}

function TreeBranch({
  node,
  depth,
  expanded,
  onToggle,
  activeNotePath,
  activeImagePath,
  activeDbFolder,
  highlightDailyNotes,
  todayDailyRelPath,
  openDailyRelPath,
  onOpenPreview,
  onPinNote,
  onOpenImage,
  onMoveImage,
  onMoveNote,
  onMoveFolder,
  onOpenDatabase,
  onContextMenu,
}: TreeBranchProps) {
  const isExpanded = node.path === "" || expanded.has(node.path);
  const hasChildren =
    node.folders.length > 0 || node.notes.length > 0 || node.images.length > 0;
  const indent = 8 + depth * 14;
  const isDbActive = activeDbFolder === node.path;
  const [dropActive, setDropActive] = useState(false);

  const handleFolderDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (
      types.includes(IMG_ABS) ||
      types.includes(NOTE_ABS) ||
      types.includes(FOLDER_REL)
    ) {
      e.preventDefault();
      e.stopPropagation();
      setDropActive(true);
    }
  };
  const handleFolderDrop = (e: React.DragEvent) => {
    setDropActive(false);
    // Imagen
    const imgAbs = e.dataTransfer.getData(IMG_ABS);
    if (imgAbs) {
      e.preventDefault();
      e.stopPropagation();
      onMoveImage(imgAbs, e.dataTransfer.getData(IMG_REL), node.path);
      return;
    }
    // Nota
    const noteAbs = e.dataTransfer.getData(NOTE_ABS);
    if (noteAbs) {
      e.preventDefault();
      e.stopPropagation();
      onMoveNote(noteAbs, e.dataTransfer.getData(NOTE_REL), node.path);
      return;
    }
    // Carpeta
    const folderRel = e.dataTransfer.getData(FOLDER_REL);
    if (folderRel) {
      // Evitar mover una carpeta dentro de sí misma o de un descendiente.
      if (node.path === folderRel || node.path.startsWith(`${folderRel}/`)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onMoveFolder(folderRel, node.path);
    }
  };

  return (
    <>
      {node.path !== "" && (
        <div
          className={`tree-item tree-folder ${isDbActive ? "active db-active" : ""} ${
            dropActive ? "drop-target" : ""
          }`}
          style={{ paddingLeft: indent }}
          draggable
          onContextMenu={(e) => onContextMenu(e, node.path, "folder", node.path, node.name)}
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData(FOLDER_REL, node.path);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={handleFolderDragOver}
          onDragLeave={() => setDropActive(false)}
          onDrop={handleFolderDrop}
        >
          <button
            type="button"
            className="tree-chevron-btn"
            aria-label={isExpanded ? "Colapsar" : "Expandir"}
            onClick={() => onToggle(node.path)}
          >
            <span className={`tree-chevron ${isExpanded ? "open" : ""}`}>
              {hasChildren ? <ChevronRight style={{ width: 14, height: 14 }} /> : ""}
            </span>
          </button>
          <button
            type="button"
            className="tree-folder-label"
            onClick={() => onOpenDatabase(node.path)}
          >
            <span className="tree-ico">{folderIcon(node.name, depth - 1)}</span>
            <span className="tree-label">{node.name}</span>
          </button>
        </div>
      )}

      {isExpanded && (
        <>
          {node.folders.map((child) => (
            <TreeBranch
              key={child.path}
              node={child}
              depth={node.path === "" ? depth : depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              activeNotePath={activeNotePath}
              activeImagePath={activeImagePath}
              activeDbFolder={activeDbFolder}
              highlightDailyNotes={highlightDailyNotes}
              todayDailyRelPath={todayDailyRelPath}
              openDailyRelPath={openDailyRelPath}
              onOpenPreview={onOpenPreview}
              onPinNote={onPinNote}
              onOpenImage={onOpenImage}
              onMoveImage={onMoveImage}
              onMoveNote={onMoveNote}
              onMoveFolder={onMoveFolder}
              onOpenDatabase={onOpenDatabase}
              onContextMenu={onContextMenu}
            />
          ))}
          {node.notes.map((note) => {
            const isActive = activeNotePath === note.path;
            const isTodayDaily =
              highlightDailyNotes && sameRelPath(note.rel_path, todayDailyRelPath);
            const isOpenDaily =
              highlightDailyNotes &&
              !!openDailyRelPath &&
              sameRelPath(note.rel_path, openDailyRelPath);
            return (
            <button
              key={note.path}
              type="button"
              draggable
              className={[
                "tree-item",
                "tree-note",
                isActive ? "active" : "",
                isOpenDaily ? "daily-current" : "",
                isTodayDaily ? "daily-today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ paddingLeft: (node.path === "" ? depth : depth + 1) * 14 + 8 + 16 }}
              onClick={(e) => {
                if (e.detail > 1) return;
                onOpenPreview(note.path);
              }}
              onDoubleClick={() => onPinNote(note.path)}
              onDragStart={(e) => {
                e.dataTransfer.setData(NOTE_ABS, note.path);
                e.dataTransfer.setData(NOTE_REL, note.rel_path);
                e.dataTransfer.effectAllowed = "move";
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e, note.folder, "note", note.path, note.name);
              }}
            >
              <span className="tree-ico">
                {isTodayDaily || isOpenDaily ? (
                  <CalendarDays style={TREE_ICON} />
                ) : (
                  <FileText style={TREE_ICON} />
                )}
              </span>
              <span className="tree-label">
                {note.name}
                {isTodayDaily && <span className="tree-daily-badge">hoy</span>}
              </span>
            </button>
            );
          })}
          {node.images.map((img) => (
            <button
              key={img.path}
              type="button"
              draggable
              className={`tree-item tree-image ${activeImagePath === img.path ? "active" : ""}`}
              style={{ paddingLeft: (node.path === "" ? depth : depth + 1) * 14 + 8 + 16 }}
              onClick={() => onOpenImage(img.path)}
              onDragStart={(e) => {
                e.dataTransfer.setData(IMG_ABS, img.path);
                e.dataTransfer.setData(IMG_REL, img.rel_path);
                e.dataTransfer.effectAllowed = "move";
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e, img.folder, "image", img.path, imageLabel(img));
              }}
            >
              <span className="tree-ico"><ImageIcon style={TREE_ICON} /></span>
              <span className="tree-label">{imageLabel(img)}</span>
            </button>
          ))}
        </>
      )}
    </>
  );
}

export default function FolderTree() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const images = useNotesStore((s) => s.images);
  const refreshImages = useNotesStore((s) => s.refreshImages);
  const refreshNotes = useNotesStore((s) => s.refreshNotes);
  const dailyNotesFolder = useVaultStore((s) => s.config.dailyNotesFolder);
  const dailyNotesDateFormat = useVaultStore(
    (s) => s.config.dailyNotesDateFormat,
  );
  const dailyNotesAutoReveal = useVaultStore(
    (s) => s.config.dailyNotesAutoReveal,
  );
  const activeTab = useTabsStore(
    (s) => selectActiveTabHighlight(s.tabs, s.activeTabId),
    activeTabHighlightEqual,
  );
  const openPreview = useTabsStore((s) => s.openPreview);
  const pinTab = useTabsStore((s) => s.pinTab);
  const openImageTab = useTabsStore((s) => s.openImageTab);
  const closeTabByPath = useTabsStore((s) => s.closeTabByPath);
  const openDatabaseTab = useTabsStore((s) => s.openDatabaseTab);
  const openContextMenu = useUiStore((s) => s.openContextMenu);

  const activeNotePathRaw =
    activeTab?.kind === "note" ? (activeTab.path ?? null) : null;
  const activeNotePath = activeNotePathRaw ? normalizePath(activeNotePathRaw) : null;
  const activeImagePath =
    activeTab?.kind === "image" ? (activeTab.path ?? null) : null;
  const activeDbFolder =
    activeTab?.kind === "database" ? (activeTab.folder ?? null) : null;

  const todayDailyRelPath = useMemo(
    () => dailyNoteRelPath(dailyNotesFolder, dailyNotesDateFormat, new Date()),
    [dailyNotesFolder, dailyNotesDateFormat],
  );

  const openDailyRelPath = useMemo(() => {
    if (!activeNotePath) return null;
    const entry = notes.find((n) => n.path === activeNotePath);
    if (!entry || !isDailyNoteRel(entry.rel_path, dailyNotesFolder)) return null;
    return entry.rel_path;
  }, [activeNotePath, notes, dailyNotesFolder]);

  const highlightDailyNotes = openDailyRelPath !== null;

  const tree = useMemo(
    () => buildFolderTree(notes, folders, images),
    [notes, folders, images],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() =>
    vaultPath ? loadExpandedPaths(vaultPath) : new Set(),
  );

  useEffect(() => {
    if (!vaultPath) return;
    setExpanded(loadExpandedPaths(vaultPath));
  }, [vaultPath]);

  useEffect(() => {
    if (!vaultPath) return;
    const onReveal = (e: Event) => {
      const paths = (e as CustomEvent<string[]>).detail;
      if (!Array.isArray(paths) || paths.length === 0) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const p of paths) next.add(p);
        if (next.size === prev.size) return prev;
        saveExpandedPaths(vaultPath, next);
        return next;
      });
    };
    window.addEventListener(SIDEBAR_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(SIDEBAR_REVEAL_EVENT, onReveal);
  }, [vaultPath]);

  useEffect(() => {
    if (!vaultPath || !activeNotePath) return;
    const entry = notes.find((n) => n.path === activeNotePath);
    if (!entry?.folder) return;
    // No auto-revelar la carpeta de notas diarias salvo que esté activado en ajustes
    // (con el tiempo acumula muchas notas y resulta molesto).
    const isDaily = isDailyNoteRel(entry.rel_path, dailyNotesFolder);
    if (isDaily && !dailyNotesAutoReveal) return;
    const ancestors = ancestorFolderPaths(entry.folder);
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const p of ancestors) next.add(p);
      if (next.size === prev.size) return prev;
      saveExpandedPaths(vaultPath, next);
      return next;
    });
  }, [
    activeNotePath,
    notes,
    vaultPath,
    dailyNotesFolder,
    dailyNotesAutoReveal,
  ]);

  // Con una nota diaria abierta, revelar también la de hoy para que se vea el marcador.
  useEffect(() => {
    if (!vaultPath || !highlightDailyNotes) return;
    const todayEntry = notes.find((n) => sameRelPath(n.rel_path, todayDailyRelPath));
    if (!todayEntry?.folder) return;
    const ancestors = ancestorFolderPaths(todayEntry.folder);
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const p of ancestors) next.add(p);
      if (next.size === prev.size) return prev;
      saveExpandedPaths(vaultPath, next);
      return next;
    });
  }, [highlightDailyNotes, todayDailyRelPath, notes, vaultPath]);

  const onToggle = useCallback(
    (path: string) => {
      if (!vaultPath) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        saveExpandedPaths(vaultPath, next);
        return next;
      });
    },
    [vaultPath],
  );

  const onOpenPreview = useCallback(
    async (path: string) => {
      await openPreview(path);
    },
    [openPreview],
  );

  const onPinNote = useCallback(async (path: string) => {
    await pinTab(noteTabId(path));
  }, [pinTab]);

  const onOpenDatabase = useCallback(
    (folderPath: string) => {
      void openDatabaseTab(folderPath);
    },
    [openDatabaseTab],
  );

  const onContextMenu = useCallback(
    (
      e: React.MouseEvent,
      folderPath: string,
      itemType?: "folder" | "note" | "image",
      itemPath?: string,
      itemName?: string,
    ) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, folderPath, itemType, itemPath, itemName);
    },
    [openContextMenu],
  );

  const onOpenImage = useCallback(
    (path: string) => {
      void openImageTab(path);
    },
    [openImageTab],
  );

  const onMoveImage = useCallback(
    async (absPath: string, relPath: string, targetFolder: string) => {
      if (!vaultPath) return;
      const filename = relPath.split("/").pop();
      if (!filename) return;
      const currentFolder = relPath.includes("/")
        ? relPath.slice(0, relPath.lastIndexOf("/"))
        : "";
      if (currentFolder === targetFolder) return;
      const newRel = targetFolder ? `${targetFolder}/${filename}` : filename;
      const newAbs = `${vaultPath}/${newRel}`;
      try {
        await moveFile(absPath, newAbs);
        await updateImageLinks(vaultPath, relPath, newRel);
        await syncOpenTabsAfterImageMove(relPath, newRel);
        await closeTabByPath(absPath);
        await refreshImages();
        await refreshNotes();
        await useTasksStore.getState().refreshConflicts();
        useSyncStore.getState().scheduleSyncOnSave();
      } catch (err) {
        console.error("No se pudo mover la imagen", err);
      }
    },
    [vaultPath, closeTabByPath, refreshImages, refreshNotes],
  );

  const onMoveNote = useCallback(
    async (absPath: string, relPath: string, targetFolder: string) => {
      if (!vaultPath) return;
      const filename = relPath.split("/").pop();
      if (!filename) return;
      const currentFolder = relPath.includes("/")
        ? relPath.slice(0, relPath.lastIndexOf("/"))
        : "";
      if (currentFolder === targetFolder) return;
      const newRel = targetFolder ? `${targetFolder}/${filename}` : filename;
      const newAbs = `${vaultPath}/${newRel}`;
      const tabs = useTabsStore.getState();
      const wasOpen = !!tabs.getTab(noteTabId(absPath));
      try {
        if (wasOpen) await tabs.closeTab(noteTabId(absPath));
        await moveFile(absPath, newAbs);
        await recordMovedNote(vaultPath, relPath, newRel);
        await refreshNotes();
        if (wasOpen) await useTabsStore.getState().openPinned(newAbs);
        await useTasksStore.getState().refreshConflicts();
        useSyncStore.getState().scheduleSyncOnSave();
      } catch (err) {
        console.error("No se pudo mover la nota", err);
      }
    },
    [vaultPath, refreshNotes],
  );

  const onMoveFolder = useCallback(
    async (oldRel: string, targetParent: string) => {
      if (!vaultPath) return;
      const folderName = oldRel.split("/").pop();
      if (!folderName) return;
      const newRel = targetParent ? `${targetParent}/${folderName}` : folderName;
      if (newRel === oldRel) return;
      // Cerrar todas las pestañas cuyo archivo esté bajo la carpeta movida.
      const prefix = `${vaultPath}/${oldRel}/`;
      const tabs = useTabsStore.getState();
      for (const tab of [...tabs.tabs]) {
        if (tab.path && tab.path.startsWith(prefix)) {
          await tabs.closeTab(tab.id);
        }
      }
      try {
        await moveFolder(vaultPath, oldRel, newRel);
        await syncOpenTabsAfterFolderMove(oldRel, newRel);
        await refreshNotes();
        await refreshImages();
        await useTasksStore.getState().refreshConflicts();
        useSyncStore.getState().scheduleSyncOnSave();
      } catch (err) {
        console.error("No se pudo mover la carpeta", err);
      }
    },
    [vaultPath, refreshNotes, refreshImages],
  );

  const effectiveExpanded = useMemo(() => {
    const set = new Set(expanded);
    set.add("");
    return set;
  }, [expanded]);

  const hasContent =
    tree.folders.length > 0 || tree.notes.length > 0 || tree.images.length > 0;
  if (!hasContent) return null;

  return (
    <div
      className="folder-tree"
      onDragOver={(e) => {
        const types = e.dataTransfer.types;
        if (
          types.includes(IMG_ABS) ||
          types.includes(NOTE_ABS) ||
          types.includes(FOLDER_REL)
        ) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        const imgAbs = e.dataTransfer.getData(IMG_ABS);
        if (imgAbs) {
          e.preventDefault();
          void onMoveImage(imgAbs, e.dataTransfer.getData(IMG_REL), "");
          return;
        }
        const noteAbs = e.dataTransfer.getData(NOTE_ABS);
        if (noteAbs) {
          e.preventDefault();
          void onMoveNote(noteAbs, e.dataTransfer.getData(NOTE_REL), "");
          return;
        }
        const folderRel = e.dataTransfer.getData(FOLDER_REL);
        if (folderRel && folderRel.includes("/")) {
          // Solo tiene sentido mover a la raíz una carpeta que no esté ya en ella.
          e.preventDefault();
          void onMoveFolder(folderRel, "");
        }
      }}
    >
      <TreeBranch
        node={tree}
        depth={0}
        expanded={effectiveExpanded}
        onToggle={onToggle}
        activeNotePath={activeNotePath}
        activeImagePath={activeImagePath}
        activeDbFolder={activeDbFolder}
        highlightDailyNotes={highlightDailyNotes}
        todayDailyRelPath={todayDailyRelPath}
        openDailyRelPath={openDailyRelPath}
        onOpenPreview={onOpenPreview}
        onPinNote={onPinNote}
        onOpenImage={onOpenImage}
        onMoveImage={onMoveImage}
        onMoveNote={onMoveNote}
        onMoveFolder={onMoveFolder}
        onOpenDatabase={onOpenDatabase}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}
