import { useEffect, useRef, useState } from "react";
import {
  CheckSquare,
  FileText,
  Image as ImageIcon,
  Table as TableIcon,
  X,
} from "lucide-react";
import { useNotesStore } from "../../stores/notesStore";
import { useTabsStore, type EditorTab } from "../../stores/tabsStore";

function tabLabel(
  tab: EditorTab,
  notes: ReturnType<typeof useNotesStore.getState>["notes"],
  images: ReturnType<typeof useNotesStore.getState>["images"],
): string {
  if (tab.kind === "tasks") return "Mis tareas";
  if (tab.kind === "database") {
    if (!tab.folder) return "Base de datos";
    const name = tab.folder.includes("/")
      ? tab.folder.split("/").pop()!
      : tab.folder;
    return name;
  }
  if (tab.kind === "image") {
    const img = images.find((i) => i.path === tab.path);
    if (img) {
      const ext = img.rel_path.split(".").pop() ?? "";
      return ext ? `${img.name}.${ext}` : img.name;
    }
    return tab.path?.split(/[\\/]/).pop() ?? "Imagen";
  }
  return notes.find((n) => n.path === tab.path)?.name ?? "Nota";
}

function tabIcon(kind: EditorTab["kind"]) {
  const style = { width: 14, height: 14 } as const;
  if (kind === "database") return <TableIcon style={style} />;
  if (kind === "image") return <ImageIcon style={style} />;
  if (kind === "tasks") return <CheckSquare style={style} />;
  return <FileText style={style} />;
}

const DRAG_THRESHOLD = 5;

export default function NoteTabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const previewTabId = useTabsStore((s) => s.previewTabId);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const pinTab = useTabsStore((s) => s.pinTab);
  const reorderTabs = useTabsStore((s) => s.reorderTabs);
  const goBack = useTabsStore((s) => s.goBack);
  const goForward = useTabsStore((s) => s.goForward);
  const history = useTabsStore((s) => s.history);
  const historyIndex = useTabsStore((s) => s.historyIndex);
  const notes = useNotesStore((s) => s.notes);
  const images = useNotesStore((s) => s.images);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const barRef = useRef<HTMLDivElement>(null);
  const dragSession = useRef<{
    index: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const didDrag = useRef(false);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const onWheel = (e: WheelEvent) => {
      if (bar.scrollWidth <= bar.clientWidth) return;
      if (e.deltaY === 0) return;
      e.preventDefault();
      bar.scrollLeft += e.deltaY;
    };
    bar.addEventListener("wheel", onWheel, { passive: false });
    return () => bar.removeEventListener("wheel", onWheel);
  }, [tabs.length]);

  if (tabs.length === 0) return null;

  const indexFromPointer = (clientX: number): number => {
    const bar = barRef.current;
    if (!bar) return tabs.length - 1;
    const tabEls = bar.querySelectorAll<HTMLElement>(".note-tab");
    for (let i = 0; i < tabEls.length; i++) {
      const rect = tabEls[i].getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientX < mid) return i;
    }
    return tabs.length - 1;
  };

  const onTabPointerDown = (index: number, e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".note-tab-close")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragSession.current = {
      index,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
    };
    didDrag.current = false;
  };

  const onTabPointerMove = (e: React.PointerEvent) => {
    const session = dragSession.current;
    if (!session) return;

    if (!session.dragging) {
      const dx = Math.abs(e.clientX - session.startX);
      const dy = Math.abs(e.clientY - session.startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      session.dragging = true;
      didDrag.current = true;
      setDragIndex(session.index);
      setDropIndex(session.index);
    }

    setDropIndex(indexFromPointer(e.clientX));
  };

  const onTabPointerUp = (e: React.PointerEvent) => {
    const session = dragSession.current;
    if (!session) return;

    if (session.dragging) {
      const target = indexFromPointer(e.clientX);
      if (target !== session.index) reorderTabs(session.index, target);
    }

    dragSession.current = null;
    setDragIndex(null);
    setDropIndex(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="tab-bar-row">
      <div className="tab-nav">
        <button
          type="button"
          className="tab-nav-btn"
          disabled={!canGoBack}
          title="Atrás"
          aria-label="Atrás"
          onClick={() => void goBack()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="tab-nav-btn"
          disabled={!canGoForward}
          title="Adelante"
          aria-label="Adelante"
          onClick={() => void goForward()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="note-tab-bar" ref={barRef}>
      {tabs.map((tab, index) => {
        const isPreview = !tab.pinned && tab.id === previewTabId;
        const isActive = tab.id === activeTabId;
        const isDragging = dragIndex === index;
        const isDropBefore =
          dropIndex === index && dragIndex !== null && dragIndex !== index;
        const label = tabLabel(tab, notes, images);
        const isDb = tab.kind === "database";
        const isImg = tab.kind === "image";

        return (
          <div
            key={tab.id}
            className={`note-tab ${isDb ? "db-tab" : ""} ${isImg ? "img-tab" : ""} ${isPreview ? "preview" : "pinned"} ${isActive ? "active" : ""} ${tab.dirty ? "dirty" : ""} ${isDragging ? "dragging" : ""} ${isDropBefore ? "drag-over" : ""}`}
            onClick={() => {
              if (didDrag.current) {
                didDrag.current = false;
                return;
              }
              setActiveTab(tab.id);
            }}
            onDoubleClick={() => !tab.pinned && pinTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              void closeTab(tab.id);
            }}
            onPointerDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                return;
              }
              onTabPointerDown(index, e);
            }}
            onPointerMove={onTabPointerMove}
            onPointerUp={onTabPointerUp}
            title={`${label} · clic central para cerrar`}
          >
            <span className="note-tab-ico">{tabIcon(tab.kind)}</span>
            <span className="note-tab-label">{label}</span>
            {tab.pinned && (
              <button
                type="button"
                className="note-tab-close"
                aria-label="Cerrar pestaña"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <X style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
